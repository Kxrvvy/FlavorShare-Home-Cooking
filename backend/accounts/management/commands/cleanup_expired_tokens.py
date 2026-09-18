"""Delete expired PendingSignup and OneTimeCode rows.

Neither table is ever pruned on its own. Every read already goes through
OneTimeCodeQuerySet.active(), so an expired row breaks nothing by sitting
there - a stale signup can't be verified, a stale reset code can't be used -
but nothing deletes it either, and CLAUDE.md names that growth as depth-pass
work. This command is that pass: run it by hand, or point cron/a scheduled
task at it, whichever this project ends up hosted with.

Deliberately not folded into a Celery beat schedule or Django signal - this
project has no background task runner, and expiry is not an event anything
could react to as it happens.

Safe to run at any time and as often as you like: `.expired()` is a plain
`expires_at <= now()` comparison, and there is nothing here a live signup or
reset flow depends on mid-request, since PendingSignup.expires_at is checked
independently at read time.
"""

from django.core.management.base import BaseCommand

from accounts.models import OneTimeCode, PendingSignup


class Command(BaseCommand):
    help = 'Delete expired PendingSignup and OneTimeCode rows.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report how many rows would be deleted, without deleting them.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        for model in (PendingSignup, OneTimeCode):
            expired = model.objects.expired()
            count = expired.count()

            if dry_run:
                self.stdout.write(f'{model.__name__}: {count} expired row(s) would be deleted.')
                continue

            # .delete() rather than iterating and calling it per-row: these
            # rows have no FKs pointing at them - PendingSignup isn't a User
            # yet, and OneTimeCode's own on_delete is CASCADE from the user
            # side, not into it - so a bulk queryset delete is exactly as
            # thorough as a loop and one query instead of `count` of them.
            deleted, _ = expired.delete()
            self.stdout.write(
                self.style.SUCCESS(f'{model.__name__}: deleted {deleted} expired row(s).')
            )
