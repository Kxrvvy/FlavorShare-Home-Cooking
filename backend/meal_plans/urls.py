"""Routes for the meal_plans app: plans, their entries, and nutrition facts.

Mounted under /api/meal-plans/ by backend/urls.py, so MealPlanViewSet registers
at the empty prefix and the rest sit beside it:

    /api/meal-plans/                    your plans
    /api/meal-plans/<id>/generate/      fill the schedule
    /api/meal-plans/entries/            slots      (?meal_plan=<id>, ?day=, ?meal_type=)
    /api/meal-plans/nutrition/          macros per recipe, read-only
"""

from rest_framework.routers import SimpleRouter

from . import views

# SimpleRouter rather than DefaultRouter, for the reason every other app's
# urls.py gives: DefaultRouter also registers an api-root view named
# 'api-root', and every app's router would collide on that name.
router = SimpleRouter()

# ORDER MATTERS, the same way it does in recipes/urls.py. MealPlanViewSet's
# detail route is ^(?P<pk>[^/.]+)/$, which happily matches "entries/" with
# pk="entries". The router tries patterns in registration order, so every named
# prefix has to be registered before the empty one or it is swallowed.
router.register(r'entries', views.MealPlanEntryViewSet, basename='meal-plan-entry')
router.register(r'nutrition', views.NutritionInfoViewSet, basename='nutrition-info')
router.register(r'', views.MealPlanViewSet, basename='meal-plan')

urlpatterns = router.urls
