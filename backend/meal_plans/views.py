"""Views for the meal_plans app: plans, their entries, and nutrition facts.

Everything here is private. A meal plan belongs to one person and nobody else
has any business reading it, so these viewsets use IsRegisteredUser rather than
one of the *OrReadOnly classes - reads included - and scope every queryset to
the caller. Somebody else's plan is a 404, never a 403, which is the same
reasoning recipes.views gives for hiding drafts by filtering rather than by
permission class.

Entry privacy is inherited, not restated: a MealPlanEntry has no user column,
so its owner is the owner of the plan it belongs to and the queryset scopes
through meal_plan__user. It also scopes through visible_recipes, because a
recipe that has since been unpublished should drop out of the schedule the same
way it drops out of a saved-recipe collection.

Nutrition is read-only and registered-only. CLAUDE.md puts "view nutrition
info on recipes" under Registered Users, not Guests, and nothing writes the
table yet - the provider is still unchosen.
"""

from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from accounts.permissions import IsRegisteredUser
from recipes.models import Recipe
from recipes.views import visible_recipes
from social.models import SavedRecipe
from social.views import require_visible_recipe

from .models import MealPlan, MealPlanEntry, NutritionInfo
from .serializers import (
    MealPlanDetailSerializer,
    MealPlanEntrySerializer,
    MealPlanSerializer,
    NutritionInfoSerializer,
)

#: Longest range the generator will fill. CLAUDE.md describes daily and weekly
#: schedules, so a month is already generous - and without a ceiling a plan
#: spanning years would bulk-insert tens of thousands of rows from one request.
MAX_GENERATED_DAYS = 31

#: Which meals the generator fills when the request does not say. Breakfast,
#: lunch and dinner are the meals a plan is expected to cover; snacks are
#: opt-in rather than three-a-day by default.
DEFAULT_MEAL_TYPES = [
    MealPlanEntry.MealType.BREAKFAST,
    MealPlanEntry.MealType.LUNCH,
    MealPlanEntry.MealType.DINNER,
]


def require_own_plan(user, meal_plan):
    """Refuse a write naming a plan this user does not own.

    The create-time half of plan privacy. Object-level permissions never run on
    a POST, and `meal_plan` accepts any primary key in the table, so without
    this a registered user could add entries to somebody else's schedule.

    Reported as a 400 on the field rather than a 403, for the same reason
    social.views.require_visible_recipe is: a permission error would confirm
    that the plan exists.
    """
    if meal_plan.user_id == user.pk:
        return

    raise ValidationError({
        'meal_plan': 'That meal plan does not exist.',
    })


class MealPlanViewSet(viewsets.ModelViewSet):
    """/api/meal-plans/ - your own meal plans.

        GET    /                    your plans
        POST   /                    create one
        GET    /<id>/               one plan, with its schedule
        PATCH  /<id>/               rename it or move its dates
        DELETE /<id>/               delete it, and its entries with it
        POST   /<id>/generate/      fill the schedule from your recipes
    """

    permission_classes = [IsRegisteredUser]

    def get_queryset(self):
        plans = MealPlan.objects.filter(user=self.request.user)

        # The detail serializer nests every entry; without this each one costs
        # a query of its own.
        if self.action in ('retrieve', 'generate'):
            return plans.prefetch_related('entries')

        return plans

    def get_serializer_class(self):
        if self.action in ('retrieve', 'generate'):
            return MealPlanDetailSerializer
        return MealPlanSerializer

    def perform_create(self, serializer):
        # `user` is read-only on the serializer: the credential decides whose
        # plan this is, never the payload.
        serializer.save(user=self.request.user)

    def _candidate_recipe_ids(self, user):
        """The recipes a generated plan may draw on, in a stable order.

        Saved recipes plus the user's own *published* ones, which is the split
        CLAUDE.md specifies. Own drafts are left out on purpose: a half-written
        recipe is not something to schedule dinner around.

        Ordered by primary key so the round-robin below is deterministic and
        the tests need no seeding.
        """
        saved = SavedRecipe.objects.filter(user=user).values_list(
            'recipe_id',
            flat=True,
        )

        return list(
            visible_recipes(user)
            .filter(
                Q(pk__in=saved)
                | Q(user=user, status=Recipe.Status.PUBLISHED),
            )
            .order_by('pk')
            .values_list('pk', flat=True)
        )

    def _requested_meal_types(self, request):
        """Which meals to fill, from the body or the default three."""
        requested = request.data.get('meal_types')

        if requested is None:
            return DEFAULT_MEAL_TYPES

        if not isinstance(requested, list) or not requested:
            raise ValidationError({
                'meal_types': 'Provide a list of meal types, or omit it.',
            })

        valid = set(MealPlanEntry.MealType.values)
        unknown = [item for item in requested if item not in valid]
        if unknown:
            raise ValidationError({
                'meal_types': (
                    f'Not a meal type: {", ".join(map(str, unknown))}. '
                    f'Choose from {", ".join(sorted(valid))}.'
                ),
            })

        # De-duplicated, but in the order asked for - the round-robin walks
        # them per day and that order decides which recipe lands on breakfast.
        seen = []
        for item in requested:
            if item not in seen:
                seen.append(item)
        return seen

    @action(detail=True, methods=['post'])
    def generate(self, request, pk=None):
        """Fill this plan's empty slots from the caller's recipes.

        Round-robin over the candidate list rather than a random draw: the
        result is reproducible, which makes it testable without seeding and
        makes a regenerate predictable for whoever is looking at it.

        Slots that already hold an entry are left alone, so this never destroys
        a schedule someone has edited by hand. Regenerating therefore tops a
        plan up rather than replacing it - deleting entries is an explicit act
        through the entries endpoint.

        Answers with the plan and its full schedule.
        """
        plan = self.get_object()

        if plan.start_date is None or plan.end_date is None:
            raise ValidationError({
                'start_date': (
                    'Give this plan a start date and an end date before '
                    'generating a schedule.'
                ),
            })

        span = (plan.end_date - plan.start_date).days + 1
        if span > MAX_GENERATED_DAYS:
            raise ValidationError({
                'end_date': (
                    f'A generated plan may cover at most '
                    f'{MAX_GENERATED_DAYS} days; this one covers {span}.'
                ),
            })

        meal_types = self._requested_meal_types(request)

        candidates = self._candidate_recipe_ids(request.user)
        if not candidates:
            raise ValidationError({
                'detail': (
                    'Save some recipes, or publish one of your own, before '
                    'generating a meal plan.'
                ),
            })

        # A slot counts as taken if anything is scheduled in it, whatever the
        # recipe. The database constraint is narrower - it only forbids the
        # *same* recipe twice in one slot - because two dishes at dinner is
        # legitimate when a person adds them deliberately.
        occupied = set(
            plan.entries.values_list('day', 'meal_type'),
        )

        entries = []
        position = 0
        day = plan.start_date

        while day <= plan.end_date:
            for meal_type in meal_types:
                if (day, meal_type) in occupied:
                    continue

                entries.append(
                    MealPlanEntry(
                        meal_plan=plan,
                        recipe_id=candidates[position % len(candidates)],
                        day=day,
                        meal_type=meal_type,
                    )
                )
                position += 1

            day += timedelta(days=1)

        # bulk_create skips clean(), which is safe here and nowhere else in
        # this file: every day is generated inside the plan's own range, so the
        # rule clean() enforces cannot be violated by construction.
        with transaction.atomic():
            MealPlanEntry.objects.bulk_create(entries)

        plan.refresh_from_db()
        return Response(
            MealPlanDetailSerializer(
                plan,
                context=self.get_serializer_context(),
            ).data,
            status=status.HTTP_201_CREATED if entries else status.HTTP_200_OK,
        )


class MealPlanEntryViewSet(viewsets.ModelViewSet):
    """/api/meal-plans/entries/ - the slots of your plans.

    Filter to one plan with ?meal_plan=<id>, or narrow to ?day= / ?meal_type=.
    """

    serializer_class = MealPlanEntrySerializer
    permission_classes = [IsRegisteredUser]

    filterset_fields = ['meal_plan', 'day', 'meal_type']

    def get_queryset(self):
        # Both scopes are load-bearing. meal_plan__user is privacy: an entry
        # has no owner of its own, so it inherits the plan's. visible_recipes
        # handles the recipe having been unpublished since it was scheduled,
        # the same way SavedRecipeViewSet does.
        return MealPlanEntry.objects.filter(
            meal_plan__user=self.request.user,
            recipe__in=visible_recipes(self.request.user),
        ).select_related('meal_plan', 'recipe')

    def perform_create(self, serializer):
        require_own_plan(
            self.request.user,
            serializer.validated_data['meal_plan'],
        )
        require_visible_recipe(
            self.request.user,
            serializer.validated_data['recipe'],
        )
        serializer.save()

    def perform_update(self, serializer):
        # Catches an entry being moved into someone else's plan, or onto a
        # recipe the caller cannot see; the object-level check only vouched for
        # where it came from.
        meal_plan = serializer.validated_data.get('meal_plan')
        if meal_plan is not None:
            require_own_plan(self.request.user, meal_plan)

        recipe = serializer.validated_data.get('recipe')
        if recipe is not None:
            require_visible_recipe(self.request.user, recipe)

        serializer.save()


class NutritionInfoViewSet(viewsets.ReadOnlyModelViewSet):
    """/api/meal-plans/nutrition/ - macros per recipe.

    Read-only because these figures come from an external provider, not from a
    client - and nothing fetches them yet, so the table is empty until a
    provider is chosen.

    IsRegisteredUser rather than one of the *OrReadOnly classes: CLAUDE.md
    lists "view nutrition info on recipes" as a Registered User permission, so
    a guest does not get it even on a published recipe.
    """

    serializer_class = NutritionInfoSerializer
    permission_classes = [IsRegisteredUser]

    filterset_fields = ['recipe']

    def get_queryset(self):
        # Scoped so nutrition cannot become a side channel onto a draft nobody
        # is allowed to read.
        return NutritionInfo.objects.filter(
            recipe__in=visible_recipes(self.request.user),
        ).select_related('recipe')
