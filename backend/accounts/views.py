"""Views for the accounts app: registration, logout, and own-profile lookup.

Login and token refresh are handled by SimpleJWT's built-in views, mounted
globally at /api/token/ and /api/token/refresh/ in backend/urls.py. Logout
lives here rather than at SimpleJWT's /api/token/blacklist/ so the three
account actions the frontend needs sit under one prefix.
"""

from rest_framework import generics, mixins, status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.settings import api_settings as jwt_settings
from rest_framework_simplejwt.token_blacklist.models import (
    BlacklistedToken,
    OutstandingToken,
)
from rest_framework_simplejwt.tokens import RefreshToken

from .models import User
from .permissions import IsAdmin, IsRegisteredUser
from .serializers import (
    AdminUserSerializer,
    PasswordChangeSerializer,
    RegisterSerializer,
    UserSerializer,
)


class RegisterView(generics.CreateAPIView): # Create = POST
    """POST /api/accounts/register/ - create a new registered user.

    Open to anonymous callers; the project-wide default permission is
    IsAuthenticated, so this has to opt out explicitly.
    """

    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]

    def create(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        # Respond with the profile shape rather than the register payload,
        # so the write-only password field is never echoed back.
        return Response(
            UserSerializer(user).data,
            status=status.HTTP_201_CREATED,
        )


class LogoutView(APIView):
    """POST /api/accounts/logout/ - revoke the caller's refresh token.

    Expects {"refresh": "<token>"} and answers 204 with no body.

    The access token is deliberately left alone: a JWT carries its own
    expiry and cannot be recalled once issued, so it stays usable until
    ACCESS_TOKEN_LIFETIME runs out. That window is the reason the lifetime
    is kept short in settings rather than relying on this endpoint.
    """

    permission_classes = [IsRegisteredUser]

    def post(self, request):
        raw_token = request.data.get('refresh')
        if not raw_token:
            raise ValidationError({'refresh': 'This field is required.'})

        try:
            token = RefreshToken(raw_token)
        except TokenError:
            # Expired, malformed, or already blacklisted. They are reported
            # identically so the endpoint cannot be used to probe which
            # tokens are real.
            raise ValidationError({'refresh': 'Token is invalid or expired.'})

        # A refresh token is a bearer credential, so anyone holding one could
        # already use it. Still, refuse to let a signed-in account revoke a
        # token belonging to someone else.
        #
        # str() on both sides: SimpleJWT stringifies the id when it builds the
        # claim, so comparing it straight to our integer user_id never matches
        # and would reject every valid token.
        claimed_user_id = token.get(jwt_settings.USER_ID_CLAIM)
        if str(claimed_user_id) != str(request.user.user_id):
            raise ValidationError({'refresh': 'Token is invalid or expired.'})

        token.blacklist()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(generics.RetrieveUpdateAPIView): # Retrieve = GET, Update = PUT/PATCH
    """GET / PUT / PATCH /api/accounts/me/ - the caller's own profile.

    Editable: username, email, dietary_preferences. `role` stays read-only on
    the serializer, so a user cannot promote itself by PATCHing this endpoint.

    PATCH is the one to use from the frontend; PUT is accepted but requires
    every writable field in the body.
    """

    serializer_class = UserSerializer
    permission_classes = [IsRegisteredUser]

    def get_object(self):
        return self.request.user


class PasswordChangeView(APIView):
    """POST /api/accounts/password/ - change your own password.

    Requires the current password, and revokes every refresh token the account
    holds, so a session opened with the old password cannot be extended. Access
    tokens already issued stay valid until they expire - see LogoutView.
    """

    permission_classes = [IsRegisteredUser]

    def post(self, request):
        serializer = PasswordChangeSerializer(
            data=request.data,
            context={'request': request},
        )
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        # Changing a password should end other sessions. Blacklisting every
        # outstanding refresh token is what makes that true - without it, a
        # stolen refresh token survives the password change that was meant to
        # shut it out.
        for token in OutstandingToken.objects.filter(user=user):
            BlacklistedToken.objects.get_or_create(token=token)

        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminUserViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Admin-only account management under /api/accounts/users/.

        GET    /users/          list, searchable and filterable
        GET    /users/<id>/     one account
        PATCH  /users/<id>/     change role or is_active
        DELETE /users/<id>/     deactivate (see below)

    There is deliberately no POST: accounts are created by signing up, so an
    admin cannot mint one with a password only they know.

    DELETE deactivates rather than destroys. Hard-deleting a user would take
    their recipes, ratings and comments with it, turning a moderation call
    into content loss that cannot be undone - so the row stays and is_active
    goes False. Reverse it with PATCH {"is_active": true}.
    """

    serializer_class = AdminUserSerializer
    permission_classes = [IsAdmin]

    # Ordered so pagination is stable; an unordered queryset can repeat or
    # skip rows between pages.
    queryset = User.objects.all().order_by('username')

    filterset_fields = ['role', 'is_active']
    search_fields = ['username', 'email']
    ordering_fields = ['username', 'created_at', 'role']

    def _refuse_self_lockout(self, target, role, is_active):
        """Stop an admin removing their own access.

        Without this an admin can demote or deactivate themselves and lose
        the ability to undo it - and if they are the only admin, nobody can.
        Superusers keep admin rights regardless of role, so the check asks
        what the account would look like after the change rather than
        comparing the role alone.
        """
        if target != self.request.user:
            return

        would_be_admin = target.is_superuser or role == User.Role.ADMIN
        if not would_be_admin or not is_active:
            raise ValidationError(
                'You cannot remove your own admin access. Ask another admin '
                'to do it for you.'
            )

    def perform_update(self, serializer):
        target = serializer.instance
        self._refuse_self_lockout(
            target,
            serializer.validated_data.get('role', target.role),
            serializer.validated_data.get('is_active', target.is_active),
        )
        serializer.save()

    def perform_destroy(self, instance):
        self._refuse_self_lockout(instance, instance.role, False)

        instance.is_active = False
        instance.save(update_fields=['is_active'])

        # Deactivation has to end the session too. Without this the account
        # keeps refreshing its way to new access tokens and stays usable
        # despite being switched off.
        for token in OutstandingToken.objects.filter(user=instance):
            BlacklistedToken.objects.get_or_create(token=token)
