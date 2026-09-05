"""Serializers for user accounts: registration, profile, and auth payloads."""

from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import User


class UserSerializer(serializers.ModelSerializer):
    """Read-only view of a user, used by /me/ and the register response.

    `role` is deliberately read-only so a user can never promote itself.
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
