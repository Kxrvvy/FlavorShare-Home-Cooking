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

`pending_reports` in DashboardTotalsSerializer used to be the one number this
docstring said could not be computed - "nothing in the ERD records that a
recipe or review was reported, so the number cannot be computed - only
invented." The Report model below is what changed that.
"""

from rest_framework import serializers

# The trimmed public view of a user - user_id and username only. The dashboard
# is admin-only so exposing more would not be a leak, but the feed has no use
# for an email address and reusing this keeps one definition of "a user, shown
# to someone else".
from recipes.serializers import RecipeAuthorSerializer as PublicUserSerializer

from .models import Activity, Report


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
    pending_reports = serializers.IntegerField()


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


class ReportSerializer(serializers.ModelSerializer):
    """A filed report, for both sides of ReportViewSet.

    `recipe` and `comment` stay plain writable primary keys - a registered
    user files a report by naming one of the two - and the three `*_title`
    / `*_content` fields alongside them are read-only context for the queue,
    so an admin is not left with a bare id and a second fetch to find out
    what was actually reported. `source='recipe.title'` etc. read straight
    through the (possibly null) relation; DRF's default kicks in instead of
    raising when the other side is the one actually set.
    """

    reporter = PublicUserSerializer(read_only=True)
    resolved_by = PublicUserSerializer(read_only=True)

    recipe_title = serializers.CharField(
        source='recipe.title', read_only=True, default=None,
    )
    comment_content = serializers.CharField(
        source='comment.content', read_only=True, default=None,
    )
    # So a report filed against a comment can still link to the recipe it
    # sits under - the queue has nowhere else to get that id from.
    comment_recipe = serializers.IntegerField(
        source='comment.recipe_id', read_only=True, default=None,
    )

    class Meta:
        model = Report
        fields = [
            'report_id',
            'reporter',
            'recipe',
            'recipe_title',
            'comment',
            'comment_content',
            'comment_recipe',
            'reason',
            'details',
            'status',
            'resolved_by',
            'resolved_at',
            'created_at',
        ]
        read_only_fields = ['status', 'resolved_by', 'resolved_at', 'created_at']

    def validate(self, attrs):
        recipe = attrs.get('recipe')
        comment = attrs.get('comment')
        if bool(recipe) == bool(comment):
            raise serializers.ValidationError(
                'Report exactly one recipe or one comment, not both or neither.'
            )
        return attrs
