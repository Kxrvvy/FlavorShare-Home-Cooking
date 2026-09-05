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
    def is_staff(self):
        """Django admin gate.

        Derived from `role` rather than stored, so no is_staff column is
        added beyond what the SQL defines.
        """
        return self.is_superuser or self.role == self.Role.ADMIN
