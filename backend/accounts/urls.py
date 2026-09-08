"""Routes for the accounts app: registration, profile, and account management.

Mounted under /api/accounts/ by backend/urls.py. Login and token refresh
live at the global /api/token/ routes, not here.
"""

from django.urls import path
from rest_framework.routers import SimpleRouter

from . import views

# SimpleRouter rather than DefaultRouter: DefaultRouter also registers an
# api-root view named 'api-root', which every other app's router would
# collide with.
router = SimpleRouter()
router.register(r'users', views.AdminUserViewSet, basename='admin-user')

urlpatterns = [
    path('register/', views.RegisterView.as_view(), name='register'),
    path('logout/', views.LogoutView.as_view(), name='logout'),
    path('password/', views.PasswordChangeView.as_view(), name='password-change'),
    path('me/', views.MeView.as_view(), name='me'),
] + router.urls
