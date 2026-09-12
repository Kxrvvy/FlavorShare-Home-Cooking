"""Django admin registration for the dashboard app.

One model, and the only one in this project registered without write access.

Activity is a record of what happened. A hand-written entry would be a
falsified audit trail, and an edited one worse - the feed and the monthly chart
both read this table, so a doctored row quietly changes what the dashboard
reports. So add and change are refused outright rather than merely discouraged.

Deleting is left alone, deliberately. This is the one table here that grows
without bound, so pruning it is a real administrative need, and Activity.user
is PROTECT - if a spam account ever has to be removed rather than deactivated,
its log entries have to go first or the delete is refused. Neither is possible
if delete is closed too.
"""

from django.contrib import admin

from .models import Activity


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
