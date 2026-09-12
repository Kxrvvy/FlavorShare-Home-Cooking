"""Receivers that fill the Activity log.

This module is the whole reason `dashboard` can report on the rest of the
project without the rest of the project knowing it exists. Everything here
listens; nothing in recipes, social or meal_plans imports dashboard. Keeping
the dependency pointing this way is the point - reverse it and the apps that
matter start depending on the one that only reports on them.

Connected from DashboardConfig.ready(), which is the only place Django
guarantees every app's models are importable.

Four things worth knowing before adding a receiver here.

`bulk_create` does not fire post_save. The meal plan generator uses it, so a
generated week produces no entries at all - which is what we want: filling a
schedule is one act by one person, not twenty-one separate events. Anything
that should be logged has to be saved one row at a time.

Queryset `.update()` does not fire signals either. RecipeViewSet.retrieve()
increments view_count that way, so views never reach this log - deliberately,
since Recipe.view_count already counts them and the feed would drown.

`raw=True` means a fixture is loading. Those rows are being restored, not
happening, so every receiver skips them.

Every receiver carries a dispatch_uid. ready() can run more than once in some
setups, and without it the receivers would connect twice and log everything
twice.
"""

from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from recipes.models import Recipe
from social.models import Comment, Rating, SavedRecipe

from .models import Activity


@receiver(
    pre_save,
    sender=Recipe,
    dispatch_uid='dashboard.remember_recipe_status',
)
def remember_recipe_status(sender, instance, raw=False, **kwargs):
    """Stash the stored status so post_save can tell a publish from an edit.

    post_save is handed the new row and whether it was created, never what it
    replaced, so "did this just become published" is unanswerable there without
    help.

    Costs one indexed primary-key lookup per recipe save. Recipes are saved
    when somebody creates, edits or publishes one - rarely, in other words -
    and the alternative is overriding from_db to remember the value at load
    time, which is less obvious for the same saving.
    """
    if raw:
        return

    instance._status_before_save = (
        None
        if instance.pk is None
        else Recipe.objects.filter(pk=instance.pk)
        .values_list('status', flat=True)
        .first()
    )


@receiver(post_save, sender=Recipe, dispatch_uid='dashboard.log_recipe')
def log_recipe(sender, instance, created, raw=False, **kwargs):
    """Log a recipe becoming published, or a published recipe changing.

    Drafts produce nothing. A draft is private - visible_recipes() hides it
    from everyone but its author and admins - so an activity feed of drafts
    would be both noise and a list of things not meant to be read yet.

    Note the gap this leaves: unpublishing, which is this project's soft
    moderation action, logs nothing. None of the ERD's five action types
    describes it, and inventing a sixth is an ERD change rather than a
    decision to make here. See the open item in CLAUDE.md.
    """
    if raw or instance.status != Recipe.Status.PUBLISHED:
        return

    was = getattr(instance, '_status_before_save', None)

    if created or was != Recipe.Status.PUBLISHED:
        Activity.log(
            user=instance.user,
            action_type=Activity.ActionType.POSTED,
            description=f'{instance.user.username} published "{instance.title}".',
            recipe=instance,
        )
        return

    # Already published and saved again. Any save counts as an edit, including
    # one that changed nothing - which is honest, if occasionally generous.
    Activity.log(
        user=instance.user,
        action_type=Activity.ActionType.EDITED,
        description=f'{instance.user.username} updated "{instance.title}".',
        recipe=instance,
    )


@receiver(post_save, sender=Comment, dispatch_uid='dashboard.log_comment')
def log_comment(sender, instance, created, raw=False, **kwargs):
    """Log a new review. Editing one's own wording is not an event."""
    if raw or not created:
        return

    Activity.log(
        user=instance.user,
        action_type=Activity.ActionType.COMMENTED,
        description=(
            f'{instance.user.username} reviewed "{instance.recipe.title}".'
        ),
        recipe=instance.recipe,
    )


@receiver(post_save, sender=Rating, dispatch_uid='dashboard.log_rating')
def log_rating(sender, instance, created, raw=False, **kwargs):
    """Log a new rating.

    Only on create. Changing your mind is a PATCH of the same row - the model
    allows one rating per person per recipe - and logging every revision would
    let one person fill the feed.
    """
    if raw or not created:
        return

    Activity.log(
        user=instance.user,
        action_type=Activity.ActionType.RATED,
        description=(
            f'{instance.user.username} rated "{instance.recipe.title}" '
            f'{instance.score}/5.'
        ),
        recipe=instance.recipe,
    )


@receiver(post_save, sender=SavedRecipe, dispatch_uid='dashboard.log_saved')
def log_saved(sender, instance, created, raw=False, **kwargs):
    """Log a recipe being added to someone's collection."""
    if raw or not created:
        return

    Activity.log(
        user=instance.user,
        action_type=Activity.ActionType.SAVED,
        description=(
            f'{instance.user.username} saved "{instance.recipe.title}".'
        ),
        recipe=instance.recipe,
    )
