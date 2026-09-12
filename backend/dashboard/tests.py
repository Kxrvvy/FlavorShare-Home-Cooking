"""Tests for the dashboard app: the Activity log, its signals, and the reports.

The breadth pass, so this is not the coverage recipes/tests.py has. It is
weighted toward the things that would fail silently:

- which events log and which deliberately do not. A receiver that stops firing
  leaves a feed that merely looks quiet, and one that fires too often is only
  noticeable once the chart is wrong;
- the monthly aggregation's GROUP BY, which produces one bucket per row instead
  of per month if the queryset's default ordering is not cleared first - a bug
  that reads as "the chart has a lot of points";
- the two leaderboards being separate queries. Counting two different relations
  in one annotate() multiplies the rows and inflates both;
- access control, since this app exposes every draft in the database to whoever
  gets through it;
- the on_delete pair, where SET_NULL on recipe is what lets the log outlive its
  subject.

Left for the depth pass: pagination edges, filter combinations, and the report
shapes beyond the numbers asserted here.
"""

import datetime as dt

from django.contrib.auth import get_user_model
from django.db.models import F, ProtectedError
from django.db.models.signals import post_save
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from meal_plans.models import MealPlan, MealPlanEntry
from recipes.models import Recipe
from social.models import Comment, Rating, SavedRecipe

from .models import Activity

User = get_user_model()

SUMMARY_URL = '/api/dashboard/summary/'
ACTIVITIES_URL = '/api/dashboard/activities/'


class ActivityTestCase(TestCase):
    """An author and an onlooker, with nothing published yet.

    Recipes are created as drafts on purpose: publishing is an event, so a test
    that wants a clean log has to start from something that has not happened.
    """

    @classmethod
    def setUpTestData(cls):
        cls.author = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password='n0t-a-real-password',
            role=User.Role.REGISTERED,
        )
        cls.fan = User.objects.create_user(
            username='eater',
            email='eater@example.com',
            password='n0t-a-real-password',
            role=User.Role.REGISTERED,
        )
        cls.recipe = Recipe.objects.create(
            user=cls.author,
            title='Adobo',
            status=Recipe.Status.DRAFT,
        )

    def publish(self, recipe=None):
        recipe = recipe or self.recipe
        recipe.status = Recipe.Status.PUBLISHED
        recipe.save()
        return recipe


class RecipeSignalTests(ActivityTestCase):
    def test_creating_a_draft_logs_nothing(self):
        """A draft is private; a feed of them is noise and a disclosure."""
        self.assertFalse(Activity.objects.exists())

    def test_publishing_logs_posted(self):
        self.publish()

        entry = Activity.objects.get()
        self.assertEqual(entry.action_type, Activity.ActionType.POSTED)
        self.assertEqual(entry.user, self.author)
        self.assertEqual(entry.recipe, self.recipe)
        self.assertIn('Adobo', entry.description)

    def test_editing_a_published_recipe_logs_edited(self):
        self.publish()
        self.recipe.title = 'Chicken adobo'
        self.recipe.save()

        self.assertEqual(
            list(
                Activity.objects.order_by('activity_id').values_list(
                    'action_type',
                    flat=True,
                )
            ),
            [Activity.ActionType.POSTED, Activity.ActionType.EDITED],
        )

    def test_editing_a_draft_logs_nothing(self):
        self.recipe.title = 'Still a draft'
        self.recipe.save()

        self.assertFalse(Activity.objects.exists())

    def test_unpublishing_logs_nothing(self):
        """Documented gap, not an oversight.

        Unpublishing is this project's soft moderation action, and none of the
        ERD's five action types describes it - see the open item in CLAUDE.md.
        Asserted so that adding a sixth type is a deliberate change rather than
        something that silently alters the feed.
        """
        self.publish()
        Activity.objects.all().delete()

        self.recipe.status = Recipe.Status.DRAFT
        self.recipe.save()

        self.assertFalse(Activity.objects.exists())

    def test_a_view_does_not_log(self):
        """view_count is bumped with queryset .update(), which fires nothing.

        Recipe.view_count already counts views, and one entry per page view
        would bury every real event in the feed.
        """
        self.publish()
        Activity.objects.all().delete()

        Recipe.objects.filter(pk=self.recipe.pk).update(
            view_count=F('view_count') + 1,
        )

        self.assertFalse(Activity.objects.exists())

    def test_a_fixture_load_does_not_log(self):
        """raw=True means rows are being restored, not happening."""
        post_save.send(
            sender=Comment,
            instance=Comment(
                recipe=self.recipe,
                user=self.fan,
                content='x',
            ),
            created=True,
            raw=True,
        )

        self.assertFalse(Activity.objects.exists())


class SocialSignalTests(ActivityTestCase):
    def setUp(self):
        self.publish()
        Activity.objects.all().delete()

    def test_a_review_logs_commented(self):
        Comment.objects.create(
            recipe=self.recipe,
            user=self.fan,
            content='Needs more vinegar.',
        )

        entry = Activity.objects.get()
        self.assertEqual(entry.action_type, Activity.ActionType.COMMENTED)
        self.assertEqual(entry.user, self.fan)

    def test_a_rating_logs_rated_with_its_score(self):
        Rating.objects.create(recipe=self.recipe, user=self.fan, score=4)

        entry = Activity.objects.get()
        self.assertEqual(entry.action_type, Activity.ActionType.RATED)
        self.assertIn('4/5', entry.description)

    def test_changing_a_rating_logs_nothing_further(self):
        """One row per person per recipe; revisions would let one user flood."""
        rating = Rating.objects.create(
            recipe=self.recipe,
            user=self.fan,
            score=4,
        )
        Activity.objects.all().delete()

        rating.score = 5
        rating.save()

        self.assertFalse(Activity.objects.exists())

    def test_saving_a_recipe_logs_saved(self):
        SavedRecipe.objects.create(user=self.fan, recipe=self.recipe)

        self.assertEqual(
            Activity.objects.get().action_type,
            Activity.ActionType.SAVED,
        )


class BulkCreateTests(ActivityTestCase):
    """A generated meal plan is one act, not twenty-one events."""

    def test_bulk_create_fires_no_signals(self):
        self.publish()
        Activity.objects.all().delete()
        plan = MealPlan.objects.create(
            user=self.fan,
            name='Week one',
            start_date=dt.date(2026, 9, 14),
            end_date=dt.date(2026, 9, 16),
        )

        MealPlanEntry.objects.bulk_create([
            MealPlanEntry(
                meal_plan=plan,
                recipe=self.recipe,
                day=dt.date(2026, 9, 14 + offset),
                meal_type=MealPlanEntry.MealType.DINNER,
            )
            for offset in range(3)
        ])

        self.assertEqual(MealPlanEntry.objects.count(), 3)
        self.assertFalse(Activity.objects.exists())

    def test_the_generator_endpoint_logs_nothing(self):
        """The real path, not just the mechanism underneath it."""
        self.publish()
        SavedRecipe.objects.create(user=self.fan, recipe=self.recipe)
        plan = MealPlan.objects.create(
            user=self.fan,
            name='Week one',
            start_date=dt.date(2026, 9, 14),
            end_date=dt.date(2026, 9, 16),
        )
        Activity.objects.all().delete()

        # APIClient, not self.client: this is a plain TestCase, and
        # DEFAULT_AUTHENTICATION_CLASSES is JWT only - no SessionAuthentication -
        # so force_login() would leave the request anonymous and answer 401.
        client = APIClient()
        client.force_authenticate(self.fan)
        response = client.post(f'/api/meal-plans/{plan.pk}/generate/')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(MealPlanEntry.objects.count(), 9)
        self.assertFalse(Activity.objects.exists())


class ActivityModelTests(ActivityTestCase):
    def test_deleting_a_recipe_keeps_the_entry_and_nulls_the_recipe(self):
        """SET_NULL: the recipe is gone, but it still happened.

        The description keeps the title as it was, which is what makes an
        orphaned entry readable afterwards.
        """
        self.publish()

        self.recipe.delete()

        entry = Activity.objects.get()
        self.assertIsNone(entry.recipe)
        self.assertIn('Adobo', entry.description)

    def test_deleting_the_actor_is_refused(self):
        """PROTECT, like every user FK here: a removal is a deactivation."""
        self.publish()

        with self.assertRaises(ProtectedError):
            self.author.delete()

        self.assertEqual(Activity.objects.count(), 1)

    def test_ordering_carries_a_unique_tiebreaker(self):
        """created_at is not unique, so paging needs activity_id to be stable."""
        self.assertEqual(
            Activity._meta.ordering,
            ['-created_at', '-activity_id'],
        )


class DashboardAccessTests(APITestCase):
    """This app exposes every draft in the database, so the gate matters."""

    @classmethod
    def setUpTestData(cls):
        cls.guest_visible = None
        cls.registered = User.objects.create_user(
            username='eater',
            email='eater@example.com',
            password='n0t-a-real-password',
            role=User.Role.REGISTERED,
        )
        cls.boss = User.objects.create_user(
            username='moderator',
            email='mod@example.com',
            password='n0t-a-real-password',
            role=User.Role.ADMIN,
        )

    def test_guests_are_turned_away(self):
        for url in (SUMMARY_URL, ACTIVITIES_URL):
            with self.subTest(url=url):
                self.assertEqual(
                    self.client.get(url).status_code,
                    status.HTTP_401_UNAUTHORIZED,
                )

    def test_registered_users_are_forbidden(self):
        """Reporting is Admin-only in CLAUDE.md, not a signed-in perk."""
        self.client.force_authenticate(self.registered)

        for url in (SUMMARY_URL, ACTIVITIES_URL):
            with self.subTest(url=url):
                self.assertEqual(
                    self.client.get(url).status_code,
                    status.HTTP_403_FORBIDDEN,
                )

    def test_admins_are_let_through(self):
        self.client.force_authenticate(self.boss)

        for url in (SUMMARY_URL, ACTIVITIES_URL):
            with self.subTest(url=url):
                self.assertEqual(
                    self.client.get(url).status_code,
                    status.HTTP_200_OK,
                )

    def test_the_feed_is_read_only(self):
        self.client.force_authenticate(self.boss)

        response = self.client.post(
            ACTIVITIES_URL,
            {'action_type': 'posted', 'description': 'forged'},
        )

        self.assertEqual(
            response.status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )


class ReportTestCase(APITestCase):
    """Known data with known answers, so the numbers can be asserted exactly.

    `one` gets two ratings (5 and 3, averaging 4.0) and two saves; `two` gets
    one rating and one save. `hidden` stays a draft so the totals can be
    checked against it.
    """

    @classmethod
    def setUpTestData(cls):
        cls.boss = User.objects.create_user(
            username='moderator',
            email='mod@example.com',
            password='n0t-a-real-password',
            role=User.Role.ADMIN,
        )
        cls.author = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password='n0t-a-real-password',
            role=User.Role.REGISTERED,
        )
        cls.fan = User.objects.create_user(
            username='eater',
            email='eater@example.com',
            password='n0t-a-real-password',
            role=User.Role.REGISTERED,
        )

        cls.one = Recipe.objects.create(
            user=cls.author,
            title='Adobo',
            status=Recipe.Status.PUBLISHED,
        )
        cls.two = Recipe.objects.create(
            user=cls.author,
            title='Sinigang',
            status=Recipe.Status.PUBLISHED,
        )
        cls.hidden = Recipe.objects.create(
            user=cls.author,
            title='Unfinished lumpia',
            status=Recipe.Status.DRAFT,
        )

        Rating.objects.create(recipe=cls.one, user=cls.fan, score=5)
        Rating.objects.create(recipe=cls.one, user=cls.boss, score=3)
        Rating.objects.create(recipe=cls.two, user=cls.fan, score=4)
        Comment.objects.create(
            recipe=cls.one,
            user=cls.fan,
            content='Lovely.',
        )
        SavedRecipe.objects.create(user=cls.fan, recipe=cls.one)
        SavedRecipe.objects.create(user=cls.boss, recipe=cls.one)
        SavedRecipe.objects.create(user=cls.fan, recipe=cls.two)

    def summary(self):
        self.client.force_authenticate(self.boss)
        return self.client.get(SUMMARY_URL).data


class SummaryReportTests(ReportTestCase):
    def test_totals_are_counted(self):
        totals = self.summary()['totals']

        self.assertEqual(totals['users'], 3)
        self.assertEqual(totals['recipes'], 3)
        self.assertEqual(totals['published_recipes'], 2)
        self.assertEqual(totals['ratings'], 3)
        self.assertEqual(totals['comments'], 1)
        self.assertEqual(totals['saved_recipes'], 3)

    def test_drafts_are_counted_rather_than_filtered_out(self):
        """No visible_recipes() here, deliberately.

        An admin is the one caller that filter returns everything to, and a
        report that hid drafts would undercount what it exists to measure.
        """
        self.assertEqual(self.summary()['totals']['draft_recipes'], 1)

    def test_most_rated_carries_counts_and_averages(self):
        most_rated = self.summary()['most_rated']

        self.assertEqual(most_rated[0]['title'], 'Adobo')
        self.assertEqual(most_rated[0]['rating_count'], 2)
        self.assertEqual(most_rated[0]['average_score'], 4.0)
        self.assertEqual(most_rated[1]['rating_count'], 1)

    def test_the_average_is_a_number_not_a_string(self):
        """MySQL hands back a Decimal; the serializer's FloatField settles it."""
        self.assertIsInstance(
            self.summary()['most_rated'][0]['average_score'],
            float,
        )

    def test_most_saved_counts_saves_not_ratings(self):
        """Separate queries, so neither count inflates the other.

        `one` has 2 ratings and 2 saves, `two` has 1 of each. Counting both
        relations in one annotate() would multiply the joins and report 4 and 1.
        """
        most_saved = self.summary()['most_saved']

        self.assertEqual(most_saved[0]['title'], 'Adobo')
        self.assertEqual(most_saved[0]['save_count'], 2)
        self.assertEqual(most_saved[1]['save_count'], 1)

    def test_unrated_recipes_stay_off_the_leaderboards(self):
        titles = [row['title'] for row in self.summary()['most_rated']]

        self.assertNotIn('Unfinished lumpia', titles)

    def test_monthly_activity_groups_by_month(self):
        """The aggregation returns one row per month, not one per activity.

        Two entries are backdated so a correct answer has two buckets while a
        broken aggregation has as many buckets as there are rows - a failure
        that otherwise reads as "the chart has a lot of points".

        Asserts the outcome rather than the mechanism on purpose. An earlier
        version of this held a defensive .order_by() to stop Meta.ordering
        leaking into the GROUP BY; Django has not done that since 3.1, so the
        guard was removed and this test is what confirms the grouping is still
        right without it.
        """
        backdated = list(
            Activity.objects.order_by('activity_id').values_list(
                'pk',
                flat=True,
            )
        )[:2]
        Activity.objects.filter(pk__in=backdated).update(
            created_at=dt.datetime(2026, 7, 4, 12, 0, tzinfo=dt.timezone.utc),
        )

        summary = self.summary()
        monthly = summary['monthly_activity']
        total = summary['totals']['activities']

        self.assertGreater(total, 2)
        self.assertEqual(len(monthly), 2)
        self.assertEqual(sum(row['count'] for row in monthly), total)
        # Oldest first, so a chart can plot it straight through.
        self.assertEqual(monthly[0]['month'], '2026-07-01')
        self.assertEqual(monthly[0]['count'], 2)


class ActivityFeedTests(ReportTestCase):
    def feed(self, query=''):
        self.client.force_authenticate(self.boss)
        return self.client.get(f'{ACTIVITIES_URL}{query}').data

    def test_the_feed_lists_every_logged_event(self):
        feed = self.feed()

        self.assertEqual(feed['count'], Activity.objects.count())

    def test_the_feed_is_newest_first(self):
        results = self.feed()['results']

        self.assertEqual(
            [row['created_at'] for row in results],
            sorted((row['created_at'] for row in results), reverse=True),
        )

    def test_the_feed_filters_by_action_type(self):
        self.assertEqual(self.feed('?action_type=rated')['count'], 3)
        self.assertEqual(self.feed('?action_type=commented')['count'], 1)

    def test_the_feed_filters_by_user(self):
        # The fan rated twice, reviewed once and saved twice.
        self.assertEqual(self.feed(f'?user={self.fan.pk}')['count'], 5)

    def test_the_actor_is_nested_without_their_email(self):
        """Admin-only is not a reason to hand out addresses the feed cannot use."""
        actor = self.feed()['results'][0]['user']

        self.assertEqual(sorted(actor), ['user_id', 'username'])
