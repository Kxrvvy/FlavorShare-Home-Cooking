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
        fields = ['step_id', 'recipe', 'step_number', 'instruction', 'images']

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
            'view_count',
            'cover_image',
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
        """
        for image in recipe.images.all():
            if image.type == Image.Type.FINAL:
                return image.url
        return None


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
            'steps',
            'recipe_ingredients',
            'images',
        ]
        read_only_fields = fields


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
            'cuisine_type',
            'prep_time',
            'cook_time',
            'servings',
            'difficulty',
            'status',
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

    def validate(self, attrs):
        """Rule 2 from the module docstring: the publish gate.

        The rule itself is Recipe.publication_error(), so RecipeAdminForm
        enforces the same one. What stays here is the transition: whether
        this request is actually a move into `published`.
        """
        status = attrs.get(
            'status',
            getattr(self.instance, 'status', Recipe.Status.DRAFT),
        )

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
