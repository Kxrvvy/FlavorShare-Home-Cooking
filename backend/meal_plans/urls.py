"""Routes for the meal_plans app: plans and their per-day recipe entries."""

from rest_framework.routers import DefaultRouter

# from . import views

router = DefaultRouter()
# router.register(r'', views.MealPlanViewSet, basename='meal-plan')

urlpatterns = router.urls
