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

from django.db.models.signals import post_delete, post_save, pre_save
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
    """Log a recipe becoming published, a published recipe changing, or one
    being moderated back to draft.

    Drafts produce nothing on the way in. A draft is private - visible_recipes()
    hides it from everyone but its author and admins - so an activity feed of
    drafts would be both noise and a list of things not meant to be read yet.

    Going the other way - published back to draft - used to log nothing at
    all, unconditionally: none of the ERD's five action types described
    unpublishing, and it was an open item in CLAUDE.md rather than a decision
    made here. MODERATED is that decision, but only for half of this case.
    recipes.views.RecipeViewSet._set_status stashes `_actor` before saving,
    which is the only way this signal can tell "the author pulled their own
    recipe back" - self-service, as unremarkable as editing a draft - from
    "someone else did", which given the permission class on that endpoint
    (IsOwnerOrReadOnly | IsAdmin) can only be an admin. No `_actor` at all
    means the save did not come through that endpoint - a direct .save() from
    the shell, a fixture, the Django admin - and logs nothing rather than
    guessing at who or why.
    """
    if raw:
        return

    was = getattr(instance, '_status_before_save', None)

    if instance.status == Recipe.Status.DRAFT:
        if was != Recipe.Status.PUBLISHED:
            return

        actor = getattr(instance, '_actor', None)
        if actor is None or actor.pk == instance.user_id:
            return

        Activity.log(
            user=actor,
            action_type=Activity.ActionType.MODERATED,
            description=(
                f'{actor.username} unpublished "{instance.title}" '
                f'by {instance.user.username}.'
            ),
            recipe=instance,
        )
        return

    # Only DRAFT and PUBLISHED exist today, and DRAFT already returned above,
    # so this is reachable only for PUBLISHED - kept as a real check rather
    # than assumed, so a third status added later without updating this
    # function logs nothing instead of being misread as an edit.
    if instance.status != Recipe.Status.PUBLISHED:
        return

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


@receiver(post_delete, sender=Comment, dispatch_uid='dashboard.log_comment_removed')
def log_comment_removed(sender, instance, **kwargs):
    """Log an admin removing someone else's review - the moderation path
    social.views.CommentViewSet's own docstring already names.

    Deleting your own review is cleanup, not an event - the same reasoning
    log_recipe uses for a self-unpublish. social.views.CommentViewSet.
    perform_destroy stashes `_actor` before deleting, the only way this
    signal can tell the two apart; no `_actor` means the row went through
    some other path (the Django admin, a shell) and logs nothing rather than
    guessing.

    post_delete carries no `raw` kwarg - fixture teardown does not delete
    rows one at a time - so there is nothing to guard against here the way
    every post_save receiver above does.
    """
    actor = getattr(instance, '_actor', None)
    if actor is None or actor.pk == instance.user_id:
        return

    Activity.log(
        user=actor,
        action_type=Activity.ActionType.MODERATED,
        description=(
            f'{actor.username} removed a review by {instance.user.username} '
            f'on "{instance.recipe.title}".'
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
