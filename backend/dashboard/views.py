"""Views for the dashboard: the summary report and the activity feed.

Admin-only, both of them. CLAUDE.md puts "Access the Admin Dashboard &
Reporting" under Admin alone, so IsAdmin gates these outright rather than any
of the *OrReadOnly classes.

That is also why nothing here filters through recipes.views.visible_recipes().
Every other app scopes its querysets so a draft stays private; an admin is the
one caller visible_recipes() returns everything to, and a report that hid
drafts would undercount the thing it exists to measure. Worth being explicit
about, because the absence of that filter is otherwise indistinguishable from
forgetting it.

These reads reach across four apps. The dependency only points one way -
dashboard imports accounts, recipes, social and meal_plans, and none of them
imports dashboard.
"""

from django.contrib.auth import get_user_model
from django.db.models import Avg, Count, DateField
from django.db.models.functions import TruncMonth
from rest_framework import viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdmin
from meal_plans.models import MealPlan
from recipes.models import Recipe
from social.models import Comment, Rating, SavedRecipe, Tag

from .models import Activity
from .serializers import ActivitySerializer, DashboardSummarySerializer

User = get_user_model()

#: How many recipes each leaderboard returns. Short on purpose: these are cards
#: on a dashboard, not a browsable list - /api/recipes/ is where you go to page
#: through everything.
LEADERBOARD_SIZE = 5


class DashboardSummaryView(APIView):
    """GET /api/dashboard/summary/ - the numbers behind the dashboard page.

    One request for the whole page: totals, the two leaderboards, and the
    monthly activity series. The recent-activity feed is a separate, paginated
    endpoint - see ActivityViewSet.

    Roughly a dozen aggregate queries. Fine at this scale, and the first thing
    to cache if it ever stops being fine.
    """

    permission_classes = [IsAdmin]

    def _totals(self):
        return {
            'users': User.objects.count(),
            'recipes': Recipe.objects.count(),
            'published_recipes': Recipe.objects.filter(
                status=Recipe.Status.PUBLISHED,
            ).count(),
            'draft_recipes': Recipe.objects.filter(
                status=Recipe.Status.DRAFT,
            ).count(),
            'ratings': Rating.objects.count(),
            'comments': Comment.objects.count(),
            'saved_recipes': SavedRecipe.objects.count(),
            'tags': Tag.objects.count(),
            'meal_plans': MealPlan.objects.count(),
            'activities': Activity.objects.count(),
        }

    def _most_rated(self):
        """The most-rated recipes, with the average score each earned.

        Count and Avg traverse the same join here, so they agree. Adding a
        count of a *different* relation to this same annotate - saves, say -
        would multiply the rows and inflate both, which is why most_saved below
        is its own query rather than another column on this one.
        """
        return (
            Recipe.objects.annotate(
                rating_count=Count('ratings'),
                average_score=Avg('ratings__score'),
            )
            .filter(rating_count__gt=0)
            # recipe_id breaks ties so the table is stable between requests.
            .order_by('-rating_count', '-recipe_id')
            .values('recipe_id', 'title', 'rating_count', 'average_score')[
                :LEADERBOARD_SIZE
            ]
        )

    def _most_saved(self):
        return (
            Recipe.objects.annotate(save_count=Count('saved_by'))
            .filter(save_count__gt=0)
            .order_by('-save_count', '-recipe_id')
            .values('recipe_id', 'title', 'save_count')[:LEADERBOARD_SIZE]
        )

    def _monthly_activity(self):
        """Activity counts per month, oldest first.

        The trailing .order_by('month') is for the chart, not for the grouping:
        a series has to arrive in chronological order to be plotted straight
        through, and Activity.Meta.ordering is newest-first.

        Worth knowing, because older advice says otherwise: Meta.ordering used
        to be folded into the GROUP BY of a values().annotate() aggregation,
        which would have grouped by created_at and activity_id as well as by
        month and returned one row per activity. Django stopped doing that in
        3.1. The generated SQL here is GROUP BY 1 either way - verified - so no
        defensive .order_by() is needed to clear the default first.

        output_field is a DateField because TruncMonth over a DateTimeField
        returns a datetime by default, and DRF's DateField refuses to coerce
        one rather than quietly discarding the timezone. A month bucket is a
        date - saying so here keeps the payload '2026-09-01' instead of a
        midnight timestamp that invites being read as a real instant.
        """
        return (
            Activity.objects
            .annotate(
                month=TruncMonth('created_at', output_field=DateField()),
            )
            .values('month')
            .annotate(count=Count('activity_id'))
            .order_by('month')
        )

    def get(self, request):
        payload = {
            'totals': self._totals(),
            'most_rated': list(self._most_rated()),
            'most_saved': list(self._most_saved()),
            'monthly_activity': list(self._monthly_activity()),
        }

        # Serialized rather than returned raw so the payload's shape is declared
        # in one place and the types are whatever the serializer says - a
        # DecimalField average would otherwise reach the frontend as a string
        # from MySQL and as a float from SQLite.
        return Response(DashboardSummarySerializer(payload).data)


class ActivityViewSet(viewsets.ReadOnlyModelViewSet):
    """/api/dashboard/activities/ - the recent-activity feed.

    Filter with ?action_type=posted or ?user=<id>. Newest first, from
    Activity.Meta.ordering, which carries a unique tiebreaker so paging cannot
    repeat or skip a row.

    Read-only, and not merely by convention: rows are written by signals.py
    when something happens. A hand-written entry would be a falsified record of
    events, so there is no create route to misuse.
    """

    serializer_class = ActivitySerializer
    permission_classes = [IsAdmin]

    filterset_fields = ['action_type', 'user']

    def get_queryset(self):
        # The serializer nests the actor, and recipe is shown per row; without
        # this a page of 20 costs 40 extra queries.
        return Activity.objects.select_related('user', 'recipe')
