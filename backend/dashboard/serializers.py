"""Serializers for the dashboard: the activity feed and the summary report.

Two kinds of thing live here, and only one is a ModelSerializer.

ActivitySerializer reads rows out of the one table this app owns. Every field is
read-only: the log is written by signals.py from events elsewhere, never by a
client, so there is no write shape to define.

The rest are plain Serializers over computed numbers - the stub in this file
suggested as much, and it is right. The summary reads across accounts, recipes,
social and meal_plans, so there is no single model to hang a ModelSerializer
on. They exist to name and type the payload rather than to validate input:
nothing here ever calls is_valid().

Deliberately absent from the summary: pending moderation. Feature 8 asks for it,
but nothing in the ERD records that a recipe or review was reported, so the
number cannot be computed - only invented. It stays an open item in CLAUDE.md
instead of a plausible-looking zero.
"""

from rest_framework import serializers

# The trimmed public view of a user - user_id and username only. The dashboard
# is admin-only so exposing more would not be a leak, but the feed has no use
# for an email address and reusing this keeps one definition of "a user, shown
# to someone else".
from recipes.serializers import RecipeAuthorSerializer as PublicUserSerializer

from .models import Activity


class ActivitySerializer(serializers.ModelSerializer):
    """One entry in the recent-activity feed.

    `recipe` may be null: the log keeps entries whose recipe has since been
    deleted, because the thing still happened. `description` already names the
    recipe as it was called at the time, which is what makes those rows
    readable afterwards.
    """

    user = PublicUserSerializer(read_only=True)

    class Meta:
        model = Activity
        fields = [
            'activity_id',
            'user',
            'recipe',
            'action_type',
            'description',
            'created_at',
        ]
        read_only_fields = fields


class DashboardTotalsSerializer(serializers.Serializer):
    """How much of everything there is."""

    users = serializers.IntegerField()
    recipes = serializers.IntegerField()
    published_recipes = serializers.IntegerField()
    draft_recipes = serializers.IntegerField()
    ratings = serializers.IntegerField()
    comments = serializers.IntegerField()
    saved_recipes = serializers.IntegerField()
    tags = serializers.IntegerField()
    meal_plans = serializers.IntegerField()
    activities = serializers.IntegerField()


class MostRatedRecipeSerializer(serializers.Serializer):
    """A recipe in the most-rated table, with the average it earned."""

    recipe_id = serializers.IntegerField()
    title = serializers.CharField()
    rating_count = serializers.IntegerField()
    average_score = serializers.FloatField()


class MostSavedRecipeSerializer(serializers.Serializer):
    """A recipe in the most-saved table."""

    recipe_id = serializers.IntegerField()
    title = serializers.CharField()
    save_count = serializers.IntegerField()


class MonthlyActivitySerializer(serializers.Serializer):
    """One point on the monthly activity chart.

    `month` is the first day of the month, not a formatted label - how it reads
    on an axis is the frontend's decision, and a date sorts correctly where
    "September 2026" does not.
    """

    month = serializers.DateField()
    count = serializers.IntegerField()


class DashboardSummarySerializer(serializers.Serializer):
    """Everything the dashboard page needs except the feed itself.

    The feed is /api/dashboard/activities/ rather than a slice embedded here.
    It is paginated and filterable, and serving the same rows from two code
    paths would mean two places to keep in agreement.
    """

    totals = DashboardTotalsSerializer()
    most_rated = MostRatedRecipeSerializer(many=True)
    most_saved = MostSavedRecipeSerializer(many=True)
    monthly_activity = MonthlyActivitySerializer(many=True)
