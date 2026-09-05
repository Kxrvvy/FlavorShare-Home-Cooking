"""Routes for the social app: follows, likes, comments, ratings."""

from rest_framework.routers import DefaultRouter

# from . import views

router = DefaultRouter()
# router.register(r'comments', views.CommentViewSet, basename='comment')

urlpatterns = router.urls
