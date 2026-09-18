"""Tests for the role model, the shared permissions, and the signup flow.

Two groups live here.

The permission classes are the security boundary for the whole project - every
other app imports accounts.permissions - so the failure cases matter more than
the success ones. Those are exercised directly against a request rather than
through a live endpoint.

The signup, verification and password-reset tests are weighted the same way,
because the things that would fail silently are all failures: a code that
outlives its expiry, a pending row that survives a rejected email and blocks
the next attempt, an account created before its address was proven, a password
double-hashed into one nobody can use, a session that survives the reset meant
to end it.

Brevo's send_transac_email is mocked throughout. The suite must never send mail
or need a real API key - a green run says nothing about whether BREVO_API_KEY
works, the same caveat recipes/tests.py carries about Cloudinary.
"""

from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from brevo.core import ApiError
from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.contrib.auth.models import AnonymousUser
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIRequestFactory, APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from .models import (
    OTP_LENGTH,
    OTP_TTL,
    OneTimeCode,
    PendingSignup,
    User,
    generate_otp_code,
)
from .permissions import (
    IsAdmin,
    IsOwnerOrReadOnly,
    IsRegisteredUser,
    IsRegisteredUserOrReadOnly,
)

PASSWORD = 'n0t-a-real-password'
NEW_PASSWORD = 'als0-n0t-a-real-one'


class PermissionTestCase(TestCase):
    """One account per role, plus a helper for building requests."""

    factory = APIRequestFactory()

    @classmethod
    def setUpTestData(cls):
        cls.registered = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password='n0t-a-real-password',
        )
        cls.other = User.objects.create_user(
            username='someone-else',
            email='else@example.com',
            password='n0t-a-real-password',
        )
        cls.admin = User.objects.create_user(
            username='boss',
            email='boss@example.com',
            password='n0t-a-real-password',
            role=User.Role.ADMIN,
        )
        # Should never occur in practice - signup always defaults to
        # 'registered' - but the role exists, so the guard is tested.
        cls.guest = User.objects.create_user(
            username='lurker',
            email='lurker@example.com',
            password='n0t-a-real-password',
            role=User.Role.GUEST,
        )

    def make_request(self, method='get', user=None):
        request = getattr(self.factory, method)('/')
        request.user = user if user is not None else AnonymousUser()
        return request


class IsAdminTests(PermissionTestCase):
    permission = IsAdmin()

    def test_admin_allowed(self):
        request = self.make_request(user=self.admin)
        self.assertTrue(self.permission.has_permission(request, None))

    def test_superuser_allowed_regardless_of_role(self):
        self.registered.is_superuser = True
        request = self.make_request(user=self.registered)
        self.assertTrue(self.permission.has_permission(request, None))

    def test_registered_user_denied(self):
        request = self.make_request(user=self.registered)
        self.assertFalse(self.permission.has_permission(request, None))

    def test_anonymous_denied_without_error(self):
        """Anonymous users must be denied, not crash on a missing `role`."""
        request = self.make_request()
        self.assertFalse(self.permission.has_permission(request, None))


class IsRegisteredUserTests(PermissionTestCase):
    permission = IsRegisteredUser()

    def test_registered_allowed(self):
        request = self.make_request(user=self.registered)
        self.assertTrue(self.permission.has_permission(request, None))

    def test_admin_allowed(self):
        request = self.make_request(user=self.admin)
        self.assertTrue(self.permission.has_permission(request, None))

    def test_guest_role_denied(self):
        request = self.make_request(user=self.guest)
        self.assertFalse(self.permission.has_permission(request, None))

    def test_anonymous_denied_on_read(self):
        request = self.make_request(user=None)
        self.assertFalse(self.permission.has_permission(request, None))


class IsRegisteredUserOrReadOnlyTests(PermissionTestCase):
    permission = IsRegisteredUserOrReadOnly()

    def test_anonymous_may_read(self):
        """Guest Users browsing recipes - the whole point of this class."""
        request = self.make_request('get')
        self.assertTrue(self.permission.has_permission(request, None))

    def test_anonymous_may_not_write(self):
        request = self.make_request('post')
        self.assertFalse(self.permission.has_permission(request, None))

    def test_guest_role_may_not_write(self):
        request = self.make_request('post', user=self.guest)
        self.assertFalse(self.permission.has_permission(request, None))

    def test_registered_may_write(self):
        request = self.make_request('post', user=self.registered)
        self.assertTrue(self.permission.has_permission(request, None))


class IsOwnerOrReadOnlyTests(PermissionTestCase):
    permission = IsOwnerOrReadOnly()

    def owned_by(self, user, field='user'):
        """Stand-in for a Recipe/Comment/Image until those models exist."""
        return SimpleNamespace(**{field: user})

    def test_anyone_may_read_someone_elses_object(self):
        request = self.make_request('get')
        obj = self.owned_by(self.registered)
        self.assertTrue(
            self.permission.has_object_permission(request, None, obj)
        )

    def test_owner_may_write(self):
        request = self.make_request('patch', user=self.registered)
        obj = self.owned_by(self.registered)
        self.assertTrue(
            self.permission.has_object_permission(request, None, obj)
        )

    def test_non_owner_may_not_write(self):
        request = self.make_request('patch', user=self.other)
        obj = self.owned_by(self.registered)
        self.assertFalse(
            self.permission.has_object_permission(request, None, obj)
        )

    def test_anonymous_may_not_write(self):
        request = self.make_request('patch')
        obj = self.owned_by(self.registered)
        self.assertFalse(
            self.permission.has_object_permission(request, None, obj)
        )

    def test_view_may_rename_the_owner_field(self):
        """Image uses uploaded_by rather than user."""
        view = SimpleNamespace(owner_field='uploaded_by')
        request = self.make_request('patch', user=self.registered)
        obj = self.owned_by(self.registered, field='uploaded_by')
        self.assertTrue(
            self.permission.has_object_permission(request, view, obj)
        )

    def test_missing_owner_field_fails_closed(self):
        """A typo in owner_field must deny everyone, not allow everyone."""
        view = SimpleNamespace(owner_field='typo')
        request = self.make_request('patch', user=self.registered)
        obj = self.owned_by(self.registered)
        self.assertFalse(
            self.permission.has_object_permission(request, view, obj)
        )

    def test_admin_may_moderate_when_composed_with_is_admin(self):
        """The documented moderation rule: IsOwnerOrReadOnly | IsAdmin."""
        composed = (IsOwnerOrReadOnly | IsAdmin)()
        request = self.make_request('delete', user=self.admin)
        obj = self.owned_by(self.registered)
        self.assertTrue(
            composed.has_object_permission(request, None, obj)
        )

    def test_composition_still_blocks_an_unrelated_user(self):
        composed = (IsOwnerOrReadOnly | IsAdmin)()
        request = self.make_request('delete', user=self.other)
        obj = self.owned_by(self.registered)
        self.assertFalse(
            composed.has_object_permission(request, None, obj)
        )


class IsAdminPropertyTests(PermissionTestCase):
    """User.is_admin is what every admin check reads - verify it directly."""

    def test_admin_role(self):
        self.assertTrue(self.admin.is_admin)

    def test_registered_role(self):
        self.assertFalse(self.registered.is_admin)

    def test_superuser(self):
        self.registered.is_superuser = True
        self.assertTrue(self.registered.is_admin)

    def test_is_staff_follows_is_admin(self):
        self.assertTrue(self.admin.is_staff)
        self.assertFalse(self.registered.is_staff)


class AdminPermissionTests(PermissionTestCase):
    """What an Admin-role account may actually do inside the Django admin.

    is_staff only opens the door. These are the checks the admin runs for
    every model page and every sidebar entry, and PermissionsMixin answers
    them from the permissions tables - which an Admin-role account has no
    rows in.
    """

    def test_admin_holds_every_permission(self):
        self.assertTrue(self.admin.has_perm('recipes.view_recipe'))
        self.assertTrue(self.admin.has_perm('recipes.delete_recipe'))
        self.assertTrue(self.admin.has_perm('accounts.change_user'))

    def test_admin_sees_every_app(self):
        self.assertTrue(self.admin.has_module_perms('recipes'))
        self.assertTrue(self.admin.has_module_perms('accounts'))

    def test_registered_user_holds_none(self):
        self.assertFalse(self.registered.has_perm('recipes.view_recipe'))
        self.assertFalse(self.registered.has_module_perms('recipes'))

    def test_guest_role_holds_none(self):
        self.assertFalse(self.guest.has_perm('recipes.view_recipe'))
        self.assertFalse(self.guest.has_module_perms('recipes'))

    def test_a_deactivated_admin_holds_none(self):
        """Removal is a deactivation, so the role alone must not be enough."""
        self.admin.is_active = False

        self.assertFalse(self.admin.has_perm('recipes.view_recipe'))
        self.assertFalse(self.admin.has_module_perms('recipes'))

    def test_superuser_is_unaffected(self):
        self.registered.is_superuser = True

        self.assertTrue(self.registered.has_perm('recipes.view_recipe'))
        self.assertTrue(self.registered.has_module_perms('recipes'))


class AdminSiteAccessTests(TestCase):
    """The 403 this fixes, exercised against the real admin site."""

    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            username='boss',
            email='boss@example.com',
            password='n0t-a-real-password',
            role=User.Role.ADMIN,
        )
        cls.registered = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password='n0t-a-real-password',
        )

    def test_admin_role_reaches_the_index(self):
        self.client.force_login(self.admin)
        response = self.client.get(reverse('admin:index'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_admin_role_may_open_a_model_page(self):
        """This returned 403 before has_perm was overridden."""
        self.client.force_login(self.admin)
        response = self.client.get(
            reverse('admin:recipes_recipe_changelist')
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_admin_role_may_open_the_user_page(self):
        self.client.force_login(self.admin)
        response = self.client.get(reverse('admin:accounts_user_changelist'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_a_registered_user_is_bounced_to_the_login_screen(self):
        """Not staff, so the admin never even asks about permissions."""
        self.client.force_login(self.registered)
        response = self.client.get(
            reverse('admin:recipes_recipe_changelist')
        )
        self.assertEqual(response.status_code, status.HTTP_302_FOUND)

    def test_a_deactivated_admin_cannot_log_in(self):
        self.admin.is_active = False
        self.admin.save(update_fields=['is_active'])

        self.assertFalse(self.client.login(
            username='boss', password='n0t-a-real-password'
        ))


class LogoutTests(APITestCase):
    """POST /api/accounts/logout/ and the refresh-rotation rules behind it."""

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password='n0t-a-real-password',
        )
        cls.other = User.objects.create_user(
            username='someone-else',
            email='else@example.com',
            password='n0t-a-real-password',
        )

    def logout(self, data):
        return self.client.post(reverse('logout'), data)

    def refresh(self, token):
        return self.client.post(reverse('token_refresh'), {'refresh': str(token)})

    def test_logout_revokes_the_refresh_token(self):
        token = RefreshToken.for_user(self.user)
        self.client.force_authenticate(user=self.user)

        response = self.logout({'refresh': str(token)})
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        # The point of the endpoint: the token no longer buys a new session.
        self.assertEqual(
            self.refresh(token).status_code, status.HTTP_401_UNAUTHORIZED
        )

    def test_rotated_refresh_token_stops_working(self):
        """BLACKLIST_AFTER_ROTATION - without it the old token stays valid."""
        token = RefreshToken.for_user(self.user)

        self.assertEqual(self.refresh(token).status_code, status.HTTP_200_OK)
        self.assertEqual(
            self.refresh(token).status_code, status.HTTP_401_UNAUTHORIZED
        )

    def test_logout_requires_authentication(self):
        token = RefreshToken.for_user(self.user)
        self.assertEqual(
            self.logout({'refresh': str(token)}).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_logout_requires_a_refresh_token(self):
        self.client.force_authenticate(user=self.user)
        self.assertEqual(
            self.logout({}).status_code, status.HTTP_400_BAD_REQUEST
        )

    def test_garbage_token_is_rejected(self):
        self.client.force_authenticate(user=self.user)
        self.assertEqual(
            self.logout({'refresh': 'not-a-token'}).status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    def test_cannot_revoke_another_users_token(self):
        token = RefreshToken.for_user(self.other)
        self.client.force_authenticate(user=self.user)

        self.assertEqual(
            self.logout({'refresh': str(token)}).status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        # The other user's session must survive the attempt.
        self.assertEqual(self.refresh(token).status_code, status.HTTP_200_OK)

    def test_logging_out_twice_is_rejected_cleanly(self):
        """An already-blacklisted token must 400, not raise."""
        token = RefreshToken.for_user(self.user)
        self.client.force_authenticate(user=self.user)

        self.logout({'refresh': str(token)})
        self.assertEqual(
            self.logout({'refresh': str(token)}).status_code,
            status.HTTP_400_BAD_REQUEST,
        )


class ProfileUpdateTests(APITestCase):
    """GET / PATCH /api/accounts/me/."""

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password='n0t-a-real-password',
        )
        cls.other = User.objects.create_user(
            username='taken',
            email='taken@example.com',
            password='n0t-a-real-password',
        )

    def setUp(self):
        self.client.force_authenticate(user=self.user)
        self.url = reverse('me')

    def test_returns_own_profile(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['username'], 'cook')

    def test_can_edit_profile_fields(self):
        response = self.client.patch(
            self.url,
            {'email': 'new@example.com', 'dietary_preferences': 'vegan'},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'new@example.com')
        self.assertEqual(self.user.dietary_preferences, 'vegan')

    def test_cannot_promote_self_to_admin(self):
        """`role` is read-only - PATCHing it must be ignored, not applied."""
        response = self.client.patch(self.url, {'role': User.Role.ADMIN})
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.user.refresh_from_db()
        self.assertEqual(self.user.role, User.Role.REGISTERED)
        self.assertFalse(self.user.is_admin)

    def test_duplicate_username_is_rejected(self):
        response = self.client.patch(self.url, {'username': 'taken'})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_keeping_own_username_is_allowed(self):
        """The uniqueness check must exclude the row being edited."""
        response = self.client.patch(
            self.url, {'username': 'cook', 'dietary_preferences': 'halal'}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_requires_authentication(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(
            self.client.get(self.url).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )


class PasswordChangeTests(APITestCase):
    """POST /api/accounts/password/."""

    CURRENT = 'n0t-a-real-password'
    NEW = 'an0ther-real-looking-pw'

    def setUp(self):
        self.user = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password=self.CURRENT,
        )
        self.client.force_authenticate(user=self.user)
        self.url = reverse('password-change')

    def test_changes_the_password(self):
        response = self.client.post(
            self.url,
            {'current_password': self.CURRENT, 'new_password': self.NEW},
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(self.NEW))
        self.assertFalse(self.user.check_password(self.CURRENT))

    def test_password_is_hashed_not_stored_raw(self):
        self.client.post(
            self.url,
            {'current_password': self.CURRENT, 'new_password': self.NEW},
        )
        self.user.refresh_from_db()
        self.assertNotEqual(self.user.password, self.NEW)
        self.assertTrue(self.user.password.startswith('pbkdf2_'))

    def test_wrong_current_password_is_rejected(self):
        response = self.client.post(
            self.url,
            {'current_password': 'wrong-password', 'new_password': self.NEW},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(self.CURRENT))

    def test_weak_new_password_is_rejected(self):
        response = self.client.post(
            self.url,
            {'current_password': self.CURRENT, 'new_password': '123'},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reusing_the_current_password_is_rejected(self):
        response = self.client.post(
            self.url,
            {'current_password': self.CURRENT, 'new_password': self.CURRENT},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_existing_sessions_are_revoked(self):
        """A password change must not leave old refresh tokens usable."""
        token = RefreshToken.for_user(self.user)

        self.client.post(
            self.url,
            {'current_password': self.CURRENT, 'new_password': self.NEW},
        )

        response = self.client.post(
            reverse('token_refresh'), {'refresh': str(token)}
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_requires_authentication(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(
            self.url,
            {'current_password': self.CURRENT, 'new_password': self.NEW},
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class AdminUserManagementTests(APITestCase):
    """Admin-only account management under /api/accounts/users/."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username='boss',
            email='boss@example.com',
            password='n0t-a-real-password',
            role=User.Role.ADMIN,
        )
        self.member = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password='n0t-a-real-password',
        )
        self.client.force_authenticate(user=self.admin)

        self.list_url = reverse('admin-user-list')
        self.member_url = reverse('admin-user-detail', args=[self.member.user_id])
        self.own_url = reverse('admin-user-detail', args=[self.admin.user_id])

    # --- access control -------------------------------------------------

    def test_registered_user_is_denied(self):
        self.client.force_authenticate(user=self.member)
        self.assertEqual(
            self.client.get(self.list_url).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_anonymous_is_denied(self):
        self.client.force_authenticate(user=None)
        self.assertEqual(
            self.client.get(self.list_url).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_admin_can_list_accounts(self):
        response = self.client.get(self.list_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 2)

    def test_accounts_cannot_be_created_here(self):
        """Signup is the only way in - an admin cannot mint an account."""
        response = self.client.post(
            self.list_url, {'username': 'new', 'email': 'new@example.com'}
        )
        self.assertEqual(
            response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED
        )

    # --- promoting and demoting ----------------------------------------

    def test_admin_can_promote_a_user(self):
        response = self.client.patch(self.member_url, {'role': User.Role.ADMIN})
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.member.refresh_from_db()
        self.assertTrue(self.member.is_admin)

    def test_admin_can_demote_another_admin(self):
        self.member.role = User.Role.ADMIN
        self.member.save(update_fields=['role'])

        self.client.patch(self.member_url, {'role': User.Role.REGISTERED})

        self.member.refresh_from_db()
        self.assertFalse(self.member.is_admin)

    def test_admin_cannot_demote_themselves(self):
        response = self.client.patch(self.own_url, {'role': User.Role.REGISTERED})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_admin)

    def test_admin_cannot_deactivate_themselves(self):
        response = self.client.patch(self.own_url, {'is_active': False})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    def test_profile_fields_are_not_editable_by_admins(self):
        """Moderation must not quietly rewrite someone's profile."""
        response = self.client.patch(
            self.member_url,
            {'username': 'renamed', 'email': 'hijack@example.com'},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.member.refresh_from_db()
        self.assertEqual(self.member.username, 'cook')
        self.assertEqual(self.member.email, 'cook@example.com')

    # --- removal is deactivation ---------------------------------------

    def test_delete_deactivates_and_keeps_the_row(self):
        response = self.client.delete(self.member_url)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        self.member.refresh_from_db()   # would raise if the row were gone
        self.assertFalse(self.member.is_active)

    def test_deactivated_user_cannot_log_in(self):
        self.client.delete(self.member_url)

        response = self.client.post(
            reverse('token_obtain_pair'),
            {'username': 'cook', 'password': 'n0t-a-real-password'},
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_deactivation_revokes_existing_sessions(self):
        token = RefreshToken.for_user(self.member)

        self.client.delete(self.member_url)

        response = self.client.post(
            reverse('token_refresh'), {'refresh': str(token)}
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_deactivation_is_reversible(self):
        self.client.delete(self.member_url)
        self.client.patch(self.member_url, {'is_active': True})

        self.member.refresh_from_db()
        self.assertTrue(self.member.is_active)

    def test_admin_cannot_delete_themselves(self):
        response = self.client.delete(self.own_url)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    # --- search, filter, sort ------------------------------------------

    def test_search_by_username(self):
        response = self.client.get(self.list_url, {'search': 'cook'})
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['username'], 'cook')

    def test_filter_by_role(self):
        response = self.client.get(self.list_url, {'role': User.Role.ADMIN})
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['username'], 'boss')

    def test_filter_by_active_state(self):
        self.client.delete(self.member_url)

        response = self.client.get(self.list_url, {'is_active': 'false'})
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['username'], 'cook')

    def test_ordering(self):
        response = self.client.get(self.list_url, {'ordering': '-username'})
        names = [row['username'] for row in response.data['results']]
        self.assertEqual(names, ['cook', 'boss'])


class NoStrayDrfAdminPermissionTests(SimpleTestCase):
    """Guard against DRF's IsAdminUser being used as our admin check.

    DRF ships a permission class named IsAdminUser, one autocomplete entry
    away from our IsAdmin, and it checks `is_staff` rather than `role`. Both
    happen to give the same answer today, because User.is_staff currently
    delegates to User.is_admin - so a mistake here is invisible.

    The day those two properties are allowed to differ, anything wired to
    IsAdminUser silently stops enforcing the Admin role. This test makes that
    mistake fail at `manage.py test` instead of in production.

    It reads the source rather than the imports so it catches the class named
    anywhere - an import, a permission_classes list, or a settings string.
    """

    BANNED = 'IsAdminUser'

    SKIP_DIRS = frozenset({'__pycache__', 'migrations', '.venv', 'node_modules'})

    def python_files(self):
        """Every app source file, minus this one.

        This file is excluded because the docstring above has to name the
        banned class in order to explain it - otherwise the guard reports
        itself.
        """
        this_file = Path(__file__).resolve()

        for path in Path(settings.BASE_DIR).rglob('*.py'):
            if path.resolve() == this_file:
                continue
            if self.SKIP_DIRS.isdisjoint(path.parts):
                yield path

    def test_no_app_code_uses_drf_is_admin_user(self):
        offenders = [
            path
            for path in self.python_files()
            if self.BANNED in path.read_text(encoding='utf-8')
        ]

        self.assertFalse(
            offenders,
            f"\n{self.BANNED} is DRF's own permission class and checks "
            'is_staff, not the Admin role.\n'
            'Use accounts.permissions.IsAdmin instead.\n'
            'Found in:\n  '
            + '\n  '.join(str(p) for p in offenders),
        )


class OneTimeCodeModelTests(TestCase):
    """The code, its expiry, and the two uniqueness rules."""

    def pending(self, **overrides):
        fields = {
            'username': 'newcomer',
            'email': 'newcomer@example.com',
            'password_hash': make_password(PASSWORD),
        }
        fields.update(overrides)
        return PendingSignup.objects.create(**fields)

    def test_codes_are_six_digits(self):
        """Zero-padded, so one draw in ten is not a five-character code."""
        codes = [generate_otp_code() for _ in range(500)]

        self.assertTrue(all(len(code) == OTP_LENGTH for code in codes))
        self.assertTrue(all(code.isdigit() for code in codes))

    def test_codes_are_not_drawn_from_a_narrow_range(self):
        """A weak generator would repeat. `secrets` is why this holds."""
        codes = {generate_otp_code() for _ in range(500)}

        self.assertGreater(len(codes), 450)

    def test_a_fresh_code_lasts_the_full_ttl(self):
        remaining = (self.pending().expires_at - timezone.now()).total_seconds()

        self.assertAlmostEqual(
            remaining,
            OTP_TTL.total_seconds(),
            delta=10,
        )

    def test_a_code_is_spent_at_the_instant_it_expires(self):
        """The boundary, because `>` and `>=` are easy to get backwards here."""
        pending = self.pending()
        pending.expires_at = timezone.now()
        pending.save(update_fields=['expires_at'])

        self.assertTrue(pending.is_expired)

    def test_the_queryset_and_is_expired_agree(self):
        """They read the same boundary from opposite sides.

        If they ever disagree, a row is active in a query and expired in Python
        - which is how a code becomes usable after it should have died.
        """
        pending = self.pending()
        self.assertFalse(pending.is_expired)
        self.assertEqual(PendingSignup.objects.active().count(), 1)
        self.assertEqual(PendingSignup.objects.expired().count(), 0)

        PendingSignup.objects.filter(pk=pending.pk).update(
            expires_at=timezone.now() - OTP_TTL,
        )
        pending.refresh_from_db()

        self.assertTrue(pending.is_expired)
        self.assertEqual(PendingSignup.objects.active().count(), 0)
        self.assertEqual(PendingSignup.objects.expired().count(), 1)

    def test_regenerate_issues_a_new_code_with_a_full_expiry(self):
        """A full TTL, not the remainder of the old one."""
        pending = self.pending()
        PendingSignup.objects.filter(pk=pending.pk).update(
            expires_at=timezone.now() + OTP_TTL / 10,
        )
        pending.refresh_from_db()
        before = pending.code

        returned = pending.regenerate()
        pending.refresh_from_db()

        self.assertNotEqual(pending.code, before)
        self.assertEqual(returned, pending.code)
        remaining = (pending.expires_at - timezone.now()).total_seconds()
        self.assertAlmostEqual(remaining, OTP_TTL.total_seconds(), delta=10)

    def test_one_pending_signup_per_email(self):
        self.pending()

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                self.pending(username='someone-else')

    def test_two_pending_signups_may_share_a_username(self):
        """No constraint, deliberately - an expired row would block it forever.

        The serializer is what refuses a contested username, and only among
        rows that are still live. See the note in CLAUDE.md.
        """
        self.pending()
        self.pending(email='other@example.com')

        self.assertEqual(
            PendingSignup.objects.filter(username='newcomer').count(),
            2,
        )

    def test_one_live_reset_code_per_user_and_purpose(self):
        user = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password=PASSWORD,
        )
        OneTimeCode.objects.create(
            user=user,
            purpose=OneTimeCode.Purpose.PASSWORD_RESET,
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                OneTimeCode.objects.create(
                    user=user,
                    purpose=OneTimeCode.Purpose.PASSWORD_RESET,
                )

    def test_deleting_a_user_takes_their_codes(self):
        """CASCADE, the one user FK in this project that is not PROTECT.

        A reset code is meaningless without the account it unlocks, so it has
        nothing to protect.
        """
        user = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password=PASSWORD,
        )
        OneTimeCode.objects.create(
            user=user,
            purpose=OneTimeCode.Purpose.PASSWORD_RESET,
        )

        user.delete()

        self.assertFalse(OneTimeCode.objects.exists())


class CleanupExpiredTokensCommandTests(TestCase):
    """The depth-pass command CLAUDE.md names: neither table prunes itself,
    so this is what a cron/scheduled task would actually run."""

    def pending(self, **overrides):
        fields = {
            'username': 'newcomer',
            'email': 'newcomer@example.com',
            'password_hash': make_password(PASSWORD),
        }
        fields.update(overrides)
        return PendingSignup.objects.create(**fields)

    def expire(self, row):
        type(row).objects.filter(pk=row.pk).update(
            expires_at=timezone.now() - OTP_TTL,
        )

    def test_deletes_expired_pending_signups_and_keeps_active_ones(self):
        stale = self.pending()
        fresh = self.pending(username='fresher', email='fresher@example.com')
        self.expire(stale)

        call_command('cleanup_expired_tokens', stdout=StringIO())

        self.assertFalse(PendingSignup.objects.filter(pk=stale.pk).exists())
        self.assertTrue(PendingSignup.objects.filter(pk=fresh.pk).exists())

    def test_deletes_expired_one_time_codes_and_keeps_active_ones(self):
        stale_user = User.objects.create_user(
            username='cook', email='cook@example.com', password=PASSWORD,
        )
        fresh_user = User.objects.create_user(
            username='baker', email='baker@example.com', password=PASSWORD,
        )
        stale = OneTimeCode.objects.create(
            user=stale_user, purpose=OneTimeCode.Purpose.PASSWORD_RESET,
        )
        fresh = OneTimeCode.objects.create(
            user=fresh_user, purpose=OneTimeCode.Purpose.PASSWORD_RESET,
        )
        self.expire(stale)

        call_command('cleanup_expired_tokens', stdout=StringIO())

        self.assertFalse(OneTimeCode.objects.filter(pk=stale.pk).exists())
        self.assertTrue(OneTimeCode.objects.filter(pk=fresh.pk).exists())

    def test_dry_run_deletes_nothing(self):
        stale = self.pending()
        self.expire(stale)

        out = StringIO()
        call_command('cleanup_expired_tokens', '--dry-run', stdout=out)

        self.assertTrue(PendingSignup.objects.filter(pk=stale.pk).exists())
        self.assertIn('1 expired row', out.getvalue())

    def test_reports_how_many_it_deleted(self):
        stale = self.pending()
        self.expire(stale)

        out = StringIO()
        call_command('cleanup_expired_tokens', stdout=out)

        self.assertIn('PendingSignup: deleted 1 expired row', out.getvalue())
        self.assertIn('OneTimeCode: deleted 0 expired row', out.getvalue())


class CreateUserFromHashTests(TestCase):
    """The manager method that carries a pre-hashed password onto a User."""

    def setUp(self):
        self.hash = make_password(PASSWORD)

    def test_the_hash_is_stored_untouched(self):
        user = User.objects.create_user_from_hash(
            username='newcomer',
            email='newcomer@example.com',
            password_hash=self.hash,
        )

        self.assertEqual(user.password, self.hash)

    def test_the_original_password_still_logs_in(self):
        """The whole point: verification must not break the password."""
        User.objects.create_user_from_hash(
            username='newcomer',
            email='newcomer@example.com',
            password_hash=self.hash,
        )

        user = User.objects.get(username='newcomer')
        self.assertTrue(user.check_password(PASSWORD))

    def test_create_user_would_have_double_hashed_it(self):
        """Why the method exists at all.

        Passing a stored hash to create_user() raises no error and produces an
        account nobody can ever log into. Asserted so the trap stays visible.
        """
        user = User.objects.create_user(
            username='doomed',
            email='doomed@example.com',
            password=self.hash,
        )

        self.assertFalse(user.check_password(PASSWORD))

    def test_a_plaintext_password_is_refused(self):
        """identify_hasher() is what makes the dangerous misuse loud."""
        with self.assertRaises(ValueError):
            User.objects.create_user_from_hash(
                username='newcomer',
                email='newcomer@example.com',
                password_hash=PASSWORD,
            )

        self.assertFalse(User.objects.exists())

    def test_a_missing_hash_is_refused(self):
        with self.assertRaises(ValueError):
            User.objects.create_user_from_hash(
                username='newcomer',
                email='newcomer@example.com',
                password_hash='',
            )


#: Where the Brevo SDK's send lives. Patched on the client class rather than on
#: a Brevo instance, because accounts.emails.send_email() constructs a fresh
#: client per call and there is no shared instance to reach.
BREVO_SEND = (
    'brevo.transactional_emails.client'
    '.TransactionalEmailsClient.send_transac_email'
)


@override_settings(
    BREVO_API_KEY='test-key',
    BREVO_FROM_EMAIL='FlavorShare <test@example.com>',
)
class SignupFlowTestCase(APITestCase):
    """Base for the endpoint tests: a working key and a mocked SDK.

    The mock is what keeps the suite from sending mail. It also lets every test
    below assert on what *would* have been sent, which is the only way to check
    that the code in the email is the code in the database.
    """

    @classmethod
    def setUpTestData(cls):
        cls.register_url = reverse('register')
        cls.verify_url = reverse('verify-email')
        cls.resend_url = reverse('resend-otp')
        cls.reset_request_url = reverse('password-reset-request')
        cls.reset_confirm_url = reverse('password-reset-confirm')

    def setUp(self):
        patcher = patch(
            BREVO_SEND,
            return_value=SimpleNamespace(message_id='<test@brevo>'),
        )
        self.send = patcher.start()
        self.addCleanup(patcher.stop)

    def payload(self, **overrides):
        data = {
            'username': 'newcomer',
            'email': 'newcomer@example.com',
            'password': PASSWORD,
        }
        data.update(overrides)
        return data

    def register(self, **overrides):
        return self.client.post(
            self.register_url,
            self.payload(**overrides),
            format='json',
        )

    def emailed(self):
        """The payload handed to Brevo by the most recent send.

        Keyword arguments, not a single dict - send_transac_email() takes them
        keyword-only, so the keys here are Brevo's field names: `to` is a list
        of {'email': ...}, and the bodies are text_content and html_content.
        """
        return self.send.call_args.kwargs

    def expire(self, row):
        type(row).objects.filter(pk=row.pk).update(
            expires_at=timezone.now() - OTP_TTL,
        )
        row.refresh_from_db()
        return row


class RegisterTests(SignupFlowTestCase):
    def test_register_creates_no_account(self):
        """The premise of the whole design: unverified users do not exist."""
        self.register()

        self.assertFalse(User.objects.filter(email='newcomer@example.com'))
        self.assertEqual(PendingSignup.objects.count(), 1)

    def test_register_is_accepted_not_created(self):
        response = self.register()

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(
            sorted(response.data),
            ['detail', 'email', 'expires_at'],
        )

    def test_the_response_never_carries_the_code(self):
        """It goes to the address being proven, and nowhere else."""
        response = self.register()
        code = PendingSignup.objects.get().code

        self.assertNotIn('code', response.data)
        self.assertNotIn(code, str(response.data))

    def test_the_password_is_stored_hashed(self):
        self.register()
        stored = PendingSignup.objects.get().password_hash

        self.assertNotEqual(stored, PASSWORD)
        self.assertTrue(stored.startswith('pbkdf2_'))

    def test_dietary_preferences_are_kept_for_the_account(self):
        self.register(dietary_preferences='vegan')

        self.assertEqual(
            PendingSignup.objects.get().dietary_preferences,
            'vegan',
        )

    def test_the_emailed_code_is_the_stored_code(self):
        self.register()
        pending = PendingSignup.objects.get()

        self.assertEqual(self.emailed()['to'], [{'email': 'newcomer@example.com'}])
        self.assertIn(pending.code, self.emailed()['text_content'])
        self.assertIn(pending.code, self.emailed()['html_content'])

    def test_an_email_already_registered_is_refused(self):
        User.objects.create_user(
            username='someone',
            email='newcomer@example.com',
            password=PASSWORD,
        )

        response = self.register()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('email', response.data)
        self.assertFalse(PendingSignup.objects.exists())

    def test_a_username_already_registered_is_refused(self):
        User.objects.create_user(
            username='newcomer',
            email='someone@example.com',
            password=PASSWORD,
        )

        response = self.register()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('username', response.data)

    def test_a_username_held_by_another_live_signup_is_refused(self):
        """The race the design exists to close.

        Checking only the email here would let two people hold one username
        through their pending windows, and whoever verified second would fail
        with nothing to do about it.
        """
        self.register()

        response = self.register(email='other@example.com')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('username', response.data)

    def test_a_username_held_by_an_expired_signup_is_free(self):
        self.register()
        self.expire(PendingSignup.objects.get())

        response = self.register(email='other@example.com')

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)

    def test_registering_again_reissues_the_code_on_the_same_row(self):
        self.register()
        pending = PendingSignup.objects.get()
        before = pending.code

        response = self.register()
        pending.refresh_from_db()

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(PendingSignup.objects.count(), 1)
        self.assertNotEqual(pending.code, before)
        self.assertIn(pending.code, self.emailed()['text_content'])

    def test_registering_again_after_expiry_starts_over(self):
        self.register()
        stale = self.expire(PendingSignup.objects.get())

        self.register()

        self.assertEqual(PendingSignup.objects.count(), 1)
        self.assertNotEqual(PendingSignup.objects.get().pk, stale.pk)

    def test_a_weak_password_is_refused(self):
        response = self.register(password='123')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(PendingSignup.objects.exists())


class RegisterEmailFailureTests(SignupFlowTestCase):
    """What happens when the code cannot be delivered.

    The rollback is the point. A pending row that survives a failed send would
    sit in the way of the next attempt while holding a code nobody received.
    """

    @override_settings(BREVO_API_KEY='')
    def test_a_missing_api_key_is_503_and_leaves_nothing_behind(self):
        response = self.register()

        self.assertEqual(
            response.status_code,
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )
        self.assertFalse(self.send.called)
        self.assertFalse(PendingSignup.objects.exists())

    def test_a_refused_message_is_502_and_leaves_nothing_behind(self):
        self.send.side_effect = ApiError(
            status_code=400,
            body={'code': 'invalid_parameter',
                  'message': 'sender email is not valid'},
        )

        response = self.register()

        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertFalse(PendingSignup.objects.exists())

    def test_a_failed_resend_leaves_the_previous_code_usable(self):
        """Rolling back a reissue has to restore the code already emailed."""
        self.register()
        original = PendingSignup.objects.get().code

        self.send.side_effect = ApiError(
            status_code=429,
            body={'code': 'too_many_requests', 'message': 'rate limited'},
        )
        response = self.client.post(
            self.resend_url,
            {'email': 'newcomer@example.com'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertEqual(PendingSignup.objects.get().code, original)


class VerifyEmailTests(SignupFlowTestCase):
    def setUp(self):
        super().setUp()
        self.register(dietary_preferences='vegan')
        self.pending = PendingSignup.objects.get()

    def verify(self, code=None, email='newcomer@example.com'):
        return self.client.post(
            self.verify_url,
            {'email': email, 'code': code or self.pending.code},
            format='json',
        )

    def test_a_correct_code_creates_the_account(self):
        response = self.verify()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        user = User.objects.get(email='newcomer@example.com')
        self.assertEqual(user.username, 'newcomer')
        self.assertEqual(user.role, User.Role.REGISTERED)
        self.assertEqual(user.dietary_preferences, 'vegan')

    def test_the_password_from_registration_works(self):
        """The double-hash trap, checked through the real flow."""
        self.verify()

        user = User.objects.get(email='newcomer@example.com')
        self.assertTrue(user.check_password(PASSWORD))

    def test_the_response_carries_usable_tokens(self):
        """Verifying signs you in - no second trip to a login form."""
        response = self.verify()

        self.assertIn('access', response.data)
        self.assertIn('refresh', response.data)

        self.client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {response.data["access"]}',
        )
        profile = self.client.get(reverse('me'))
        self.assertEqual(profile.status_code, status.HTTP_200_OK)
        self.assertEqual(profile.data['username'], 'newcomer')

    def test_the_pending_row_is_consumed(self):
        self.verify()

        self.assertFalse(PendingSignup.objects.exists())

    def test_a_wrong_code_is_refused(self):
        wrong = '000000' if self.pending.code != '000000' else '111111'

        response = self.verify(code=wrong)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(username='newcomer').exists())

    def test_an_expired_code_is_refused(self):
        self.expire(self.pending)

        response = self.verify()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(username='newcomer').exists())
        # The row survives; only registering again clears it.
        self.assertTrue(PendingSignup.objects.exists())

    def test_an_unknown_address_is_refused(self):
        response = self.verify(email='stranger@example.com')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_code_cannot_be_replayed(self):
        code = self.pending.code
        self.verify()

        response = self.verify(code=code)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(User.objects.filter(username='newcomer').count(), 1)

    def test_a_username_taken_during_the_window_is_reported(self):
        """The documented race, from the losing side.

        A readable 400 naming the username, not an IntegrityError.
        """
        User.objects.create_user(
            username='newcomer',
            email='faster@example.com',
            password=PASSWORD,
        )

        response = self.verify()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('username', response.data)


class ResendOTPTests(SignupFlowTestCase):
    def setUp(self):
        super().setUp()
        self.register()
        self.pending = PendingSignup.objects.get()

    def resend(self, email='newcomer@example.com'):
        return self.client.post(
            self.resend_url,
            {'email': email},
            format='json',
        )

    def test_a_new_code_is_issued_with_a_full_expiry(self):
        before = self.pending.code
        PendingSignup.objects.filter(pk=self.pending.pk).update(
            expires_at=timezone.now() + OTP_TTL / 10,
        )

        response = self.resend()
        self.pending.refresh_from_db()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotEqual(self.pending.code, before)
        remaining = (
            self.pending.expires_at - timezone.now()
        ).total_seconds()
        self.assertAlmostEqual(
            remaining,
            OTP_TTL.total_seconds(),
            delta=10,
        )

    def test_the_new_code_is_the_one_emailed(self):
        self.resend()
        self.pending.refresh_from_db()

        self.assertIn(self.pending.code, self.emailed()['text_content'])

    def test_the_old_code_stops_working(self):
        before = self.pending.code
        self.resend()

        response = self.client.post(
            self.verify_url,
            {'email': 'newcomer@example.com', 'code': before},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_an_unknown_address_is_refused(self):
        response = self.resend(email='stranger@example.com')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_an_expired_signup_is_not_revived(self):
        """Reviving it here would make the expiry mean nothing."""
        self.expire(self.pending)
        before = self.pending.code

        response = self.resend()
        self.pending.refresh_from_db()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.pending.code, before)


class PasswordResetTests(SignupFlowTestCase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password=PASSWORD,
        )

    def request_reset(self, email='cook@example.com'):
        return self.client.post(
            self.reset_request_url,
            {'email': email},
            format='json',
        )

    def confirm(self, code=None, email='cook@example.com',
                new_password=NEW_PASSWORD):
        if code is None:
            code = OneTimeCode.objects.get(user=self.user).code
        return self.client.post(
            self.reset_confirm_url,
            {'email': email, 'code': code, 'new_password': new_password},
            format='json',
        )

    def test_a_request_emails_a_code_to_the_account(self):
        response = self.request_reset()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        code = OneTimeCode.objects.get(user=self.user)
        self.assertEqual(code.purpose, OneTimeCode.Purpose.PASSWORD_RESET)
        self.assertEqual(self.emailed()['to'], [{'email': 'cook@example.com'}])
        self.assertIn(code.code, self.emailed()['text_content'])

    def test_the_response_never_carries_the_code(self):
        response = self.request_reset()
        code = OneTimeCode.objects.get(user=self.user).code

        self.assertNotIn(code, str(response.data))

    def test_asking_twice_reissues_on_the_same_row(self):
        """Two live codes would double the guessing surface."""
        self.request_reset()
        code = OneTimeCode.objects.get(user=self.user)
        before = code.code

        self.request_reset()
        code.refresh_from_db()

        self.assertEqual(OneTimeCode.objects.count(), 1)
        self.assertNotEqual(code.code, before)

    def test_an_unknown_address_is_refused(self):
        response = self.request_reset(email='stranger@example.com')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(OneTimeCode.objects.exists())

    def test_a_deactivated_account_is_refused(self):
        """Deactivation is this project's "removed" - a reset would be a way in."""
        self.user.is_active = False
        self.user.save(update_fields=['is_active'])

        response = self.request_reset()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(OneTimeCode.objects.exists())

    def test_confirming_sets_the_new_password(self):
        self.request_reset()

        response = self.confirm()
        self.user.refresh_from_db()

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertTrue(self.user.check_password(NEW_PASSWORD))
        self.assertFalse(self.user.check_password(PASSWORD))

    def test_the_code_is_consumed(self):
        self.request_reset()

        self.confirm()

        self.assertFalse(OneTimeCode.objects.exists())

    def test_confirming_revokes_existing_sessions(self):
        """A reset answers a takeover; the intruder's session has to end.

        Same rule PasswordChangeTests covers for a deliberate change.
        """
        refresh = RefreshToken.for_user(self.user)
        self.request_reset()

        self.confirm()

        response = self.client.post(
            reverse('token_refresh'),
            {'refresh': str(refresh)},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_wrong_code_is_refused(self):
        self.request_reset()
        real = OneTimeCode.objects.get(user=self.user).code
        wrong = '000000' if real != '000000' else '111111'

        response = self.confirm(code=wrong)
        self.user.refresh_from_db()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(self.user.check_password(PASSWORD))

    def test_an_expired_code_is_refused(self):
        self.request_reset()
        self.expire(OneTimeCode.objects.get(user=self.user))

        response = self.confirm()
        self.user.refresh_from_db()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(self.user.check_password(PASSWORD))

    def test_confirming_without_a_request_is_refused(self):
        response = self.confirm(code='123456')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_weak_new_password_is_refused(self):
        self.request_reset()

        response = self.confirm(new_password='123')
        self.user.refresh_from_db()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(self.user.check_password(PASSWORD))
        # The code survives a rejected attempt, so a real typo is recoverable.
        self.assertTrue(OneTimeCode.objects.exists())

    def test_a_code_cannot_be_replayed(self):
        self.request_reset()
        code = OneTimeCode.objects.get(user=self.user).code
        self.confirm()

        response = self.confirm(code=code, new_password='a-third-passw0rd')
        self.user.refresh_from_db()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(self.user.check_password(NEW_PASSWORD))
