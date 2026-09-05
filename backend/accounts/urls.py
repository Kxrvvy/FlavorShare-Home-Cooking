"""Routes for the accounts app: registration, profile, and account management.

Mounted under /api/accounts/ by backend/urls.py. Login and token refresh
live at the global /api/token/ routes, not here.
"""

from django.urls import path

from . import views

urlpatterns = [
    path('register/', views.RegisterView.as_view(), name='register'),
    path('me/', views.MeView.as_view(), name='me'),
]
