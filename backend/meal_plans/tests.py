"""Tests for the meal_plans app: plans, entries, the generator and nutrition.

The breadth pass, so this is not the coverage recipes/tests.py has. It is
weighted toward the rules that would fail silently if they broke:

- privacy, which for an entry is *inherited* from its plan rather than declared
  on itself - the scoping mistake here leaks somebody's whole schedule;
- the date-range rule, which spans two tables and so cannot be a constraint;
- the generator's contract: deterministic, and it tops a plan up rather than
  overwriting a schedule somebody edited by hand;
- nutrition being registered-only, which CLAUDE.md requires and no database
  constraint can express;
- the on_delete choices, invisible until they are wrong.

Left for the depth pass: filter and pagination combinations, every field-level
message, the admin beyond a smoke test, and what should happen to an entry
whose recipe was unpublished (see the CLAUDE.md note on silent schedule gaps -
the current behaviour is asserted here as the documented one, not as the
desired one).
"""

import datetime as dt

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from recipes.models import Recipe
from social.models import SavedRecipe

from .models import MealPlan, MealPlanEntry, NutritionInfo

User = get_user_model()

PLANS_URL = '/api/meal-plans/'
ENTRIES_URL = '/api/meal-plans/entries/'
NUTRITION_URL = '/api/meal-plans/nutrition/'


class MealPlanTestCase(APITestCase):
    """Two users, four recipes between them, and one three-day plan.

    `me` has saved one of `her` published recipes, so the generator has two
    candidates: my own published recipe and her saved one. The two drafts exist
    to be excluded - hers because I cannot see it, mine because a half-written
    recipe is not something to schedule.
    """

    @classmethod
    def setUpTestData(cls):
        cls.me = User.objects.create_user(
            username='planner',
            email='planner@example.com',
            password='n0t-a-real-password',
            role=User.Role.REGISTERED,
        )
        cls.her = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password='n0t-a-real-password',
            role=User.Role.REGISTERED,
        )

        cls.my_published = Recipe.objects.create(
            user=cls.me,
            title='My adobo',
            status=Recipe.Status.PUBLISHED,
        )
        cls.my_draft = Recipe.objects.create(
            user=cls.me,
            title='My half-written sinigang',
            status=Recipe.Status.DRAFT,
        )
        cls.her_published = Recipe.objects.create(
            user=cls.her,
            title='Her kare-kare',
            status=Recipe.Status.PUBLISHED,
        )
        cls.her_draft = Recipe.objects.create(
            user=cls.her,
            title='Her secret lumpia',
            status=Recipe.Status.DRAFT,
        )

        SavedRecipe.objects.create(user=cls.me, recipe=cls.her_published)

        cls.plan = MealPlan.objects.create(
            user=cls.me,
            name='Week one',
            start_date=dt.date(2026, 9, 14),
            end_date=dt.date(2026, 9, 16),
        )

    def generate_url(self, plan=None):
        return f'{PLANS_URL}{(plan or self.plan).pk}/generate/'


class MealPlanApiTests(MealPlanTestCase):
    def test_guests_may_not_list_plans(self):
        """IsRegisteredUser, not *OrReadOnly: a plan is private, reads too."""
        self.assertEqual(
            self.client.get(PLANS_URL).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_a_plan_is_filed_under_the_caller(self):
        self.client.force_authenticate(self.me)

        response = self.client.post(PLANS_URL, {'name': 'Week two'})

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(MealPlan.objects.get(name='Week two').user, self.me)

    def test_the_owner_cannot_be_spoofed(self):
        self.client.force_authenticate(self.me)

        self.client.post(PLANS_URL, {'name': 'Week two', 'user': self.her.pk})

        self.assertEqual(MealPlan.objects.get(name='Week two').user, self.me)

    def test_a_list_shows_only_your_own_plans(self):
        self.client.force_authenticate(self.her)
        self.assertEqual(self.client.get(PLANS_URL).data['count'], 0)

        self.client.force_authenticate(self.me)
        self.assertEqual(self.client.get(PLANS_URL).data['count'], 1)

    def test_someone_elses_plan_is_a_404_not_a_403(self):
        """Scoping, not a permission class, is what hides the plan."""
        self.client.force_authenticate(self.her)

        response = self.client.get(f'{PLANS_URL}{self.plan.pk}/')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_plan_cannot_end_before_it_starts(self):
        self.client.force_authenticate(self.me)

        response = self.client.post(
            PLANS_URL,
            {
                'name': 'Backwards',
                'start_date': '2026-09-20',
                'end_date': '2026-09-14',
            },
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('end_date', response.data)

    def test_a_plan_may_be_saved_before_its_dates_are_known(self):
        """Draft-first, as for recipes: dates are optional at this stage."""
        self.client.force_authenticate(self.me)

        response = self.client.post(PLANS_URL, {'name': 'Someday'})

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_detail_carries_the_schedule_and_the_list_does_not(self):
        MealPlanEntry.objects.create(
            meal_plan=self.plan,
            recipe=self.my_published,
            day=dt.date(2026, 9, 15),
            meal_type=MealPlanEntry.MealType.DINNER,
        )
        self.client.force_authenticate(self.me)

        detail = self.client.get(f'{PLANS_URL}{self.plan.pk}/').data
        listed = self.client.get(PLANS_URL).data['results'][0]

        self.assertEqual(len(detail['entries']), 1)
        self.assertNotIn('entries', listed)


class MealPlanEntryApiTests(MealPlanTestCase):
    def test_an_entry_may_be_added_to_your_own_plan(self):
        self.client.force_authenticate(self.me)

        response = self.client.post(
            ENTRIES_URL,
            {
                'meal_plan': self.plan.pk,
                'recipe': self.my_published.pk,
                'day': '2026-09-15',
                'meal_type': 'dinner',
            },
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_an_entry_may_not_be_added_to_someone_elses_plan(self):
        """Entry privacy is inherited from the plan, not declared on the row."""
        self.client.force_authenticate(self.her)

        response = self.client.post(
            ENTRIES_URL,
            {
                'meal_plan': self.plan.pk,
                'recipe': self.her_published.pk,
                'day': '2026-09-15',
                'meal_type': 'dinner',
            },
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('meal_plan', response.data)
        self.assertFalse(MealPlanEntry.objects.exists())

    def test_scheduling_a_recipe_you_cannot_see_is_refused(self):
        self.client.force_authenticate(self.me)

        response = self.client.post(
            ENTRIES_URL,
            {
                'meal_plan': self.plan.pk,
                'recipe': self.her_draft.pk,
                'day': '2026-09-15',
                'meal_type': 'dinner',
            },
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('recipe', response.data)

    def test_a_day_outside_the_plan_is_refused(self):
        self.client.force_authenticate(self.me)

        response = self.client.post(
            ENTRIES_URL,
            {
                'meal_plan': self.plan.pk,
                'recipe': self.my_published.pk,
                'day': '2026-10-05',
                'meal_type': 'dinner',
            },
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('day', response.data)

    def test_the_same_recipe_twice_in_one_slot_is_refused(self):
        self.client.force_authenticate(self.me)
        payload = {
            'meal_plan': self.plan.pk,
            'recipe': self.my_published.pk,
            'day': '2026-09-15',
            'meal_type': 'dinner',
        }
        self.client.post(ENTRIES_URL, payload)

        response = self.client.post(ENTRIES_URL, payload)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(MealPlanEntry.objects.count(), 1)

    def test_two_different_dishes_may_share_a_slot(self):
        """The constraint is per recipe, not per slot - dinner can have two."""
        self.client.force_authenticate(self.me)
        for recipe in (self.my_published, self.her_published):
            response = self.client.post(
                ENTRIES_URL,
                {
                    'meal_plan': self.plan.pk,
                    'recipe': recipe.pk,
                    'day': '2026-09-15',
                    'meal_type': 'dinner',
                },
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        self.assertEqual(MealPlanEntry.objects.count(), 2)

    def test_someone_elses_entries_are_not_listed(self):
        """Entry privacy itself: the queryset scopes through meal_plan__user.

        Distinct from the create-side check above. Without this rule a
        registered user reads every schedule in the database, and no test that
        only exercises writes would notice.
        """
        MealPlanEntry.objects.create(
            meal_plan=self.plan,
            recipe=self.my_published,
            day=dt.date(2026, 9, 15),
            meal_type=MealPlanEntry.MealType.DINNER,
        )

        self.client.force_authenticate(self.her)
        self.assertEqual(self.client.get(ENTRIES_URL).data['count'], 0)

        self.client.force_authenticate(self.me)
        self.assertEqual(self.client.get(ENTRIES_URL).data['count'], 1)

    def test_someone_elses_entry_is_a_404_not_a_403(self):
        entry = MealPlanEntry.objects.create(
            meal_plan=self.plan,
            recipe=self.my_published,
            day=dt.date(2026, 9, 15),
            meal_type=MealPlanEntry.MealType.DINNER,
        )
        self.client.force_authenticate(self.her)

        response = self.client.get(f'{ENTRIES_URL}{entry.pk}/')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_someone_elses_entry_cannot_be_edited(self):
        entry = MealPlanEntry.objects.create(
            meal_plan=self.plan,
            recipe=self.my_published,
            day=dt.date(2026, 9, 15),
            meal_type=MealPlanEntry.MealType.DINNER,
        )
        self.client.force_authenticate(self.her)

        response = self.client.patch(
            f'{ENTRIES_URL}{entry.pk}/',
            {'meal_type': 'lunch'},
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        entry.refresh_from_db()
        self.assertEqual(entry.meal_type, MealPlanEntry.MealType.DINNER)

    def test_an_unpublished_recipe_drops_out_of_the_schedule(self):
        """Documented behaviour, not desired - see CLAUDE.md on schedule gaps.

        The row survives; only the read hides it. Asserted so a future change
        to that rule is a deliberate one rather than a silent regression.
        """
        MealPlanEntry.objects.create(
            meal_plan=self.plan,
            recipe=self.her_published,
            day=dt.date(2026, 9, 15),
            meal_type=MealPlanEntry.MealType.DINNER,
        )
        self.client.force_authenticate(self.me)
        self.assertEqual(self.client.get(ENTRIES_URL).data['count'], 1)

        self.her_published.status = Recipe.Status.DRAFT
        self.her_published.save(update_fields=['status'])

        self.assertEqual(self.client.get(ENTRIES_URL).data['count'], 0)
        self.assertEqual(MealPlanEntry.objects.count(), 1)


class GeneratorTests(MealPlanTestCase):
    def test_a_plan_without_dates_cannot_be_generated(self):
        undated = MealPlan.objects.create(user=self.me, name='Someday')
        self.client.force_authenticate(self.me)

        response = self.client.post(self.generate_url(undated))

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('start_date', response.data)

    def test_a_range_longer_than_a_month_is_refused(self):
        """Without a ceiling one request bulk-inserts tens of thousands."""
        long_plan = MealPlan.objects.create(
            user=self.me,
            name='All year',
            start_date=dt.date(2026, 1, 1),
            end_date=dt.date(2026, 12, 31),
        )
        self.client.force_authenticate(self.me)

        response = self.client.post(self.generate_url(long_plan))

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(MealPlanEntry.objects.exists())

    def test_generating_fills_every_slot_in_the_range(self):
        self.client.force_authenticate(self.me)

        response = self.client.post(self.generate_url())

        # 3 days x breakfast/lunch/dinner.
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(MealPlanEntry.objects.count(), 9)
        self.assertEqual(len(response.data['entries']), 9)

    def test_the_fill_is_round_robin_and_deterministic(self):
        """Ordered by recipe pk, so no seeding is needed to assert this."""
        self.client.force_authenticate(self.me)
        self.client.post(self.generate_url())

        first_day = MealPlanEntry.objects.filter(
            day=dt.date(2026, 9, 14),
        ).order_by('meal_plan_entry_id')

        self.assertEqual(
            [entry.recipe_id for entry in first_day],
            [
                self.my_published.pk,
                self.her_published.pk,
                self.my_published.pk,
            ],
        )

    def test_your_own_drafts_are_not_scheduled(self):
        """Saved recipes plus own *published* - a draft is not ready to cook."""
        self.client.force_authenticate(self.me)
        self.client.post(self.generate_url())

        scheduled = set(
            MealPlanEntry.objects.values_list('recipe_id', flat=True),
        )

        self.assertNotIn(self.my_draft.pk, scheduled)
        self.assertNotIn(self.her_draft.pk, scheduled)
        self.assertEqual(
            scheduled,
            {self.my_published.pk, self.her_published.pk},
        )

    def test_regenerating_leaves_existing_slots_alone(self):
        """Tops a plan up; never overwrites a hand-edited schedule."""
        mine = MealPlanEntry.objects.create(
            meal_plan=self.plan,
            recipe=self.her_published,
            day=dt.date(2026, 9, 14),
            meal_type=MealPlanEntry.MealType.BREAKFAST,
        )
        self.client.force_authenticate(self.me)

        self.client.post(self.generate_url())
        after_first = MealPlanEntry.objects.count()
        self.client.post(self.generate_url())

        self.assertEqual(MealPlanEntry.objects.count(), after_first)
        mine.refresh_from_db()
        self.assertEqual(mine.recipe_id, self.her_published.pk)

    def test_generating_with_nothing_to_draw_on_is_refused(self):
        stranger = User.objects.create_user(
            username='stranger',
            email='stranger@example.com',
            password='n0t-a-real-password',
            role=User.Role.REGISTERED,
        )
        empty_plan = MealPlan.objects.create(
            user=stranger,
            name='Nothing saved',
            start_date=dt.date(2026, 9, 14),
            end_date=dt.date(2026, 9, 16),
        )
        self.client.force_authenticate(stranger)

        response = self.client.post(self.generate_url(empty_plan))

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(MealPlanEntry.objects.exists())

    def test_requested_meal_types_are_honoured(self):
        self.client.force_authenticate(self.me)

        self.client.post(
            self.generate_url(),
            {'meal_types': ['dinner']},
            format='json',
        )

        self.assertEqual(MealPlanEntry.objects.count(), 3)
        self.assertEqual(
            set(MealPlanEntry.objects.values_list('meal_type', flat=True)),
            {'dinner'},
        )

    def test_an_unknown_meal_type_is_refused(self):
        self.client.force_authenticate(self.me)

        response = self.client.post(
            self.generate_url(),
            {'meal_types': ['brunch']},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('meal_types', response.data)
        self.assertFalse(MealPlanEntry.objects.exists())

    def test_you_cannot_generate_into_someone_elses_plan(self):
        self.client.force_authenticate(self.her)

        response = self.client.post(self.generate_url())

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(MealPlanEntry.objects.exists())


class NutritionApiTests(MealPlanTestCase):
    def test_guests_do_not_get_nutrition(self):
        """CLAUDE.md lists this under Registered Users, not Guests."""
        NutritionInfo.objects.create(recipe=self.her_published, calories=400)

        self.assertEqual(
            self.client.get(NUTRITION_URL).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_nutrition_for_an_invisible_recipe_is_hidden(self):
        """Otherwise it is a side channel onto somebody's draft."""
        NutritionInfo.objects.create(recipe=self.her_published, calories=400)
        NutritionInfo.objects.create(recipe=self.her_draft, calories=999)
        self.client.force_authenticate(self.me)

        response = self.client.get(NUTRITION_URL)

        self.assertEqual(response.data['count'], 1)
        self.assertEqual(
            response.data['results'][0]['recipe'],
            self.her_published.pk,
        )

    def test_nutrition_is_read_only(self):
        self.client.force_authenticate(self.me)

        response = self.client.post(
            NUTRITION_URL,
            {'recipe': self.my_published.pk, 'calories': '100'},
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )


class DeletionTests(TestCase):
    """The on_delete choices, which are invisible until they are wrong."""

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            username='planner',
            email='planner@example.com',
            password='n0t-a-real-password',
        )
        cls.recipe = Recipe.objects.create(user=cls.user, title='Adobo')
        cls.plan = MealPlan.objects.create(
            user=cls.user,
            name='Week one',
            start_date=dt.date(2026, 9, 14),
            end_date=dt.date(2026, 9, 16),
        )

    def _entry(self):
        return MealPlanEntry.objects.create(
            meal_plan=self.plan,
            recipe=self.recipe,
            day=dt.date(2026, 9, 15),
            meal_type=MealPlanEntry.MealType.DINNER,
        )

    def test_deleting_a_plans_owner_is_refused(self):
        """PROTECT: removing a user is a deactivation, so their plans stay."""
        with self.assertRaises(ProtectedError):
            self.user.delete()

        self.assertEqual(MealPlan.objects.count(), 1)

    def test_deleting_a_plan_takes_its_entries(self):
        self._entry()

        self.plan.delete()

        self.assertFalse(MealPlanEntry.objects.exists())

    def test_deleting_a_recipe_takes_its_entries_and_nutrition(self):
        self._entry()
        NutritionInfo.objects.create(recipe=self.recipe, calories=400)

        self.recipe.delete()

        self.assertFalse(MealPlanEntry.objects.exists())
        self.assertFalse(NutritionInfo.objects.exists())

    def test_a_recipe_has_at_most_one_nutrition_record(self):
        NutritionInfo.objects.create(recipe=self.recipe, calories=400)

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                NutritionInfo.objects.create(recipe=self.recipe, calories=999)

    def test_the_reverse_accessor_is_a_single_object(self):
        """OneToOne, so recipe.nutrition_info is the row, not a manager."""
        self.assertFalse(hasattr(self.recipe, 'nutrition_info'))

        NutritionInfo.objects.create(recipe=self.recipe, calories=400)
        self.recipe.refresh_from_db()

        self.assertEqual(self.recipe.nutrition_info.calories, 400)
