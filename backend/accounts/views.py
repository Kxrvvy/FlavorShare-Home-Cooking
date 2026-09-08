"""Views for the accounts app: registration and own-profile lookup.

Login and token refresh are handled by SimpleJWT's built-in views, mounted
globally at /api/token/ and /api/token/refresh/ in backend/urls.py.
"""

from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

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


class MeView(generics.RetrieveAPIView): # Retrieve = GET
    """GET /api/accounts/me/ - the authenticated user's own profile."""

    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user
