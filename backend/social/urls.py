"""Routes for the social app: ratings, comments, tags and saved recipes.

Mounted under /api/social/ by backend/urls.py:

    /api/social/ratings/       scores        (?recipe=<id>, ?user=<id>)
    /api/social/comments/      reviews       (?recipe=<id>, ?user=<id>)
    /api/social/recipe-tags/   a recipe's tags  (?recipe=<id>)
    /api/social/tags/          the shared lookup table, read-only
    /api/social/saved/         your own collection
"""

from rest_framework.routers import SimpleRouter

from . import views

# SimpleRouter rather than DefaultRouter, for the reason accounts/urls.py and
# recipes/urls.py both give: DefaultRouter also registers an api-root view
# named 'api-root', and every app's router would collide on that name.
router = SimpleRouter()

# Every prefix here is named, so none of them can swallow another the way
# recipes/urls.py warns about - that hazard comes from registering an empty
# prefix, which this app has no need for.
router.register(r'ratings', views.RatingViewSet, basename='rating')
router.register(r'comments', views.CommentViewSet, basename='comment')
router.register(r'recipe-tags', views.RecipeTagViewSet, basename='recipe-tag')
router.register(r'tags', views.TagViewSet, basename='tag')
router.register(r'saved', views.SavedRecipeViewSet, basename='saved-recipe')

urlpatterns = router.urls
