"""Serializers for user accounts: registration, profile, and auth payloads."""

from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import User


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


class RegisterSerializer(serializers.ModelSerializer):
    """Signup payload.

    `role` is not an input field: new accounts always take the model
    default ('registered'), so a client cannot register itself as admin.
    Username/email uniqueness comes from the model's unique=True, which
    DRF turns into validators automatically.
    """

    password = serializers.CharField(
        write_only=True,
        style={'input_type': 'password'},
        validators=[validate_password],
    )

    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'dietary_preferences']
        extra_kwargs = {
            'dietary_preferences': {'required': False, 'allow_blank': True},
        }

    def create(self, validated_data):
        # create_user() hashes the password; don't duplicate that here.
        return User.objects.create_user(**validated_data)


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
