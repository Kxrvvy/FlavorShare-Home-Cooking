"""Views for the accounts app: registration, logout, and own-profile lookup.

Login and token refresh are handled by SimpleJWT's built-in views, mounted
globally at /api/token/ and /api/token/refresh/ in backend/urls.py. Logout
lives here rather than at SimpleJWT's /api/token/blacklist/ so the three
account actions the frontend needs sit under one prefix.
"""

from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.settings import api_settings as jwt_settings
from rest_framework_simplejwt.tokens import RefreshToken

from .permissions import IsRegisteredUser
from .serializers import RegisterSerializer, UserSerializer


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


class MeView(generics.RetrieveAPIView): # Retrieve = GET
    """GET /api/accounts/me/ - the authenticated user's own profile."""

    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user
