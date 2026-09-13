"""Routes for the accounts app: signup, verification, reset, profile, admin.

Mounted under /api/accounts/ by backend/urls.py. Login and token refresh live
at the global /api/token/ routes, not here.

Signup is two steps and the routes say so:

    register/            start a signup, emails a code (creates no account)
    verify-email/        prove the address, creates the account, returns tokens
    resend-otp/          email a fresh code for a signup still in progress

Password reset is its own pair, against accounts that already exist:

    password-reset/request/    emails a code
    password-reset/confirm/    sets the new password

The first five need no credentials - they are what somebody uses before they
have any - and are ordered above the authenticated routes to read in the order
a user meets them.
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
    # Signup, in the order they are used.
    path('register/', views.RegisterView.as_view(), name='register'),
    path(
        'verify-email/',
        views.VerifyEmailView.as_view(),
        name='verify-email',
    ),
    path('resend-otp/', views.ResendOTPView.as_view(), name='resend-otp'),

    # Password reset, for accounts that already exist.
    path(
        'password-reset/request/',
        views.PasswordResetRequestView.as_view(),
        name='password-reset-request',
    ),
    path(
        'password-reset/confirm/',
        views.PasswordResetConfirmView.as_view(),
        name='password-reset-confirm',
    ),

    # Signed-in actions.
    path('logout/', views.LogoutView.as_view(), name='logout'),
    path('password/', views.PasswordChangeView.as_view(), name='password-change'),
    path('me/', views.MeView.as_view(), name='me'),
] + router.urls
