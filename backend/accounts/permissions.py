"""Role and ownership permissions shared by every app.

Person 1 owns roles, so the other apps import their permission classes from
here instead of re-deriving the rules:

    from accounts.permissions import IsAdmin, IsRegisteredUserOrReadOnly

The three roles from CLAUDE.md map onto these classes as:

    Guest Users       anonymous callers - read-only, via the *OrReadOnly classes
    Registered Users  IsRegisteredUser / IsRegisteredUserOrReadOnly
    Admin             IsAdmin

Prefer composing these with DRF's operators over adding new classes here.
The common moderation rule - authors edit their own content, admins moderate
anything - is:

    permission_classes = [IsOwnerOrReadOnly | IsAdmin]

Scope note: these gate *actions*, not *rows*. "Guests see published recipes
but never drafts" is queryset filtering and belongs in the view's
get_queryset(), not in a permission class.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission


def _is_registered(user):
    """True for a signed-in account that is not a guest.

    Every check below starts here because anonymous callers arrive as
    AnonymousUser, which has no `role`. Reading it unguarded raises
    AttributeError, which DRF surfaces as a 500 instead of a clean 401.
    """
    return bool(
        user
        and user.is_authenticated
        and user.role != user.Role.GUEST
    )


class IsAdmin(BasePermission):
    """Admin role only.

    For the admin-only surfaces: the dashboard and its reports, moderation
    actions, and account management.
    """

    message = 'Only administrators may perform this action.'

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_admin)


class IsRegisteredUser(BasePermission):
    """Signed-in, non-guest accounts only - reads included.

    For endpoints a guest has no business seeing at all: meal plans, saved
    recipes, a user's own profile.
    """

    message = 'You must be signed in to perform this action.'

    def has_permission(self, request, view):
        return _is_registered(request.user)


class IsRegisteredUserOrReadOnly(BasePermission):
    """Anyone may read; only registered users may write.

    This is what lets Guest Users browse, search, and view recipes while the
    project-wide default stays IsAuthenticated. Expect it on most public
    viewsets - recipes, ratings, comments, tags.
    """

    message = 'You must be signed in to perform this action.'

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return _is_registered(request.user)


class IsOwnerOrReadOnly(BasePermission):
    """Object-level: anyone may read, only the owner may modify.

    The owning field differs per model - Recipe, Rating, Comment and MealPlan
    use `user`, while Image uses `uploaded_by` - so the view names it and the
    default covers everything else:

        class ImageViewSet(...):
            permission_classes = [IsOwnerOrReadOnly]
            owner_field = 'uploaded_by'

    Whatever the name, the field must be a ForeignKey to accounts.User so the
    comparison below is user-to-user.

    DRF only runs object-level checks on objects fetched through
    get_object(), so pair this with IsRegisteredUserOrReadOnly to gate list
    and create routes as well.
    """

    message = 'You may only modify your own content.'

    #: Used when the view does not declare an owner_field of its own.
    owner_field = 'user'

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True

        user = request.user
        if not (user and user.is_authenticated):
            return False

        owner_field = getattr(view, 'owner_field', self.owner_field)
        owner = getattr(obj, owner_field, None)

        # A missing attribute means the view named a field its model does not
        # have. Fail closed: a typo in owner_field should deny everyone and
        # get caught, not quietly hand the object to any signed-in user.
        return owner is not None and owner == user
