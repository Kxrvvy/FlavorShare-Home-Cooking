"""Serializers for the recipe core: Recipe, Ingredient, Step, Image.

Two rules live here rather than in the database, and models.py points at this
file for both:

1. An Image's `step` must belong to the same recipe as the Image. That is a
   cross-table comparison no column constraint can express.
2. A recipe needs ingredients and steps before it may be published. Encoding
   that as NOT NULL would make a half-built draft impossible to save, which
   is the opposite of what the draft-first builder needs.

Writes are flat, not nested. models.py describes the flow: the Recipe row is
created as a draft the moment the user opens the form, and steps, ingredients
and images are added one at a time afterwards. So RecipeWriteSerializer takes
no nested arrays, each child has its own serializer, and the publish gate can
only ever fire on an update - a recipe created a second ago has no children
to check.
"""

import unicodedata

from django.contrib.auth import get_user_model
# Aliased on purpose. Django's ValidationError and DRF's share a name but are
# not interchangeable: raising Django's from a serializer produces a 500, not
# a 400. The alias makes every use site say which one it means.
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Max
from rest_framework import serializers
from rest_framework.serializers import as_serializer_error

from .models import Image, Ingredient, Recipe, RecipeIngredient, Step

User = get_user_model()


def _contains_number(value):
    """True if any character is a number of any kind, not only 0-9.

    A fraction like one-half and Arabic-Indic digits are numbers too, so this reads the Unicode
    category (any N*) rather than str.isdigit(), which misses fractions. The
    builder strips the same set as it is typed (\\p{N} in lib/inputs.ts) - the
    two definitions have to stay the same one.
    """
    return any(unicodedata.category(ch).startswith('N') for ch in value)


def _normalise_ingredient_name(value):
    """Match what Ingredient.save() does to a name before it is stored.

    Every lookup by name has to go through this first. Ingredient.save()
    lowercases and strips, so searching for the raw input misses the row that
    is actually there - see IngredientSerializer.validate_name for what that
    costs.
    """
    return value.strip().lower()


class RecipeAuthorSerializer(serializers.ModelSerializer):
    """The public face of a recipe's author.

    Deliberately not accounts.serializers.UserSerializer, which also exposes
    email, role and dietary_preferences. Recipe list and detail are readable
    by guests, so nesting that one would publish every author's email address
    to anonymous callers.
    """

    class Meta:
        model = User
        fields = ['user_id', 'username']
        read_only_fields = fields


class IngredientSerializer(serializers.ModelSerializer):
    """The shared ingredient lookup table.

    `name` is declared explicitly to *drop* the UniqueValidator that DRF
    would otherwise attach from the model's unique=True. That validator runs
    against the raw input, before Ingredient.save() normalises it: "Salt"
    finds no matching row, passes, and then blows up with an IntegrityError
    against the existing "salt" - a 500 where the client deserves a 400.
    Normalising first and checking by hand keeps the error where it belongs.
    """

    name = serializers.CharField(max_length=100)

    class Meta:
        model = Ingredient
        fields = ['ingredient_id', 'name', 'category']

    def validate_name(self, value):
        name = _normalise_ingredient_name(value)
        if not name:
            raise serializers.ValidationError('This field may not be blank.')

        clash = Ingredient.objects.filter(name=name)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(
                f'"{name}" is already in the ingredient list.'
            )
        return name


class ImageSerializer(serializers.ModelSerializer):
    """A recipe photo, optionally pinned to one step.

    `uploaded_by` is read-only: the view sets it from request.user. Accepting
    an uploader id from the client would let anyone file a photo under
    someone else's name.
    """

    uploaded_by = RecipeAuthorSerializer(read_only=True)

    class Meta:
        model = Image
        fields = ['image_id', 'recipe', 'step', 'uploaded_by', 'url', 'type']

    def validate(self, attrs):
        # .get(key, fallback) rather than `or`: a client explicitly sending
        # step=null means "unpin this photo", and that has to survive as None
        # instead of falling back to the value already on the row.
        recipe = attrs.get('recipe', getattr(self.instance, 'recipe', None))
        step = attrs.get('step', getattr(self.instance, 'step', None))
        image_type = attrs.get('type', getattr(self.instance, 'type', None))

        # The rules themselves live on the model, so the admin enforces the
        # same ones through full_clean(). Checked on a throwaway instance
        # built from the merged values rather than on self.instance, which on
        # a PATCH still holds the old values this request is replacing.
        candidate = Image(recipe=recipe, step=step, type=image_type)

        try:
            # clean(), not full_clean(): DRF has already validated the fields
            # themselves, and full_clean() would add a uniqueness query per
            # request for no benefit.
            candidate.clean()
        except DjangoValidationError as exc:
            # DRF's own converter, so the error stays keyed on `step` and the
            # 400 body keeps the shape clients already expect.
            raise serializers.ValidationError(as_serializer_error(exc))

        return attrs


class StepSerializer(serializers.ModelSerializer):
    """One instruction in a recipe.

    `step_number` is optional on create and defaults to the next free number.
    Steps are appended one at a time by the builder, so making the client
    track the counter only invites it to get out of step with the server.
    """

    step_number = serializers.IntegerField(required=False, min_value=1)
    images = ImageSerializer(many=True, read_only=True)

    class Meta:
        model = Step
        fields = ['step_id', 'recipe', 'step_number', 'title', 'instruction', 'images']

        # Drops the UniqueTogetherValidator DRF would build from the model's
        # (recipe, step_number) constraint. It does two things we don't want:
        # it forces step_number to be required, which kills the auto-numbering
        # above, and it reports a collision under non_field_errors instead of
        # naming the field. validate() below covers the same ground.
        validators = []

    def validate(self, attrs):
        recipe = attrs.get('recipe', getattr(self.instance, 'recipe', None))
        number = attrs.get('step_number')

        if number is None and self.instance is None and recipe is not None:
            highest = Step.objects.filter(recipe=recipe).aggregate(
                highest=Max('step_number'),
            )['highest']
            number = (highest or 0) + 1
            attrs['step_number'] = number

        # (recipe, step_number) is a database constraint. Checking it here
        # turns the collision into a 400 naming the field, instead of letting
        # MySQL raise an IntegrityError that DRF reports as a 500.
        if recipe is not None and number is not None:
            clash = Step.objects.filter(recipe=recipe, step_number=number)
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError({
                    'step_number': f'This recipe already has a step {number}.',
                })

        return attrs


class RecipeIngredientSerializer(serializers.ModelSerializer):
    """An ingredient with its amount, as used by one recipe.

    Reads back the nested ingredient; writes take `ingredient_name`, a plain
    string, and find or create the lookup row. That suits a builder where the
    user types "salt" rather than picking an id out of a list.
    """

    ingredient = IngredientSerializer(read_only=True)
    ingredient_name = serializers.CharField(write_only=True, max_length=100)

    class Meta:
        model = RecipeIngredient
        fields = [
            'recipe_ingredient_id',
            'recipe',
            'ingredient',
            'ingredient_name',
            'quantity',
            'unit',
            'notes',
        ]

    def validate_unit(self, value):
        if not value:
            return value

        if len(value) > MAX_UNIT_LENGTH:
            raise serializers.ValidationError(
                f'A unit is limited to {MAX_UNIT_LENGTH} characters '
                f'(this one is {len(value)}).'
            )

        if _contains_number(value):
            raise serializers.ValidationError(
                'A unit cannot contain a number - put the amount in the '
                'amount box.'
            )

        return value

    def validate_ingredient_name(self, value):
        # The amount has its own box, so a digit here is almost always the
        # amount typed into the wrong one ("2 eggs" as a name). Checked before
        # normalisation, on what was actually sent.
        if _contains_number(value):
            raise serializers.ValidationError(
                'An ingredient name cannot contain a number - put the amount '
                'in the amount box.'
            )
        return value

    def validate(self, attrs):
        recipe = attrs.get('recipe', getattr(self.instance, 'recipe', None))
        name = attrs.get('ingredient_name')

        if name is not None:
            name = _normalise_ingredient_name(name)
            if not name:
                raise serializers.ValidationError({
                    'ingredient_name': 'This field may not be blank.',
                })
            attrs['ingredient_name'] = name

        # (recipe, ingredient) is a database constraint - flour listed twice
        # is a bug. Same reasoning as StepSerializer: report it as a 400.
        if recipe is not None and name is not None:
            clash = RecipeIngredient.objects.filter(
                recipe=recipe,
                ingredient__name=name,
            )
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError({
                    'ingredient_name': (
                        f'This recipe already lists "{name}". Change the '
                        f'existing entry instead of adding a second one.'
                    ),
                })

        return attrs

    def create(self, validated_data):
        # The name arrives normalised from validate(), so get_or_create looks
        # for the row that is actually stored rather than the raw input.
        name = validated_data.pop('ingredient_name')
        ingredient, _ = Ingredient.objects.get_or_create(name=name)
        return RecipeIngredient.objects.create(
            ingredient=ingredient,
            **validated_data,
        )

    def update(self, instance, validated_data):
        name = validated_data.pop('ingredient_name', None)
        if name is not None:
            instance.ingredient, _ = Ingredient.objects.get_or_create(
                name=name,
            )
        return super().update(instance, validated_data)


class RecipeListSerializer(serializers.ModelSerializer):
    """A recipe as it appears in a list or a set of search results.

    Read-only, and light on purpose: no steps, no ingredients, just enough to
    render a card.
    """

    user = RecipeAuthorSerializer(read_only=True)
    cover_image = serializers.SerializerMethodField()
    tags = serializers.SerializerMethodField()
    avg_score = serializers.SerializerMethodField()
    save_count = serializers.SerializerMethodField()

    class Meta:
        model = Recipe
        fields = [
            'recipe_id',
            'user',
            'title',
            'description',
            'cuisine_type',
            'prep_time',
            'cook_time',
            'servings',
            'difficulty',
            'status',
            'featured',
            'view_count',
            'cover_image',
            'tags',
            'avg_score',
            'save_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields

    def get_cover_image(self, recipe):
        """The final-product photo, or None if the recipe has no cover yet.

        Scans the already-loaded images in Python instead of calling
        .filter(), so a prefetch_related('images') on the view's queryset
        makes this free. .filter() would ignore the prefetch and fire one
        query per row in the list.

        Takes the highest image_id among type=FINAL, not the first one
        encountered: Image carries no ordering and no timestamp, so without
        this a recipe that ever ends up with more than one final image (the
        builder's cover-replace flow deletes the old one, but a failed
        delete leaves it behind - see RecipeBuilder.tsx's chooseCover) would
        permanently show whichever was uploaded first instead of the most
        recent, no matter how many times the cover is replaced afterwards.
        """
        cover = None
        for image in recipe.images.all():
            if image.type == Image.Type.FINAL and (cover is None or image.image_id > cover.image_id):
                cover = image
        return cover.url if cover else None

    def get_tags(self, recipe):
        """The recipe's tag names, for the badges and the category chips.

        Names rather than ids or objects: the client filters with ?tag=vegan,
        which is a name, so handing back anything else would make every caller
        translate. Sorted, so two recipes with the same tags render them in the
        same order rather than in insertion order.

        Scans already-loaded rows in Python, the same as get_cover_image and
        for the same reason - a .filter() here would ignore
        prefetch_related('recipe_tags__tag') and cost one query per recipe.
        An instance that never came through that queryset simply pays for the
        query it did not prefetch; it does not break.

        Crossing into social by attribute name rather than by import, which is
        the direction this project allows: social imports recipes, never the
        reverse.
        """
        return sorted(link.tag.name for link in recipe.recipe_tags.all())

    def get_avg_score(self, recipe):
        """The recipe's mean rating, or None if it has none.

        A method field rather than a declared FloatField, and the getattr is
        the reason. This is an annotation added by
        RecipeViewSet.get_queryset(), not a column, so an instance that did not
        come through that queryset does not carry it - a bare
        Recipe.objects.get(), a freshly constructed Recipe(), a row built in a
        test or a future management command. A declared field would raise
        AttributeError on every one of those; this returns None.

        Note what does *not* lose it: refresh_from_db() copies only the model's
        concrete fields, so annotations set on the instance survive it. An
        earlier version of this comment claimed otherwise and was wrong -
        reorder_steps() refreshes and still serialises the real numbers.

        None rather than 0.0 when absent, because "nobody has rated this" and
        "this instance was not asked" are different claims and only one of them
        is a rating of zero.
        """
        return getattr(recipe, 'avg_score', None)

    def get_save_count(self, recipe):
        """How many people have this recipe saved. None when unannotated.

        Same reasoning as get_avg_score(), including why it is None and not 0
        on an instance that never carried the annotation.
        """
        return getattr(recipe, 'save_count', None)


class RecipeDetailSerializer(RecipeListSerializer):
    """One recipe with everything needed to render its page.

    Note for whoever writes the view: this nests three relations, so the
    queryset needs select_related('user') and prefetch_related on steps,
    recipe_ingredients and images. Without them a single detail response
    fans out into a query per step and per ingredient.
    """

    steps = StepSerializer(many=True, read_only=True)
    recipe_ingredients = RecipeIngredientSerializer(many=True, read_only=True)
    images = ImageSerializer(many=True, read_only=True)

    class Meta(RecipeListSerializer.Meta):
        fields = RecipeListSerializer.Meta.fields + [
            'body',
            'equipment',
            'steps',
            'recipe_ingredients',
            'images',
        ]
        read_only_fields = fields


# The builder trims what is typed to this and shows a live counter, but a
# direct API call never touches the builder - so the limit is enforced here as
# well. Counted as whitespace-separated words, the same definition the builder
# uses (a run of non-space characters), so the two never disagree about whether
# a text is over.
MAX_TEXT_WORDS = 300


def _check_word_limit(value, label):
    if value and len(value.split()) > MAX_TEXT_WORDS:
        raise serializers.ValidationError(
            f'{label} is limited to {MAX_TEXT_WORDS} words '
            f'(this one is {len(value.split())}).'
        )
    return value


# The unit box is for "g", "tbsp", "cloves" - not "2 cups", which belongs in
# the amount box and would print as "2 2 cups". The builder stops these being
# typed; this holds for a direct API call too. The column allows 30, but
# nothing that is really a unit needs more than 20.
MAX_UNIT_LENGTH = 20


class RecipeWriteSerializer(serializers.ModelSerializer):
    """Create and update a recipe.

    `user` is read-only and set by the view from request.user - a client must
    not be able to file a recipe under someone else's name. `view_count` is
    read-only too: it is incremented server-side when the recipe is viewed,
    and letting a client write it would make the admin dashboard's "most
    viewed" report meaningless.
    """

    class Meta:
        model = Recipe
        fields = [
            'recipe_id',
            'user',
            'title',
            'description',
            'body',
            'equipment',
            'cuisine_type',
            'prep_time',
            'cook_time',
            'servings',
            'difficulty',
            'status',
            'featured',
            'view_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'recipe_id',
            'user',
            'view_count',
            'created_at',
            'updated_at',
        ]

    def validate_description(self, value):
        return _check_word_limit(value, 'The description')

    def validate_body(self, value):
        return _check_word_limit(value, 'This text')

    def validate(self, attrs):
        """Rule 2 from the module docstring: the publish gate.

        The rule itself is Recipe.publication_error(), so RecipeAdminForm
        enforces the same one. What stays here is the transition: whether
        this request is actually a move into `published`.

        The featured rule is Recipe.clean(), called below so the API refuses
        what the admin form refuses.
        """
        status = attrs.get(
            'status',
            getattr(self.instance, 'status', Recipe.Status.DRAFT),
        )

        featured = attrs.get(
            'featured',
            getattr(self.instance, 'featured', False),
        )

        # Two different requests reach this line, and only one of them should
        # be quietly adjusted.
        #
        # Unpublishing takes the feature with it: refusing the unpublish would
        # be the wrong failure, since an admin taking something out of public
        # view needs that to work.
        #
        # Asking to feature something that is not published is a mistake, not a
        # transition, and falls through to clean() to be refused - clearing it
        # here would answer 200 to a request that did the opposite of what it
        # asked.
        leaving_published = (
            'status' in attrs and attrs['status'] != Recipe.Status.PUBLISHED
        )
        asking_to_feature = attrs.get('featured') is True

        if leaving_published and featured and not asking_to_feature:
            attrs['featured'] = featured = False

        # Checked on a throwaway instance so a create - which has no self
        # .instance - is covered by the same rule as an update.
        probe = self.instance or Recipe()
        probe_status, probe_featured = probe.status, probe.featured
        probe.status, probe.featured = status, featured
        try:
            probe.clean()
        except DjangoValidationError as error:
            raise serializers.ValidationError(as_serializer_error(error))
        finally:
            probe.status, probe.featured = probe_status, probe_featured

        if status != Recipe.Status.PUBLISHED:
            return attrs

        # Re-saving something already published is a no-op, not an error.
        if self.instance is not None:
            if self.instance.status == Recipe.Status.PUBLISHED:
                return attrs

        # Writes are flat, so a recipe being created has no steps or
        # ingredients yet. An unsaved Recipe() answers for that case, which
        # keeps the create path and the update path on one rule.
        error = (self.instance or Recipe()).publication_error()

        if error:
            raise serializers.ValidationError({'status': error})

        return attrs
