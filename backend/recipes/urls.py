"""Routes for the recipes app: recipe CRUD, steps, ingredients and images.

Mounted under /api/recipes/ by backend/urls.py, so RecipeViewSet registers at
the empty prefix and the rest sit beside it:

    /api/recipes/                     recipes
    /api/recipes/<id>/publish/        publish a draft
    /api/recipes/<id>/unpublish/      back to draft
    /api/recipes/<id>/steps/reorder/  renumber steps
    /api/recipes/steps/               steps      (?recipe=<id>)
    /api/recipes/recipe-ingredients/  what a recipe calls for
    /api/recipes/images/              photos
    /api/recipes/ingredients/         the shared lookup table
"""

from rest_framework.routers import SimpleRouter

from . import views

# SimpleRouter rather than DefaultRouter, for the reason accounts/urls.py
# gives: DefaultRouter also registers an api-root view named 'api-root', and
# every app's router would collide on that name.
router = SimpleRouter()

# ORDER MATTERS. RecipeViewSet's detail route is ^(?P<pk>[^/.]+)/$, which
# happily matches "steps/" with pk="steps". The router tries patterns in
# registration order, so every named prefix has to be registered before the
# empty one or it is swallowed.
router.register(r'steps', views.StepViewSet, basename='step')
router.register(
    r'recipe-ingredients',
    views.RecipeIngredientViewSet,
    basename='recipe-ingredient',
)
router.register(r'images', views.ImageViewSet, basename='image')
router.register(r'ingredients', views.IngredientViewSet, basename='ingredient')
router.register(r'', views.RecipeViewSet, basename='recipe')

urlpatterns = router.urls
