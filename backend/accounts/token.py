"""Login, with a lockout and a one-session-at-a-time rule: /api/token/
replaces SimpleJWT's stock view with this module's, everything else about
issuing a token is unchanged.

Three wrong passwords for one username locks that username out for fifteen
minutes, tracked in Django's cache rather than a new column - no migration,
and it self-expires (the cache entry's own timeout is the lockout, not
something a cron job has to clear).

Keyed on the submitted username, not the caller's IP. That is a deliberate
trade, not an oversight: it stops credential-stuffing against one account
from any number of source IPs, which is the more common real attack, at the
cost of letting someone lock a legitimate user out for fifteen minutes by
typing their username with a wrong password three times, without needing to
know anything else about them. Accepted at this project's scale; pairing it
with an IP-based throttle would close that gap and is depth-pass work - see
CLAUDE.md.

The lockout message reaches the frontend for free: DRF's exception handler
serialises Throttled as {"detail": "..."}, and the login page already reads
`error.response.data.detail` for every other login failure - see
app/login/page.tsx. No frontend change was needed for this.

Every successful login also blacklists every *other* refresh token this
account holds, so signing in on a new device ends every session opened
before it - the same "revoke every outstanding refresh token" call
PasswordChangeView and PasswordResetConfirmView already make on a password
change, just excluding the one this very login just issued instead of
excluding nothing.

What this cannot do, because no JWT setup can: recall an access token
already handed out. A device signed out this way keeps working - reading,
posting, whatever its last access token allows - until that token's own
expiry (ACCESS_TOKEN_LIFETIME, thirty minutes), the same limit
LogoutView's docstring names for an explicit sign-out. Only the *next*
silent refresh, which every page already attempts once an access token
expires, finds its refresh token blacklisted and fails - and
lib/auth.ts's refreshSession() already treats that failure as "signed
out" and clears the session, so the old device's next request is what
actually ends it, not this endpoint directly.
"""

import time

from django.core.cache import cache
from rest_framework.exceptions import Throttled
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.token_blacklist.models import (
    BlacklistedToken,
    OutstandingToken,
)
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

MAX_LOGIN_ATTEMPTS = 3
LOCKOUT_SECONDS = 15 * 60


def _attempts_key(username):
    return f'login_failures:{username}'


def _lockout_key(username):
    return f'login_lockout:{username}'


class LockoutTokenObtainPairSerializer(TokenObtainPairSerializer):
    """TokenObtainPairSerializer, with attempts counted before credentials
    are ever checked and cleared the moment they succeed."""

    def validate(self, attrs):
        username = attrs.get(self.username_field) or ''

        unlocks_at = cache.get(_lockout_key(username)) if username else None
        if unlocks_at:
            raise Throttled(
                wait=max(0, int(unlocks_at - time.time())),
                detail=(
                    'Too many failed login attempts. '
                    'Try again after 15 minutes.'
                ),
            )

        try:
            data = super().validate(attrs)
        except Exception as exc:
            # The failure that reaches MAX_LOGIN_ATTEMPTS announces the
            # lockout immediately, in its own response, rather than
            # answering normally and making the caller find out only on a
            # fourth try - "3 attempts, then a 15-minute timeout" means the
            # third one is the one that hears about it.
            if username and self._register_failure(username):
                raise Throttled(
                    wait=LOCKOUT_SECONDS,
                    detail=(
                        'Too many failed login attempts. '
                        'Try again after 15 minutes.'
                    ),
                ) from exc
            raise

        # A correct login forgives whatever partial count came before it -
        # this is a lockout on repeated wrong guesses, not a running tally
        # against the account.
        cache.delete(_attempts_key(username))
        cache.delete(_lockout_key(username))

        self._end_other_sessions(data['refresh'])
        return data

    def _end_other_sessions(self, new_refresh):
        """One session at a time: revoke every refresh token this account
        holds except the one issued by this very login.

        self.user is set by TokenObtainSerializer.validate(), the innermost
        call already made by the time this runs. new_refresh is the encoded
        string super().validate() put in `data["refresh"]` - decoding it
        back is the only way to name its own jti and exclude it, since it
        was not registered as an OutstandingToken until that call created
        it, and there was nothing to hold a reference to before then.
        """
        new_jti = RefreshToken(new_refresh)['jti']
        others = OutstandingToken.objects.filter(
            user=self.user,
        ).exclude(jti=new_jti)
        for token in others:
            BlacklistedToken.objects.get_or_create(token=token)

    def _register_failure(self, username):
        """Counts one failed attempt. Returns True exactly once per lockout -
        on the attempt that just reached the limit - so the caller can turn
        that one response into the lockout message instead of the usual
        "wrong credentials" one."""
        key = _attempts_key(username)
        # Django's cache has no atomic increment-with-default across every
        # backend (LocMemCache included), so this reads then writes rather
        # than calling cache.incr(), which raises ValueError on a missing
        # key instead of starting it at zero.
        attempts = (cache.get(key) or 0) + 1

        if attempts >= MAX_LOGIN_ATTEMPTS:
            cache.set(
                _lockout_key(username),
                time.time() + LOCKOUT_SECONDS,
                timeout=LOCKOUT_SECONDS,
            )
            cache.delete(key)
            return True

        cache.set(key, attempts, timeout=LOCKOUT_SECONDS)
        return False


class LockoutTokenObtainPairView(TokenObtainPairView):
    """The view backend/urls.py mounts at /api/token/ instead of SimpleJWT's
    own - same endpoint, same response shape, this serializer's lockout."""

    serializer_class = LockoutTokenObtainPairSerializer
