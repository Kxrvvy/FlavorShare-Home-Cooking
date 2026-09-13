"""Serializers for user accounts: registration, verification, reset, profile.

Registration is deferred account creation. RegisterSerializer writes a
PendingSignup, never a User, and VerifyEmailSerializer is what turns one into
the other. Nothing in this file has to ask whether an account is verified -
see accounts/models.py for why that question cannot arise.

Three rules recur below and are worth stating once.

Codes are compared with secrets.compare_digest, not `==`. String comparison
short-circuits on the first differing character, so its timing leaks how much
of a guess was right. For six digits that leak is small; using the constant-time
comparison costs nothing.

Errors here say what is wrong. A caller who mistypes a code, waits too long, or
never registered gets three different messages, because the alternative is a
person stuck at a form with no idea which. This does let someone probe whether
an address is registered - but /register/ has always answered that question
through its uniqueness error, so being vague here would buy nothing.

Sending the email is not this layer's job. These serializers produce and
validate codes; what puts one in front of a person lives in accounts/emails.py
and is called by the views.
"""

import secrets

from django.contrib.auth.hashers import make_password
from django.contrib.auth.password_validation import validate_password
from django.db import IntegrityError
from rest_framework import serializers

from .models import OTP_LENGTH, OneTimeCode, PendingSignup, User


class UserSerializer(serializers.ModelSerializer):
    """A user's own profile - used to read and to edit it.

    Backs GET and PATCH on /me/, and shapes the register response.

    `role` is deliberately read-only so a user can never promote itself; the
    username and email uniqueness checks come from the model's unique=True,
    which DRF turns into validators that know to exclude the current row on
    an update.
    """

    class Meta:
        model = User
        fields = [
            'user_id',
            'username',
            'email',
            'role',
            'dietary_preferences',
            'created_at',
        ]
        read_only_fields = ['user_id', 'role', 'created_at']


class RegisterSerializer(serializers.Serializer):
    """Signup payload. Produces a PendingSignup, not a User.

    A plain Serializer rather than a ModelSerializer over PendingSignup: the
    input field is `password` and the column is `password_hash`, and the
    uniqueness rules span two tables, so almost nothing would map one-to-one.

    `role` is not an input field and never was - an account takes the model
    default, so a client cannot register itself as an admin.
    """

    username = serializers.CharField(max_length=50)
    email = serializers.EmailField(max_length=100)
    password = serializers.CharField(
        write_only=True,
        style={'input_type': 'password'},
        validators=[validate_password],
    )
    dietary_preferences = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
    )

    def validate(self, attrs):
        """Both names must be free, against both tables.

        Checking email alone would be the obvious half-measure: two people
        could then hold the same *username* through their respective pending
        windows, and whichever verified second would fail at the last step with
        nothing to do about it.

        An active pending signup for this same email is not a clash - it is the
        case create() handles by reissuing a code on that row.
        """
        username = attrs['username']
        email = attrs['email']

        if User.objects.filter(email=email).exists():
            raise serializers.ValidationError({
                'email': 'An account with this email already exists.',
            })

        if User.objects.filter(username=username).exists():
            raise serializers.ValidationError({
                'username': 'This username is taken.',
            })

        # .exclude(email=...) so a caller re-registering the same address is
        # not blocked by their own pending row.
        contested = (
            PendingSignup.objects.active()
            .filter(username=username)
            .exclude(email=email)
        )
        if contested.exists():
            raise serializers.ValidationError({
                'username': (
                    'Someone is registering this username right now. '
                    'Choose another.'
                ),
            })

        return attrs

    def create(self, validated_data):
        """Create, or reuse, the pending signup for this address.

        Three cases, per the design:

        - nothing pending: write a new row;
        - something pending and still live: reissue the code on that row rather
          than adding a second one, and take the rest of the payload with it -
          a caller registering again has most likely come back to correct
          something;
        - something pending but expired: drop it and start over, so a stale row
          cannot keep an address hostage.

        Returns the PendingSignup. Its `code` is what the view emails.
        """
        email = validated_data['email']
        fields = {
            'username': validated_data['username'],
            'password_hash': make_password(validated_data['password']),
            'dietary_preferences': validated_data.get('dietary_preferences'),
        }

        pending = PendingSignup.objects.filter(email=email).first()

        if pending is not None and pending.is_expired:
            pending.delete()
            pending = None

        if pending is None:
            return PendingSignup.objects.create(email=email, **fields)

        for name, value in fields.items():
            setattr(pending, name, value)
        # save=False, then one save() below, so the reissued code and the
        # updated payload land in a single write.
        pending.regenerate(save=False)
        pending.save()
        return pending


class VerifyEmailSerializer(serializers.Serializer):
    """Turn a proven PendingSignup into a real account.

    This is the only place a User row is created by signup, which is what makes
    "an unverified account does not exist" true rather than merely intended.
    """

    email = serializers.EmailField(max_length=100)
    code = serializers.CharField(min_length=OTP_LENGTH, max_length=OTP_LENGTH)

    def validate(self, attrs):
        pending = PendingSignup.objects.filter(email=attrs['email']).first()

        if pending is None:
            raise serializers.ValidationError({
                'email': (
                    'No signup is waiting for this address. Register again.'
                ),
            })

        if pending.is_expired:
            raise serializers.ValidationError({
                'code': 'This code has expired. Register again to get a new one.',
            })

        if not secrets.compare_digest(pending.code, attrs['code']):
            raise serializers.ValidationError({
                'code': 'That code is not correct.',
            })

        # Re-checked at the last possible moment. Between registration and now,
        # somebody else may have taken the username - the race documented in
        # CLAUDE.md - and a readable error beats an IntegrityError.
        if User.objects.filter(username=pending.username).exists():
            raise serializers.ValidationError({
                'username': (
                    f'The username "{pending.username}" was taken while you '
                    f'were verifying. Register again with another.'
                ),
            })

        attrs['pending'] = pending
        return attrs

    def save(self):
        pending = self.validated_data['pending']

        try:
            user = User.objects.create_user_from_hash(
                username=pending.username,
                email=pending.email,
                password_hash=pending.password_hash,
                dietary_preferences=pending.dietary_preferences,
            )
        except IntegrityError:
            # The same race as the check in validate(), lost in the gap between
            # that query and this insert. Reported the same way rather than as
            # a 500.
            raise serializers.ValidationError({
                'username': (
                    'That username was taken a moment ago. Register again '
                    'with another.'
                ),
            })

        # The pending row has done its job. Deleting it is what frees the
        # address and username for anyone else, and what stops a code being
        # replayed.
        pending.delete()
        return user


class ResendOTPSerializer(serializers.Serializer):
    """Reissue the code on a pending signup that is still live."""

    email = serializers.EmailField(max_length=100)

    def validate(self, attrs):
        pending = PendingSignup.objects.filter(email=attrs['email']).first()

        if pending is None:
            raise serializers.ValidationError({
                'email': (
                    'No signup is waiting for this address. Register again.'
                ),
            })

        if pending.is_expired:
            # Not resent. The row is spent, and reviving it here would make
            # expiry mean nothing.
            raise serializers.ValidationError({
                'email': (
                    'This signup has expired. Register again to start over.'
                ),
            })

        attrs['pending'] = pending
        return attrs

    def save(self):
        pending = self.validated_data['pending']
        pending.regenerate()
        return pending


class PasswordResetRequestSerializer(serializers.Serializer):
    """Issue a reset code to an account that already exists."""

    email = serializers.EmailField(max_length=100)

    def validate(self, attrs):
        user = User.objects.filter(
            email=attrs['email'],
            # A deactivated account is this project's "removed" - see
            # AdminUserViewSet.perform_destroy. Letting one reset its password
            # would be a way back in.
            is_active=True,
        ).first()

        if user is None:
            raise serializers.ValidationError({
                'email': 'No active account uses this email address.',
            })

        attrs['user'] = user
        return attrs

    def save(self):
        """One live code per account, reissued rather than added to.

        get_or_create then regenerate: the model's UniqueConstraint on
        (user, purpose) makes this the only shape available, which is the point
        - two valid reset codes at once double the guessing surface.

        The fresh row already carries a usable code from the field default, so
        regenerate() spends one unnecessarily. Worth it to keep a single path
        through both cases.
        """
        code, _ = OneTimeCode.objects.get_or_create(
            user=self.validated_data['user'],
            purpose=OneTimeCode.Purpose.PASSWORD_RESET,
        )
        code.regenerate()
        return code


class PasswordResetConfirmSerializer(serializers.Serializer):
    """Set a new password using a reset code.

    Deliberately unlike PasswordChangeSerializer, which refuses a new password
    matching the current one. That check is fine when the caller has just typed
    their old password; here it would tell someone holding only an emailed code
    what the account's current password is. Proving control of the address is
    the credential, and the check is not worth that.
    """

    email = serializers.EmailField(max_length=100)
    code = serializers.CharField(min_length=OTP_LENGTH, max_length=OTP_LENGTH)
    new_password = serializers.CharField(
        write_only=True,
        style={'input_type': 'password'},
        validators=[validate_password],
    )

    def validate(self, attrs):
        user = User.objects.filter(
            email=attrs['email'],
            is_active=True,
        ).first()

        if user is None:
            raise serializers.ValidationError({
                'email': 'No active account uses this email address.',
            })

        reset = OneTimeCode.objects.filter(
            user=user,
            purpose=OneTimeCode.Purpose.PASSWORD_RESET,
        ).first()

        if reset is None:
            raise serializers.ValidationError({
                'code': 'No reset code has been requested for this account.',
            })

        if reset.is_expired:
            raise serializers.ValidationError({
                'code': 'This code has expired. Request a new one.',
            })

        if not secrets.compare_digest(reset.code, attrs['code']):
            raise serializers.ValidationError({
                'code': 'That code is not correct.',
            })

        attrs['user'] = user
        attrs['reset'] = reset
        return attrs

    def save(self):
        user = self.validated_data['user']
        user.set_password(self.validated_data['new_password'])
        user.save(update_fields=['password'])

        # Spent. Without this the same code resets the password again for as
        # long as it has left to live.
        self.validated_data['reset'].delete()
        return user


class AdminUserSerializer(serializers.ModelSerializer):
    """Admin-facing view of any account, for the account management endpoints.

    Only `role` and `is_active` are writable - the two levers CLAUDE.md gives
    Admins ("remove, promote to admin"). A user's own username, email and
    dietary preferences stay theirs to edit via /me/, so a moderation action
    cannot quietly rewrite someone's profile.
    """

    is_admin = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = [
            'user_id',
            'username',
            'email',
            'role',
            'is_admin',
            'is_active',
            'dietary_preferences',
            'created_at',
            'last_login',
        ]
        read_only_fields = [
            'user_id',
            'username',
            'email',
            'dietary_preferences',
            'created_at',
            'last_login',
        ]


class PasswordChangeSerializer(serializers.Serializer):
    """Payload for changing your own password.

    Not a ModelSerializer: nothing here maps onto a field one-to-one, and the
    write has to go through set_password() rather than assignment.
    """

    current_password = serializers.CharField(
        write_only=True,
        style={'input_type': 'password'},
    )
    new_password = serializers.CharField(
        write_only=True,
        style={'input_type': 'password'},
        validators=[validate_password],
    )

    def validate_current_password(self, value):
        # Proving knowledge of the old password is what stops someone with a
        # borrowed access token from locking the real owner out.
        if not self.context['request'].user.check_password(value):
            raise serializers.ValidationError('Current password is incorrect.')
        return value

    def validate_new_password(self, value):
        if self.context['request'].user.check_password(value):
            raise serializers.ValidationError(
                'New password must differ from the current one.'
            )
        return value

    def save(self):
        user = self.context['request'].user
        user.set_password(self.validated_data['new_password'])
        user.save(update_fields=['password'])
        return user
