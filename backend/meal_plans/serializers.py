"""Serializers for meal plans: MealPlan, MealPlanEntry, NutritionInfo.

The conventions are the ones recipes/serializers.py and social/serializers.py
established, and the reasons are the same.

`user` is read-only and set by the view from request.user. Accepting an owner
id from the client would let anyone file a plan under someone else's name.

Rules the database cannot express stay on the model. validate() builds a
throwaway instance and calls clean() rather than restating the rule, so DRF
and the Django admin enforce one copy - the pattern Image.clean() set.

Writes are flat. A plan is created first and its entries are added one at a
time afterwards, the same way a recipe's steps are, so MealPlanSerializer
takes no nested array of entries. Reads differ: MealPlanDetailSerializer
carries them, because a plan without its schedule is not worth fetching.

What is *not* here: "this plan is yours" and "you may only schedule a recipe
you can see". Both are the view's, and for the reason social/serializers.py
gives - ownership and visibility are queryset and request concerns, so a
serializer asking them would either duplicate the check or get it wrong.
"""

# Aliased for the reason the other two apps give: Django's ValidationError and
# DRF's share a name but are not interchangeable - raising Django's from a
# serializer produces a 500, not a 400.
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework.serializers import as_serializer_error

from .models import MealPlan, MealPlanEntry, NutritionInfo


class NutritionInfoSerializer(serializers.ModelSerializer):
    """Macros for one recipe.

    Every field is read-only, including on the model's own endpoint: these
    figures come from an external provider, not from a client. Once a provider
    is chosen, whatever fetches them writes through the model rather than
    through here.
    """

    class Meta:
        model = NutritionInfo
        fields = [
            'nutrition_info_id',
            'recipe',
            'calories',
            'protein',
            'carbs',
            'fat',
            'fetched_at',
        ]
        read_only_fields = fields


class MealPlanEntrySerializer(serializers.ModelSerializer):
    """One recipe in one slot of a plan.

    Carries `recipe` by id. Nesting the recipe would save the schedule view a
    request per row, but it is deferred with the rest of the read-shape work -
    it needs a prefetch on the view, and what a schedule card shows is a
    frontend decision nobody has made yet.
    """

    class Meta:
        model = MealPlanEntry
        fields = [
            'meal_plan_entry_id',
            'meal_plan',
            'recipe',
            'day',
            'meal_type',
        ]
        read_only_fields = ['meal_plan_entry_id']

        # Unlike social's serializers, every field in this model's
        # UniqueConstraint is writable, so DRF *does* generate a
        # UniqueTogetherValidator here. Dropped anyway, for the reason
        # StepSerializer drops its own: the generated one reports the clash
        # under non_field_errors, and a four-column key produces a message
        # naming all four. validate() below says the same thing usefully.
        validators = []

    def validate(self, attrs):
        def merged(field):
            return attrs.get(field, getattr(self.instance, field, None))

        meal_plan = merged('meal_plan')
        recipe = merged('recipe')
        day = merged('day')
        meal_type = merged('meal_type')

        if None not in (meal_plan, recipe, day, meal_type):
            # (meal_plan, day, meal_type, recipe) is a database constraint.
            # Checking it here turns the collision into a 400 that says which
            # slot is taken, instead of an IntegrityError DRF reports as a 500.
            clash = MealPlanEntry.objects.filter(
                meal_plan=meal_plan,
                day=day,
                meal_type=meal_type,
                recipe=recipe,
            )
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                raise serializers.ValidationError({
                    'recipe': (
                        f'This recipe is already scheduled for {meal_type} '
                        f'on {day}.'
                    ),
                })

        # "An entry's day must fall inside its plan's range" lives on the
        # model. Checked on a throwaway instance built from the merged values
        # rather than on self.instance, which on a PATCH still holds the values
        # this request is replacing.
        if meal_plan is not None and day is not None:
            candidate = MealPlanEntry(
                meal_plan=meal_plan,
                recipe=recipe,
                day=day,
                meal_type=meal_type,
            )
            try:
                # clean(), not full_clean(): DRF has already validated the
                # fields themselves, and full_clean() would re-run the
                # uniqueness query just checked above.
                candidate.clean()
            except DjangoValidationError as exc:
                # DRF's converter, so the error stays keyed on `day` and the
                # 400 body keeps the shape clients expect.
                raise serializers.ValidationError(as_serializer_error(exc))

        return attrs


class MealPlanSerializer(serializers.ModelSerializer):
    """A plan as it appears in a list, and the shape writes take.

    `user` is a read-only id rather than a nested public user. A plan is
    private to its owner, so the owner is always the caller and nesting their
    username would only repeat what the credential already said - unlike a
    rating, which strangers read.
    """

    class Meta:
        model = MealPlan
        fields = [
            'meal_plan_id',
            'user',
            'name',
            'start_date',
            'end_date',
        ]
        read_only_fields = ['meal_plan_id', 'user']

    def validate(self, attrs):
        start = attrs.get('start_date', getattr(self.instance, 'start_date', None))
        end = attrs.get('end_date', getattr(self.instance, 'end_date', None))

        # "A plan cannot end before it starts" lives on the model, so the admin
        # enforces it too. The CheckConstraint behind it would otherwise
        # surface as an IntegrityError, which DRF reports as a 500.
        candidate = MealPlan(start_date=start, end_date=end)
        try:
            candidate.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(as_serializer_error(exc))

        return attrs


class MealPlanDetailSerializer(MealPlanSerializer):
    """One plan with its schedule.

    Split from MealPlanSerializer the way RecipeDetailSerializer is split from
    RecipeListSerializer: a list of plans does not need every entry of every
    plan, and a single plan is useless without them.
    """

    entries = MealPlanEntrySerializer(many=True, read_only=True)

    class Meta(MealPlanSerializer.Meta):
        fields = MealPlanSerializer.Meta.fields + ['entries']
