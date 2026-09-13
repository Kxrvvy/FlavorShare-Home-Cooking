"""Outbound email for the accounts app: signup codes and password resets.

The layer between a one-time code and the person who needs to read it. Modelled
on the Cloudinary upload endpoint, which solves the same shape of problem, and
borrowing three of its decisions.

The API key is read here and never leaves the server. That is the reason this
module exists at all rather than the frontend talking to Resend - and it is why
no endpoint ever returns a code in its response, not even to the address that
just asked for one.

Credentials are checked before anything is sent, and a missing key raises
EmailNotConfigured rather than failing somewhere inside the SDK. A teammate who
cloned without a .env deserves to be told that, not shown a traceback.

Nothing here knows about HTTP. These are exceptions, not Response objects,
because "the server has no email credentials" is a 503 and "Resend refused the
message" is a 502, and deciding that is the view's job. Keeping it out of here
is also what lets the serializers and a future management command call the same
functions.
"""

import resend
from django.conf import settings

from .models import OTP_TTL


class EmailNotConfigured(Exception):
    """No RESEND_API_KEY is set, so nothing can be sent.

    A deployment problem, not a caller's mistake - the views answer 503.
    """


class EmailDeliveryFailed(Exception):
    """Resend accepted the request and refused the message.

    Their problem or our payload's, not the caller's - the views answer 502.
    """


def _minutes_valid():
    """How long a code lasts, in whole minutes, for the message body.

    Read from OTP_TTL rather than written as "10" in two email templates, so
    changing the expiry cannot leave the emails claiming the old one.
    """
    return int(OTP_TTL.total_seconds() // 60)


def send_email(to, subject, text, html):
    """Send one message, or raise.

    The API key is assigned per call rather than once at import, for the same
    reason the Cloudinary upload passes its credentials per call: settings are
    read every time, so a test can override them and a key added to .env takes
    effect on reload rather than at whatever moment this module was first
    imported.

    Only ResendError is translated. A transport-level failure - DNS, a dropped
    connection - is deliberately left to bubble into a 500, because that is a
    different kind of broken from "Resend said no" and flattening the two would
    hide it.
    """
    api_key = settings.RESEND_API_KEY

    if not api_key:
        raise EmailNotConfigured(
            'Email is not configured on this server. Set RESEND_API_KEY - '
            'see README.md.'
        )

    resend.api_key = api_key

    try:
        return resend.Emails.send({
            # 'from' is a Python keyword, which is why this is a dict rather
            # than keyword arguments.
            'from': settings.RESEND_FROM_EMAIL,
            'to': [to],
            'subject': subject,
            'text': text,
            'html': html,
        })
    except resend.exceptions.ResendError as exc:
        raise EmailDeliveryFailed(str(exc)) from exc


def send_signup_code(pending):
    """Email the verification code for a PendingSignup.

    Takes the row rather than an address and a code, so no caller can pair one
    person's code with another's address.
    """
    minutes = _minutes_valid()
    code = pending.code

    text = (
        f'Hi {pending.username},\n\n'
        f'Your FlavorShare verification code is {code}.\n\n'
        f'Enter it within {minutes} minutes to finish creating your account. '
        f'Your account is not created until you do.\n\n'
        f'If you did not sign up, you can ignore this email - nothing has '
        f'been created in your name.\n'
    )

    html = (
        f'<p>Hi {pending.username},</p>'
        f'<p>Your FlavorShare verification code is '
        f'<strong style="font-size:1.25em;letter-spacing:0.1em">{code}</strong>'
        f'</p>'
        f'<p>Enter it within {minutes} minutes to finish creating your '
        f'account. Your account is not created until you do.</p>'
        f'<p>If you did not sign up, you can ignore this email &mdash; '
        f'nothing has been created in your name.</p>'
    )

    return send_email(
        to=pending.email,
        subject=f'Your FlavorShare verification code: {code}',
        text=text,
        html=html,
    )


def send_password_reset_code(one_time_code):
    """Email the reset code for an existing account.

    Takes the OneTimeCode row for the same reason as above - the address comes
    from the account the code belongs to, never from the request.
    """
    minutes = _minutes_valid()
    user = one_time_code.user
    code = one_time_code.code

    text = (
        f'Hi {user.username},\n\n'
        f'Your FlavorShare password reset code is {code}.\n\n'
        f'It works for {minutes} minutes. Your password stays as it is until '
        f'you use it.\n\n'
        f'If you did not ask to reset your password, ignore this email and '
        f'nothing will change.\n'
    )

    html = (
        f'<p>Hi {user.username},</p>'
        f'<p>Your FlavorShare password reset code is '
        f'<strong style="font-size:1.25em;letter-spacing:0.1em">{code}</strong>'
        f'</p>'
        f'<p>It works for {minutes} minutes. Your password stays as it is '
        f'until you use it.</p>'
        f'<p>If you did not ask to reset your password, ignore this email and '
        f'nothing will change.</p>'
    )

    return send_email(
        to=user.email,
        subject=f'Your FlavorShare password reset code: {code}',
        text=text,
        html=html,
    )
