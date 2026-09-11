"""Serializers for the social app: Rating, Comment, Tag, RecipeTag, SavedRecipe.

Three conventions carry over from recipes/serializers.py, for the same
reasons it gives.

`user` is read-only everywhere and set by the view from request.user.
Accepting a user id from the client would let anyone file a rating, review or
saved recipe under someone else's name.

Every serializer whose model carries a UniqueConstraint checks it by hand in
validate(), and that check is the *only* serializer-level protection the
constraint has. DRF generates a UniqueTogetherValidator only when it can map
every field the constraint names onto a writable field, or onto a read-only
field carrying a default. `user` is read-only with no default, so DRF finds
the constraint, fails to map it, and skips it silently - see
get_unique_together_validators() in rest_framework/serializers.py, which
`continue`s past it rather than raising. Nothing warns you. Left unhandled, a
duplicate rating would pass validation cleanly and surface as an
IntegrityError that DRF reports as a 500.

`validators = []` stays on those Meta classes as a statement of intent, not
as the fix - there was no generated validator to remove. It records that
uniqueness is enforced below, so nobody assumes DRF has it covered, and so
making `user` writable later cannot quietly introduce a second check that
words the same error differently.

Rules that the database cannot express stay on the model. validate() builds a
throwaway instance and calls clean() rather than repeating the rule, so DRF
and the Django admin enforce one copy of it - the pattern
recipes.serializers.ImageSerializer established.

What is *not* here: "you may only rate a recipe you can see". Visibility is
queryset filtering, not validation - views.py scopes every queryset through
recipes.views.visible_recipes() so a hidden draft is a 404, never a 403.
"""

# Aliased on purpose, exactly as recipes/serializers.py does: Django's
# ValidationError and DRF's share a name but are not interchangeable. Raising
# Django's from a serializer produces a 500, not a 400.
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework.serializers import as_serializer_error

# Ratings and comments are readable by guests, so the person shown beside one
# must be the trimmed public view - user_id and username only - and never
# accounts.serializers.UserSerializer, which also exposes email, role and
# dietary_preferences. recipes already defines exactly that serializer for
# recipe authors; reused here under a clearer name rather than written twice.
from recipes.serializers import RecipeAuthorSerializer as PublicUserSerializer

from .models import Comment, Rating, RecipeTag, SavedRecipe, Tag


def _normalise_tag_name(value):
    """Match what Tag.save() does to a name before it is stored.

    Every lookup by name has to go through this first. Tag.save() lowercases
    and strips, so searching for the raw input misses the row that is actually
    there. Mirrors _normalise_ingredient_name in recipes/serializers.py.
    """
    return value.strip().lower()


class _OwnedSerializer(serializers.ModelSerializer):
    """Shared plumbing for rows owned by the user who created them.

    Ratings, comments and saved recipes all need the same two things: the
    owner read back as a public user, and a way to know who that owner is
    during validate() even though `user` never arrives in the payload.
    """

    user = PublicUserSerializer(read_only=True)

    def _owner(self):
        """Who this row belongs to, during validation.

        On create the owner is the caller - the view has not set it yet, so
        attrs cannot supply it. On update it is whoever already owns the row;
        the caller may be an admin moderating someone else's content, and the
        uniqueness checks below have to test the owner, not the moderator.
        """
        if self.instance is not None:
            return self.instance.user

        request = self.context.get('request')
        user = getattr(request, 'user', None)

        # Anonymous callers never reach a write - IsRegisteredUserOrReadOnly
        # stops them first - but validate() also runs from the browsable API
        # and from tests that build a serializer without a request.
        if user is not None and user.is_authenticated:
            return user
        return None


class RatingSerializer(_OwnedSerializer):
    """One user's 1-5 score for one recipe.

    Changing your mind is a PATCH of the existing row, not a second POST -
    the model allows exactly one rating per user per recipe so an average
    cannot be stacked.
    """

    class Meta:
        model = Rating
        fields = ['rating_id', 'recipe', 'user', 'score', 'created_at']
        read_only_fields = ['rating_id', 'user', 'created_at']

        # Explicit rather than corrective: DRF silently skips the
        # (recipe, user) constraint because `user` is read-only with no
        # default, so there is no generated validator here to remove.
        # validate() below is what actually enforces it.
        validators = []

    def validate(self, attrs):
        recipe = attrs.get('recipe', getattr(self.instance, 'recipe', None))
        score = attrs.get('score', getattr(self.instance, 'score', None))
        user = self._owner()

        if recipe is not None and user is not None:
            # (recipe, user) is a database constraint. Checking it here turns
            # the collision into a 400 that says what to do instead, rather
            # than an IntegrityError DRF reports as a 500.
            clash = Rating.objects.filter(recipe=recipe, user=user)
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError({
                    'score': (
                        'You have already rated this recipe. Edit your '
                        'existing rating instead of adding another.'
                    ),
                })

            # "Authors may not rate their own recipe" lives on the model so
            # the admin enforces it too. Checked on a throwaway instance built
            # from the merged values rather than on self.instance, which on a
            # PATCH still holds the values this request is replacing.
            candidate = Rating(recipe=recipe, user=user, score=score)
            try:
                # clean(), not full_clean(): DRF has already validated the
                # fields themselves, and full_clean() would re-run the
                # uniqueness query just checked above.
                candidate.clean()
            except DjangoValidationError as exc:
                # DRF's own converter, so the error stays keyed on `score`
                # and the 400 body keeps the shape clients expect.
                raise serializers.ValidationError(as_serializer_error(exc))

        return attrs


class CommentSerializer(_OwnedSerializer):
    """A written review on a recipe.

    No uniqueness rule and no self-comment rule - unlike Rating, several
    comments from one person are the feature working, including on their own
    recipe.
    """

    class Meta:
        model = Comment
        fields = ['comment_id', 'recipe', 'user', 'content', 'created_at']
        read_only_fields = ['comment_id', 'user', 'created_at']


class TagSerializer(serializers.ModelSerializer):
    """The shared tag lookup table.

    `name` is declared explicitly to *drop* the UniqueValidator DRF would
    attach from the model's unique=True, for the reason
    IngredientSerializer gives: that validator runs against the raw input,
    before Tag.save() normalises it, so "Vegan" finds no matching row, passes,
    and then blows up with an IntegrityError against the existing "vegan" - a
    500 where the client deserves a 400.
    """

    name = serializers.CharField(max_length=50)

    class Meta:
        model = Tag
        fields = ['tag_id', 'name']

    def validate_name(self, value):
        name = _normalise_tag_name(value)
        if not name:
            raise serializers.ValidationError('This field may not be blank.')

        clash = Tag.objects.filter(name=name)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(f'"{name}" is already a tag.')
        return name


class RecipeTagSerializer(serializers.ModelSerializer):
    """A tag as applied to one recipe.

    Reads back the nested tag; writes take `tag_name`, a plain string, and
    find or create the lookup row - the same shape RecipeIngredientSerializer
    uses, so the builder can type "vegan" rather than pick an id out of a
    list.
    """

    tag = TagSerializer(read_only=True)
    tag_name = serializers.CharField(write_only=True, max_length=50)

    class Meta:
        model = RecipeTag
        fields = ['recipe_tag_id', 'recipe', 'tag', 'tag_name']

        # Same situation as RatingSerializer: the writable field here is
        # `tag_name`, while `tag` itself is read-only, so DRF cannot map the
        # (recipe, tag) constraint and skips it. validate() below enforces it
        # and keeps the error on `tag_name` rather than non_field_errors.
        validators = []

    def validate(self, attrs):
        recipe = attrs.get('recipe', getattr(self.instance, 'recipe', None))
        name = attrs.get('tag_name')

        if name is not None:
            name = _normalise_tag_name(name)
            if not name:
                raise serializers.ValidationError({
                    'tag_name': 'This field may not be blank.',
                })
            attrs['tag_name'] = name

        # (recipe, tag) is a database constraint - the same tag twice on one
        # recipe is a bug. Report it as a 400 naming the field.
        if recipe is not None and name is not None:
            clash = RecipeTag.objects.filter(recipe=recipe, tag__name=name)
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError({
                    'tag_name': f'This recipe is already tagged "{name}".',
                })

        return attrs

    def create(self, validated_data):
        # The name arrives normalised from validate(), so get_or_create looks
        # for the row that is actually stored rather than the raw input.
        name = validated_data.pop('tag_name')
        tag, _ = Tag.objects.get_or_create(name=name)
        return RecipeTag.objects.create(tag=tag, **validated_data)

    def update(self, instance, validated_data):
        name = validated_data.pop('tag_name', None)
        if name is not None:
            instance.tag, _ = Tag.objects.get_or_create(name=name)
        return super().update(instance, validated_data)


class SavedRecipeSerializer(_OwnedSerializer):
    """One entry in a user's personal recipe collection.

    Carries the recipe by id only. Nesting the recipe here would let the
    collection page render cards in one request, but it is deferred to the
    depth pass along with search and sort - it needs a prefetch on the view to
    avoid a query per row, and the shape of the card is the frontend's
    decision, which has not been made yet.
    """

    class Meta:
        model = SavedRecipe
        fields = ['saved_recipe_id', 'user', 'recipe', 'saved_at']
        read_only_fields = ['saved_recipe_id', 'user', 'saved_at']

        # Same as RatingSerializer: `user` is read-only, so DRF skips the
        # (user, recipe) constraint and validate() below is the only check
        # before the database's.
        validators = []

    def validate(self, attrs):
        recipe = attrs.get('recipe', getattr(self.instance, 'recipe', None))
        user = self._owner()

        if recipe is not None and user is not None:
            clash = SavedRecipe.objects.filter(recipe=recipe, user=user)
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError({
                    'recipe': 'This recipe is already in your collection.',
                })

        return attrs
