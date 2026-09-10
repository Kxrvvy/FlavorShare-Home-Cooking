"""Ownership rule for the rows that hang off a Recipe.

accounts.permissions owns the role rules and the plain "is this yours?"
comparison, and this module does not repeat either. Steps, ingredient links
and images simply have no user column of their own - their owner is the
author of the recipe they belong to - so IsOwnerOrReadOnly cannot find an
owner on them and fails closed, denying everyone including the author.

This redirects that same check one hop, at the object, and leaves the
comparison itself to the class it inherits from.
"""

from accounts.permissions import IsOwnerOrReadOnly


class IsRecipeOwnerOrReadOnly(IsOwnerOrReadOnly):
    """Object-level: anyone may read, only the recipe's author may modify.

    Pair it with IsRegisteredUserOrReadOnly the same way the parent class
    documents, and compose it with IsAdmin for the moderation case:

        permission_classes = [
            IsRegisteredUserOrReadOnly,
            IsRecipeOwnerOrReadOnly | IsAdmin,
        ]

    Object-level checks never run on create, so a view using this must still
    verify at create time that the caller owns the recipe it is writing into
    - see RecipeChildViewSet.perform_create.
    """

    message = 'You may only modify your own recipes.'

    def has_object_permission(self, request, view, obj):
        recipe = getattr(obj, 'recipe', None)

        # Same fail-closed reasoning as the parent: a missing recipe means
        # this class was attached to a model it does not fit, and that should
        # deny everyone and get caught rather than wave the object through.
        if recipe is None:
            return False

        return super().has_object_permission(request, view, recipe)
