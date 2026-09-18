"""Dashboard model: Activity.

Mirrors the matching table in flavorshare.sql, with the deviations noted at
each field, the same way the other four apps do. This is the last of the
ERD's 15 tables.

Activity is a log, not user content. Nothing here is ever written by a client:
rows are created server-side when something happens elsewhere in the project -
a recipe published, a review left, a recipe saved - and read only by admins,
who need them for the dashboard's recent-activity feed and its monthly chart.
The receivers that write them live in dashboard/signals.py, so the other apps
never import this one.

The two foreign keys deliberately disagree about deletion, and the reason is
worth reading before changing either. `user` is PROTECT like every other user
FK in the project: removing a user is a deactivation precisely so their history
survives. `recipe` is SET_NULL - "posted a recipe" stays true after the recipe
itself is gone, and a log that erases its own entries when their subject is
deleted is not a log.

One thing to know about every on_delete in this project, not just these two:
Django enforces them in the ORM's collector, not in the schema. The FKs it
generates are ON DELETE NO ACTION whatever the model says, so
`recipe.delete()` nulls this column while a raw `DELETE FROM Recipe` is
refused by the constraint instead. flavorshare.sql declares ON DELETE SET NULL
for this column at the database level; the model matches its *behaviour*
through the ORM, not its DDL. Anything bypassing Django - a hand-written SQL
script, another service - gets the NO ACTION behaviour.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from recipes.models import Recipe
from social.models import Comment


class Activity(models.Model):
    """SQL: Activity - one thing that happened, for the dashboard feed."""

    class ActionType(models.TextChoices):
        POSTED = 'posted', 'Posted a recipe'
        EDITED = 'edited', 'Edited a recipe'
        COMMENTED = 'commented', 'Left a review'
        RATED = 'rated', 'Left a rating'
        SAVED = 'saved', 'Saved a recipe'
        # A sixth value past the ERD's original five - added once there was a
        # concrete moderation action to name, not speculatively. Unpublishing
        # your own recipe or deleting your own review is self-service and logs
        # nothing, the same as editing a draft always has; this is only for
        # someone else's content - see dashboard/signals.py's log_recipe and
        # log_comment_removed for exactly where the line is drawn.
        MODERATED = 'moderated', 'Took a moderation action'

    # activity_id INT AUTO_INCREMENT PRIMARY KEY
    activity_id = models.AutoField(primary_key=True)

    # user_id INT NOT NULL, FK -> Users
    #
    # PROTECT, not the SQL's CASCADE. Same reasoning as Recipe.user and every
    # other user FK here: a hard delete through /admin/ would erase this
    # person's entire history, and the dashboard's reports would quietly
    # disagree with themselves afterwards.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='activities',
    )

    # recipe_id INT NULL, FK -> Recipe ON DELETE SET NULL
    #
    # The one place in this project where the SQL's deletion choice is the right
    # one, so this matches it rather than overriding it. The entry records that
    # something happened; deleting the recipe does not make it stop having
    # happened, so the row survives with a null subject rather than vanishing.
    #
    # Matched in behaviour, not in DDL - see the note in the module docstring.
    #
    # Nullable for a second reason too: not every action has a recipe. Nothing
    # writes such a row today, but the column has to allow it or the SET NULL
    # above could not work.
    recipe = models.ForeignKey(
        Recipe,
        on_delete=models.SET_NULL,
        related_name='activities',
        blank=True,
        null=True,
    )

    # action_type VARCHAR(50)  ->  choices, and NOT NULL
    #
    # A deviation on both counts. The ERD enumerates five actions; MODERATED is
    # a sixth added past it, once there was something concrete for it to name.
    # TextChoices states them where a bare VARCHAR would leave them to be
    # guessed - the same treatment Recipe.status and MealPlanEntry.meal_type
    # get. max_length 9 fits "commented" and "moderated" alike - both 9 - so
    # the column did not need to grow for the new value.
    #
    # NOT NULL although the SQL allows null: an entry that does not say what
    # happened is not worth storing.
    action_type = models.CharField(max_length=9, choices=ActionType.choices)

    # description TEXT
    #
    # NOT NULL, another deviation. Every row written by signals.py carries a
    # readable sentence, and the feed has nothing to render without one.
    #
    # Worth knowing: this stops the column being NULL, not being empty - MySQL
    # accepts '' in a NOT NULL text column. It is a statement of intent for
    # whoever writes the next receiver, not a guarantee.
    description = models.TextField()

    # created_at TIMESTAMP
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'Activity'

        # Newest first - the feed's only useful order. activity_id breaks the
        # tie because created_at is not unique: two activities in the same
        # instant would otherwise let pagination repeat or skip a row.
        ordering = ['-created_at', '-activity_id']

        indexes = [
            # Every read of this table either sorts by created_at (the feed) or
            # groups by it (the monthly chart), and it is the one table here
            # that grows without bound. Same reasoning as recipe_status_idx.
            models.Index(fields=['-created_at'], name='activity_created_idx'),
        ]

        verbose_name_plural = 'activities'

    def __str__(self):
        return f'{self.user.username} {self.action_type}: {self.description}'

    @classmethod
    def log(cls, user, action_type, description, recipe=None):
        """Record one thing that happened.

        The only way a row should enter this table. It exists so signals.py
        stays a list of "what counts as an event" rather than five copies of
        the same create() call, and so anything added later - a management
        command, a future notification - writes rows the same shape.

        Deliberately not silent about bad input: a log entry naming no actor or
        no action is worse than a missing one, because it looks like data.
        """
        return cls.objects.create(
            user=user,
            recipe=recipe,
            action_type=action_type,
            description=description,
        )


class Report(models.Model):
    """Not in the original 15-table ERD - added to close a named gap.

    Feature 8 asks the Admin Dashboard for a "pending moderation" count, but
    nothing recorded that a recipe or a review had *been* reported, so there
    was no queue to count - see the note this replaces in serializers.py and
    views.py. A recipe or a comment, never both: exactly one of `recipe` and
    `comment` must be set, the same either/or `Activity.recipe` deliberately
    is not - here the target is the whole point of the row, not an optional
    extra. Enforced twice for the reason every other cross-field rule in this
    project is: clean() is what a serializer or the Django admin's ModelForm
    actually calls, and the CheckConstraint is what still holds if either is
    bypassed - a fixture, a shell, a data migration.

    Filed by a registered user (dashboard/views.py's ReportViewSet.create),
    reviewed and closed by an admin. Resolving a report does not itself take
    the moderation action - unpublishing a recipe or deleting a comment stays
    the existing admin/recipes and admin/comments controls, which already log
    or don't per their own rules. A report just tracks that someone flagged
    something and whether an admin has looked at it.
    """

    class Reason(models.TextChoices):
        SPAM = 'spam', 'Spam or advertising'
        INAPPROPRIATE = 'inappropriate', 'Inappropriate content'
        MISINFORMATION = 'misinformation', 'Misinformation'
        OTHER = 'other', 'Other'

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        RESOLVED = 'resolved', 'Resolved'
        DISMISSED = 'dismissed', 'Dismissed'

    report_id = models.AutoField(primary_key=True)

    # PROTECT, like every other user FK here: removing a reporter is a
    # deactivation, not a reason to erase what they flagged.
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='filed_reports',
    )

    # Both nullable, both CASCADE: unlike Activity's log, a report has nothing
    # left to say once its subject is gone, so it disappears with it rather
    # than surviving as a record of a report about nothing.
    recipe = models.ForeignKey(
        Recipe,
        on_delete=models.CASCADE,
        related_name='reports',
        blank=True,
        null=True,
    )
    comment = models.ForeignKey(
        Comment,
        on_delete=models.CASCADE,
        related_name='reports',
        blank=True,
        null=True,
    )

    reason = models.CharField(max_length=14, choices=Reason.choices)
    details = models.TextField(blank=True)

    status = models.CharField(
        max_length=9,
        choices=Status.choices,
        default=Status.PENDING,
    )

    # Who closed it and when - null while status is still pending. PROTECT
    # for the same reason as `reporter`; a deactivated admin's past decisions
    # should not need explaining away.
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='resolved_reports',
        blank=True,
        null=True,
    )
    resolved_at = models.DateTimeField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'Report'
        ordering = ['-created_at', '-report_id']
        constraints = [
            models.CheckConstraint(
                condition=(
                    (models.Q(recipe__isnull=False) & models.Q(comment__isnull=True))
                    | (models.Q(recipe__isnull=True) & models.Q(comment__isnull=False))
                ),
                name='report_targets_exactly_one_thing',
            ),
        ]
        indexes = [
            # The queue's default view: pending reports, newest first.
            models.Index(fields=['status', '-created_at'], name='report_status_idx'),
        ]

    def __str__(self):
        target = f'recipe #{self.recipe_id}' if self.recipe_id else f'comment #{self.comment_id}'
        return f'{self.reporter.username} reported {target} ({self.reason})'

    def clean(self):
        if bool(self.recipe_id) == bool(self.comment_id):
            raise ValidationError(
                'Report exactly one recipe or one comment, not both or neither.'
            )
