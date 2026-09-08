"""Tests for the role model and the shared permission classes.

These are the security boundary for the whole project - every other app
imports accounts.permissions - so the failure cases matter more than the
success ones. Each class is exercised directly against a request rather than
through a live endpoint, since the other apps' views do not exist yet.
"""

from pathlib import Path
from types import SimpleNamespace

from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIRequestFactory

from .models import User
from .permissions import (
    IsAdmin,
    IsOwnerOrReadOnly,
    IsRegisteredUser,
    IsRegisteredUserOrReadOnly,
)


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
