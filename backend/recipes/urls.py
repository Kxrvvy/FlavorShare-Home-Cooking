"""Routes for the recipes app: recipe CRUD, ingredients, steps, categories."""

from rest_framework.routers import DefaultRouter

# from . import views

router = DefaultRouter()
# router.register(r'', views.RecipeViewSet, basename='recipe')

urlpatterns = router.urls
