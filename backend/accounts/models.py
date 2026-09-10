"""User model for the accounts app.

Mirrors the `Users` table in flavorshare.sql. Field types, lengths,
uniqueness and defaults are taken from that file as the source of truth.
"""

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models


class UserManager(BaseUserManager):
    """Creates users with hashed passwords, keyed on username."""

    use_in_migrations = True

    def create_user(self, username, email, password=None, **extra_fields):
        if not username:
            raise ValueError('Users must have a username.')
        if not email:
            raise ValueError('Users must have an email address.')

        user = self.model(
            username=username,
            email=self.normalize_email(email),
            **extra_fields,
        )
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, username, email, password=None, **extra_fields):
        extra_fields.setdefault('role', User.Role.ADMIN)
        extra_fields.setdefault('is_superuser', True)

        if extra_fields.get('is_superuser') is not True:
            raise ValueError('Superuser must have is_superuser=True.')

        return self.create_user(username, email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    """SQL: Users"""

    class Role(models.TextChoices):
        GUEST = 'guest', 'Guest'
        REGISTERED = 'registered', 'Registered'
        ADMIN = 'admin', 'Admin'

    # user_id INT AUTO_INCREMENT PRIMARY KEY
    # AutoField (not BigAutoField) so the column is INT, matching the SQL.
    user_id = models.AutoField(primary_key=True)

    # username VARCHAR(50) NOT NULL UNIQUE
    username = models.CharField(max_length=50, unique=True)

    # email VARCHAR(100) NOT NULL UNIQUE
    email = models.EmailField(max_length=100, unique=True)

    # password_hash VARCHAR(255) NOT NULL
    # Overrides AbstractBaseUser.password (max_length=128) to match the column.
    password = models.CharField(max_length=255, db_column='password_hash')

    # role ENUM("guest", "registered", "admin") DEFAULT "registered"
    role = models.CharField(
        max_length=10,
        choices=Role.choices,
        default=Role.REGISTERED,
    )

    # dietary_preferences TEXT
    dietary_preferences = models.TextField(blank=True, null=True)

    # is_active BOOLEAN DEFAULT TRUE
    is_active = models.BooleanField(default=True)

    # created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    created_at = models.DateTimeField(auto_now_add=True)

    objects = UserManager()

    USERNAME_FIELD = 'username'
    REQUIRED_FIELDS = ['email']

    class Meta:
        db_table = 'Users'

    def __str__(self):
        return self.username

    @property
    def is_admin(self):
        """The project's Admin role

        Single source of truth for "is this an admin?" - accounts.permissions
        and every admin-only view read this instead of comparing role strings
        themselves, so the rule only ever changes in one place.

        A superuser counts as an admin so `createsuperuser` accounts can reach
        admin-only endpoints without their role being edited by hand.
        """
        return self.is_superuser or self.role == self.Role.ADMIN

    @property
    def is_staff(self):
        """Django admin gate.

        Derived from `role` rather than stored, so no is_staff column is
        added beyond what the SQL defines. Same rule as `is_admin`, kept under
        a separate name because Django looks for `is_staff` specifically.
        """
        return self.is_admin

    # Django's admin asks two separate questions: is_staff decides whether you
    # may open /admin/ at all, and these two decide what you may do once you
    # are in. PermissionsMixin answers them from the groups and permissions
    # tables, short-circuiting to True only for is_superuser - so without the
    # overrides below an Admin-role account reaches the admin index and then
    # gets a 403 on every model page, which is not the access the role is
    # meant to carry.

    def has_perm(self, perm, obj=None):
        """Admins hold every permission; everyone else falls back to Django.

        Blanket rather than a curated permission Group, because this project
        has one Admin role that already carries full moderation powers - a
        Group would have to be kept in step with every model added later, and
        drifting out of step would fail silently.

        The is_active check is the important half. AdminUserViewSet deletes an
        account by deactivating it rather than destroying it, so a "removed"
        admin still has role='admin'; without this they would keep full access
        to the admin site.

        `obj` is accepted and ignored: Django's object-level permission hook is
        not used anywhere in this project, and DRF answers object permissions
        through accounts.permissions instead.
        """
        if self.is_active and self.is_admin:
            return True
        return super().has_perm(perm, obj)

    def has_module_perms(self, app_label):
        """Whether an app shows up in the admin sidebar. Same rule as above."""
        if self.is_active and self.is_admin:
            return True
        return super().has_module_perms(app_label)
