"""Routes for the dashboard app: the summary report and the activity feed.

Mounted under /api/dashboard/ by backend/urls.py:

    /api/dashboard/summary/      totals, leaderboards, monthly chart
    /api/dashboard/activities/   the recent-activity feed  (?action_type=, ?user=)
    /api/dashboard/reports/      the moderation queue  (?status=, ?reason=)

The first two are admin-only. reports/ opens POST to any registered user -
see ReportViewSet.get_permissions - everything else on it stays admin-only.

A path() alongside router.urls, the way accounts/urls.py mixes them: the summary
is a single computed report over four apps, not a collection with detail routes,
so an APIView fits it and a viewset would not. There is no empty prefix
registered here, so the ordering hazard recipes/urls.py warns about does not
arise.
"""

from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

# SimpleRouter rather than DefaultRouter, for the reason every other app's
# urls.py gives: DefaultRouter also registers an api-root view named
# 'api-root', and every app's router would collide on that name.
router = SimpleRouter()
router.register(r'activities', views.ActivityViewSet, basename='activity')
router.register(r'reports', views.ReportViewSet, basename='report')

urlpatterns = [
    path(
        'summary/',
        views.DashboardSummaryView.as_view(),
        name='dashboard-summary',
    ),
] + router.urls
