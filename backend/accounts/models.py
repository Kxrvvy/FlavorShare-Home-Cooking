"""Models for the accounts app: User, PendingSignup, OneTimeCode.

User mirrors the `Users` table in flavorshare.sql. Field types, lengths,
uniqueness and defaults are taken from that file as the source of truth.

PendingSignup and OneTimeCode are in neither flavorshare.sql nor the ERD. They
carry email verification and password reset the way Django's own session and
token-blacklist tables carry auth - infrastructure for a feature rather than
entities the application is about. CLAUDE.md records them under the same
heading as those. Both are short-lived by design: a row is created, used once,
and deleted.

Signup is deferred account creation, not verify-after-the-fact. A User row is
written only once its email address has been proven, which is why there is no
is_verified column and why nothing anywhere has to check one - an unverified
account does not exist to be checked.
"""

import secrets
from datetime import timedelta

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.hashers import identify_hasher
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone

#: How long a one-time code stays usable. Ten minutes is long enough to fetch
#: an email and short enough that a leaked code is worth little.
OTP_TTL = timedelta(minutes=10)

#: Digits in a one-time code. Six is what people expect to be asked to type.
OTP_LENGTH = 6


def generate_otp_code():
    """A cryptographically secure numeric code, zero-padded.

    `secrets`, not `random`: the standard random module is a Mersenne Twister
    seeded from the clock, and enough observed outputs reveal its state. A code
    that gates account creation and password reset has to come from the
    system's entropy source.

    Zero-padded because the code is a string of digits, not a number - without
    it, one draw in ten produces a code shorter than six characters and "42"
    is not a six-digit code.
    """
    upper = 10 ** OTP_LENGTH
    return f'{secrets.randbelow(upper):0{OTP_LENGTH}d}'


def default_otp_expiry():
    """When a code created right now stops working.

    A callable default rather than a value computed in save(), so the column is
    populated by the ORM the same way for every entry point - API, admin,
    shell, fixtures.

    Evaluated microseconds apart from created_at's auto_now_add rather than
    being exactly created_at + OTP_TTL. That difference is not worth a second
    write to reconcile, but it is worth knowing before anyone treats
    expires_at - created_at as an exact ten minutes.
    """
    return timezone.now() + OTP_TTL


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

    def create_user_from_hash(
        self,
        username,
        email,
        password_hash,
        **extra_fields,
    ):
        """Create a user whose password was hashed earlier, elsewhere.

        The one supported way to write a pre-hashed password, and the reason it
        exists: create_user() runs set_password(), which hashes whatever it is
        given. Handing it a stored hash produces a hash *of* a hash - no error
        at the time, and an account nobody can ever log into. Keeping that rule
        here rather than at the call site follows the same habit as
        Activity.log() and Recipe.publication_error().

        Used by email verification. PendingSignup hashes the password at
        registration, so by the time the account becomes real the hash already
        exists and has to be carried across untouched.

        identify_hasher() is the guard that makes the dangerous mistake loud:
        pass a plaintext password here and it raises instead of storing the
        password in the clear.
        """
        if not username:
            raise ValueError('Users must have a username.')
        if not email:
            raise ValueError('Users must have an email address.')
        if not password_hash:
            raise ValueError('A password hash is required.')

        try:
            identify_hasher(password_hash)
        except ValueError:
            raise ValueError(
                'create_user_from_hash() takes an already-hashed password. '
                'Use create_user() for a plaintext one.'
            )

        user = self.model(
            username=username,
            email=self.normalize_email(email),
            **extra_fields,
        )
        # Assigned, not set_password()'d - that is the entire point.
        user.password = password_hash
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


class OneTimeCodeQuerySet(models.QuerySet):
    """Splitting rows by whether their code is still usable.

    Both callers need this and neither should write the comparison itself: a
    stray `expires_at__gt` with the wrong operator is the kind of bug that
    only shows up on a boundary nobody tests.
    """

    def active(self):
        """Rows whose code has not expired yet."""
        return self.filter(expires_at__gt=timezone.now())

    def expired(self):
        """Rows whose code is spent. Nothing deletes these - see CLAUDE.md."""
        return self.filter(expires_at__lte=timezone.now())


class OneTimeCodeBase(models.Model):
    """Shared behaviour for the two short-lived code tables.

    Abstract, so each concrete model gets its own table with its own columns -
    a pending signup has no user to point at, and a password reset has nothing
    to say about usernames.

    `expires_at` is a stored column rather than something recomputed from
    created_at at query time. That is what lets active() be a plain indexed
    comparison, and it is what makes regenerate() able to extend a code's life
    without touching when the row was first written.
    """

    code = models.CharField(max_length=OTP_LENGTH, default=generate_otp_code)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(default=default_otp_expiry)

    objects = OneTimeCodeQuerySet.as_manager()

    class Meta:
        abstract = True

    @property
    def is_expired(self):
        """Whether this code is past its expiry.

        `>=`, so a code is spent at the instant it expires rather than one
        microsecond later. Matches OneTimeCodeQuerySet.active(), which uses a
        strict `>` on the other side of the same boundary - the two have to
        agree or a row could be active in a queryset and expired in Python.
        """
        return timezone.now() >= self.expires_at

    def regenerate(self, save=True):
        """Issue a new code with a full fresh expiry, and return it.

        A *full* OTP_TTL, not whatever was left of the old one. Resending
        because the first email did not arrive should not hand someone a code
        that dies in ninety seconds.

        Returns the new code because every caller is about to email it.
        """
        self.code = generate_otp_code()
        self.expires_at = default_otp_expiry()

        if save:
            self.save(update_fields=['code', 'expires_at'])

        return self.code


class PendingSignup(OneTimeCodeBase):
    """A signup waiting for its email address to be proven.

    Holds what a User row would hold, minus the row. On successful
    verification these values become a real User and this one is deleted; if
    the code expires first, nothing was ever created.

    The password is hashed here, at registration, and stored hashed. Keeping a
    plaintext password for ten minutes to hash later would be the easier
    implementation and the wrong trade.
    """

    # No SQL counterpart - see the module docstring.
    pending_signup_id = models.AutoField(primary_key=True)

    # Same length as User.username, since that is what this becomes.
    #
    # Deliberately NOT unique. An *expired* pending signup holding this
    # username, for some other email, would otherwise block a new registration
    # - and nothing deletes expired rows. Uniqueness is checked in the
    # serializer against active() rows only, which leaves a narrow race
    # documented in CLAUDE.md.
    username = models.CharField(max_length=50)

    # Same length as User.email.
    #
    # Unique, unlike username, and safe to be: the register flow keeps at most
    # one pending signup per address by regenerating the code on an existing
    # row or deleting an expired one before creating another. The constraint
    # turns that from an intention into a guarantee.
    email = models.EmailField(max_length=100, unique=True)

    # Same width as the Users.password_hash column this eventually becomes.
    #
    # Named for what it holds. It must never be handed to create_user(), which
    # hashes what it is given - see the note on how verification writes it.
    password_hash = models.CharField(max_length=255)

    # Carried through verification onto the User, because /register/ has always
    # accepted it. Dropping it here instead would silently discard whatever a
    # frontend sends, which is worse than an unused column.
    dietary_preferences = models.TextField(blank=True, null=True)

    class Meta:
        db_table = 'PendingSignup'
        # Newest first, with pending_signup_id breaking the tie because
        # created_at is not unique.
        ordering = ['-created_at', '-pending_signup_id']

    def __str__(self):
        return f'pending signup for {self.email}'


class OneTimeCode(OneTimeCodeBase):
    """A code issued to an account that already exists.

    Separate from PendingSignup because the two have nothing in common beyond
    the code itself: this one belongs to a real User, and the account it
    unlocks is already there to be found.

    `purpose` carries one value today. It exists so the next reason to email
    somebody a code - confirming an email change, say - is a new choice rather
    than a new table.
    """

    class Purpose(models.TextChoices):
        PASSWORD_RESET = 'password_reset', 'Password reset'

    # No SQL counterpart - see the module docstring.
    one_time_code_id = models.AutoField(primary_key=True)

    # CASCADE, unlike every other user FK in this project. Those are PROTECT
    # because they hold content worth keeping; this holds a code that is
    # meaningless without the account it unlocks.
    user = models.ForeignKey(
        'accounts.User',
        on_delete=models.CASCADE,
        related_name='one_time_codes',
    )

    # max_length 14 is 'password_reset', the longest of the choices.
    purpose = models.CharField(max_length=14, choices=Purpose.choices)

    class Meta:
        db_table = 'OneTimeCode'
        ordering = ['-created_at', '-one_time_code_id']
        constraints = [
            # One live code per account per purpose. Asking for a second reset
            # email replaces the code on this row rather than leaving two
            # valid codes in circulation, which doubles the guessing surface
            # and makes "which one did they type" unanswerable.
            #
            # This also settles what a repeat request does, since the spec
            # does not: get_or_create on (user, purpose) then regenerate, the
            # same shape the pending-signup resend uses.
            models.UniqueConstraint(
                fields=['user', 'purpose'],
                name='one_live_code_per_user_and_purpose',
            ),
        ]

    def __str__(self):
        return f'{self.get_purpose_display().lower()} code for {self.user.username}'
