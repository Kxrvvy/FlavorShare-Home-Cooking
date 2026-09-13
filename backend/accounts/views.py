"""Views for the accounts app: signup, verification, password reset, profile.

Login and token refresh are handled by SimpleJWT's built-in views, mounted
globally at /api/token/ and /api/token/refresh/ in backend/urls.py. Logout
lives here rather than at SimpleJWT's /api/token/blacklist/ so the account
actions the frontend needs sit under one prefix.

Signup is two requests, because an account is only created once its address is
proven: /register/ writes a PendingSignup and emails a code, /verify-email/
turns that into a User and hands back tokens. Nothing in between exists as an
account, which is why no view here has to ask whether one is verified.

Four of these views are open to anonymous callers - they are what somebody uses
*before* they have credentials - so each opts out of the project-wide
IsAuthenticated default explicitly.

Email failures become HTTP status codes here and nowhere else.
accounts/emails.py raises exceptions rather than returning responses, so that
the same functions can be called from a management command later; translating
them is this layer's job.
"""

from django.db import transaction
from rest_framework import generics, mixins, status, viewsets
from rest_framework.exceptions import APIException, ValidationError
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

from .emails import (
    EmailDeliveryFailed,
    EmailNotConfigured,
    send_password_reset_code,
    send_signup_code,
)
from .models import User
from .permissions import IsAdmin, IsRegisteredUser
from .serializers import (
    AdminUserSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    ResendOTPSerializer,
    UserSerializer,
    VerifyEmailSerializer,
)


class EmailUnavailable(APIException):
    """503 - this server cannot send email at all.

    A deployment problem, not the caller's. Mirrors the 503 the Cloudinary
    upload endpoint answers when its credentials are missing, and says the same
    kind of thing: the feature is not configured here, and retrying the same
    request will not help.
    """

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE


class EmailUndeliverable(APIException):
    """502 - Resend was reachable and refused the message."""

    status_code = status.HTTP_502_BAD_GATEWAY


def deliver(send, row):
    """Send one code email, turning its failures into status codes.

    Called inside an atomic block by every view that issues a code, so a
    failure here rolls the code back with it. That matters most on a resend:
    if the new code cannot be delivered, the caller keeps the one they were
    already sent rather than being left holding a code the server has
    forgotten.
    """
    try:
        send(row)
    except EmailNotConfigured as exc:
        raise EmailUnavailable(str(exc)) from exc
    except EmailDeliveryFailed as exc:
        raise EmailUndeliverable(
            f'The verification email could not be sent: {exc}'
        ) from exc


class RegisterView(generics.CreateAPIView): # Create = POST
    """POST /api/accounts/register/ - start a signup and email a code.

    Creates no account. It writes a PendingSignup and sends a verification code;
    /verify-email/ is what creates the User. Re-posting the same address reissues
    the code on the existing row rather than adding another - see
    RegisterSerializer.create().

    Answers 202, not 201. A row was created, but not the thing the caller asked
    for: there is no account yet, and there may never be. 202 says "accepted,
    not finished", which is exactly the state. Note this is a change from the
    endpoint's previous behaviour, which returned 201 and a user profile.

    The response deliberately carries no code. The code goes to the address
    being proven and nowhere else - returning it here would make the whole
    exercise decorative.

    Open to anonymous callers; the project-wide default is IsAuthenticated, so
    this opts out explicitly.
    """

    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]

    def create(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Atomic so a failed send leaves nothing behind. Without it a caller
        # could be told the server is broken while a pending row - holding a
        # code they never received - sits in the way of their next attempt.
        with transaction.atomic():
            pending = serializer.save()
            deliver(send_signup_code, pending)

        return Response(
            {
                'email': pending.email,
                'expires_at': pending.expires_at,
                'detail': (
                    'We sent a verification code to your email address. '
                    'Enter it to finish creating your account.'
                ),
            },
            status=status.HTTP_202_ACCEPTED,
        )


class VerifyEmailView(APIView):
    """POST /api/accounts/verify-email/ - prove the address and get the account.

    Expects {"email": ..., "code": ...}. On success the User is created, the
    PendingSignup is deleted, and the response carries tokens so the caller
    lands in the app rather than at a login form they just proved they do not
    need.

    201, because this is the request that creates the account.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        # for_user() issues a fresh pair and, with the blacklist app installed,
        # registers the refresh token as outstanding - so a later password
        # change can revoke it like any other.
        refresh = RefreshToken.for_user(user)

        return Response(
            {
                'user': UserSerializer(user).data,
                'refresh': str(refresh),
                'access': str(refresh.access_token),
            },
            status=status.HTTP_201_CREATED,
        )


class ResendOTPView(APIView):
    """POST /api/accounts/resend-otp/ - email a fresh code for a live signup.

    Expects {"email": ...}. The new code gets a full ten minutes, not whatever
    was left of the old one: resending because the first mail never arrived
    should not hand someone a code that dies in ninety seconds.

    An expired signup is not revived here. It is a 400 telling the caller to
    register again, because reviving it would make the expiry mean nothing.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ResendOTPSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            pending = serializer.save()
            deliver(send_signup_code, pending)

        return Response(
            {
                'email': pending.email,
                'expires_at': pending.expires_at,
                'detail': 'We sent a new verification code to your email.',
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetRequestView(APIView):
    """POST /api/accounts/password-reset/request/ - email a reset code.

    Expects {"email": ...}. Unlike signup this acts on an account that already
    exists, so the code hangs off a OneTimeCode row keyed to that User.

    Asking twice reissues the code on the same row rather than putting a second
    valid one in circulation - the model's UniqueConstraint makes that the only
    available shape.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            code = serializer.save()
            deliver(send_password_reset_code, code)

        return Response(
            {
                'email': code.user.email,
                'expires_at': code.expires_at,
                'detail': 'We sent a password reset code to your email.',
            },
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    """POST /api/accounts/password-reset/confirm/ - set a new password.

    Expects {"email": ..., "code": ..., "new_password": ...}, and answers 204.

    Revokes every refresh token the account holds, for the same reason
    PasswordChangeView does: a reset is often a response to losing control of
    the account, and it is worth nothing if the session that took it over
    survives. Access tokens already issued stay valid until they expire - see
    LogoutView.

    No tokens are returned. Unlike verification, nothing here proves the caller
    is at a browser that should be signed in - the code may have been read off
    a screen - so they log in with the password they just set.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        for token in OutstandingToken.objects.filter(user=user):
            BlacklistedToken.objects.get_or_create(token=token)

        return Response(status=status.HTTP_204_NO_CONTENT)


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
