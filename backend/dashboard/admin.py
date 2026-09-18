"""Django admin registration for the dashboard app.

Activity is a record of what happened. A hand-written entry would be a
falsified audit trail, and an edited one worse - the feed and the monthly chart
both read this table, so a doctored row quietly changes what the dashboard
reports. So add and change are refused outright rather than merely discouraged.

Deleting is left alone, deliberately. This is the one table here that grows
without bound, so pruning it is a real administrative need, and Activity.user
is PROTECT - if a spam account ever has to be removed rather than deactivated,
its log entries have to go first or the delete is refused. Neither is possible
if delete is closed too.

Report is the opposite case: a fallback way to work the queue from /admin/
while the custom page at /admin/reports is being built, so add stays closed
(reports are filed through the API, never invented here) but status/resolved_*
stay editable - resolving one is exactly the write this surface is for.
"""

from django.contrib import admin

from .models import Activity, Report


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    """Read-only admin for dashboard.Activity."""

    list_display = (
        'created_at',
        'user',
        'action_type',
        'recipe',
        'description',
    )
    list_filter = ('action_type',)
    search_fields = ('user__username', 'description', 'recipe__title')
    ordering = ('-created_at', '-activity_id')

    # The changelist shows the actor and the recipe on every row; without this
    # that is two extra queries per entry.
    list_select_related = ('user', 'recipe')

    # Date is the axis anyone reads a log along.
    date_hierarchy = 'created_at'

    # Every field, so the detail page renders as a readable record rather than
    # a form. Needed because refusing change permission alone would leave the
    # fields editable-looking to a superuser, who bypasses that check.
    readonly_fields = (
        'activity_id',
        'user',
        'recipe',
        'action_type',
        'description',
        'created_at',
    )

    def has_add_permission(self, request):
        """Entries come from signals.py, never from a person."""
        return False

    def has_change_permission(self, request, obj=None):
        """A record of events that can be rewritten is not a record.

        Returning False still allows the detail page to be opened and read -
        Django falls back to view permission - which is what makes this a log
        viewer rather than a locked door.
        """
        return False


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    """Admin for dashboard.Report - a stopgap moderation queue."""

    list_display = ('reporter', 'target', 'reason', 'status', 'created_at')
    list_filter = ('status', 'reason')
    search_fields = ('reporter__username', 'recipe__title', 'comment__content')
    ordering = ('-created_at',)
    list_select_related = ('reporter', 'recipe', 'comment', 'resolved_by')

    # Model.clean()'s exactly-one-target rule and Report.reporter both need to
    # be set at creation, which this surface has no form for - filing stays
    # the API's job, same reasoning as ActivityAdmin.has_add_permission.
    readonly_fields = ('reporter', 'recipe', 'comment', 'reason', 'details', 'created_at')

    def has_add_permission(self, request):
        return False

    def target(self, obj):
        return f'Recipe: {obj.recipe}' if obj.recipe_id else f'Comment on {obj.comment.recipe}'
