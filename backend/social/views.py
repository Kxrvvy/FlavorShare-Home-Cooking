"""Views for the social app: ratings, comments, tags and saved recipes.

Two different ownership rules live here, and picking the wrong one is the
easiest mistake to make in this app.

A Rating, Comment or SavedRecipe is owned by the person who wrote it. It has
its own `user` column, so accounts.permissions.IsOwnerOrReadOnly finds the
owner unaided - UserContentViewSet below carries that case.

A RecipeTag has no user column at all. Tagging is part of authoring a recipe,
so its owner is the recipe's author, which is exactly what
recipes.views.RecipeChildViewSet already solves. RecipeTagViewSet subclasses
that rather than reimplementing it.

Visibility is queryset filtering in both cases, as
recipes.views.visible_recipes documents: every queryset here is scoped through
it so a rating attached to somebody's hidden draft never surfaces by a
different URL. The create path needs the same check by hand - `recipe` is a
writable field, so without it a caller could POST a rating naming a draft id
they are not allowed to see.
"""

from rest_framework import viewsets
from rest_framework.exceptions import ValidationError

from accounts.permissions import (
    IsAdmin,
    IsOwnerOrReadOnly,
    IsRegisteredUser,
    IsRegisteredUserOrReadOnly,
)
from recipes.views import RecipeChildViewSet, visible_recipes

from .models import Comment, Rating, RecipeTag, SavedRecipe, Tag
from .serializers import (
    CommentSerializer,
    RatingSerializer,
    RecipeTagSerializer,
    SavedRecipeSerializer,
    TagSerializer,
)


def require_visible_recipe(user, recipe):
    """Refuse a write naming a recipe this user cannot see.

    The create-time half of the visibility rule. Object-level permissions
    never run on a POST, and `recipe` accepts any primary key in the table, so
    without this a registered user could rate, review or save a draft that is
    invisible to them everywhere else.

    Reported as a 400 on the field rather than a 403, for the reason
    recipes.views gives for preferring a 404 over a 403: a permission error
    would confirm that the hidden recipe exists.

    A module-level function rather than a method because two viewsets need it
    and they do not share a base class - SavedRecipeViewSet scopes its
    queryset to the caller instead. Two copies of a rule like this drift, and
    the drift is a leak.
    """
    if visible_recipes(user).filter(pk=recipe.pk).exists():
        return

    raise ValidationError({
        'recipe': 'That recipe does not exist.',
    })


class UserContentViewSet(viewsets.ModelViewSet):
    """Shared behaviour for rows one user writes about a recipe.

    Readable by anyone who can see the recipe, writable only by the person who
    wrote the row - or an admin, who moderates. Scoped so a row belonging to
    somebody's hidden draft never appears.
    """

    permission_classes = [
        IsRegisteredUserOrReadOnly,
        IsOwnerOrReadOnly | IsAdmin,
    ]

    #: Set by subclasses. Every model here has both a `recipe` and a `user`
    #: FK, so only the model itself differs.
    model = None

    filterset_fields = ['recipe', 'user']

    def get_queryset(self):
        # select_related because the serializer nests the author on every row;
        # without it a page of 20 costs 20 extra queries.
        return self.model.objects.filter(
            recipe__in=visible_recipes(self.request.user),
        ).select_related('user', 'recipe')

    def perform_create(self, serializer):
        require_visible_recipe(
            self.request.user,
            serializer.validated_data['recipe'],
        )
        # `user` is read-only on the serializer: the credential decides who
        # wrote this, never the payload.
        serializer.save(user=self.request.user)

    def perform_update(self, serializer):
        # Catches a row being moved onto a recipe the caller cannot see; the
        # object-level check only vouched for where it came from.
        recipe = serializer.validated_data.get('recipe')
        if recipe is not None:
            require_visible_recipe(self.request.user, recipe)
        serializer.save()


class RatingViewSet(UserContentViewSet):
    """/api/social/ratings/ - 1-5 star scores.

    Filter to one recipe with ?recipe=<id>, or to one person with ?user=<id>.

    One rating per user per recipe: changing your mind is a PATCH of the row
    you already own, not a second POST. A duplicate comes back as a 400 saying
    so rather than a 500 from the database.
    """

    model = Rating
    serializer_class = RatingSerializer


class CommentViewSet(UserContentViewSet):
    """/api/social/comments/ - written reviews.

    Filter to one recipe with ?recipe=<id>, or to one person with ?user=<id>.
    Unlike ratings there is no limit per person and no rule against commenting
    on your own recipe.

    Deleting somebody else's comment is the admin moderation path, which
    IsAdmin in the inherited permissions already allows.
    """

    model = Comment
    serializer_class = CommentSerializer


class RecipeTagViewSet(RecipeChildViewSet):
    """/api/social/recipe-tags/ - which tags a recipe carries.

    Filter to one recipe with ?recipe=<id>. Write `tag_name` as plain text
    ("vegan"); the shared Tag row is found or created for you, the same way
    RecipeIngredientSerializer handles ingredient names.

    Subclasses RecipeChildViewSet, not UserContentViewSet: a tag has no author
    of its own, so the recipe's author is who may add or remove one.
    """

    model = RecipeTag
    serializer_class = RecipeTagSerializer

    def get_queryset(self):
        # The serializer nests the tag on read.
        return super().get_queryset().select_related('tag')


class TagViewSet(viewsets.ReadOnlyModelViewSet):
    """/api/social/tags/ - the shared tag lookup table.

    Read-only over the API for the same reason IngredientViewSet is: rows are
    created as a side effect of tagging a recipe, so a separate create route
    would only produce tags attached to nothing. Renaming a bad tag is an
    admin job.

    Open to guests, since a tag filter on the public recipe list reads it
    without being signed in.
    """

    queryset = Tag.objects.all()
    serializer_class = TagSerializer
    permission_classes = [IsRegisteredUserOrReadOnly]

    search_fields = ['name']
    ordering_fields = ['name']


class SavedRecipeViewSet(viewsets.ModelViewSet):
    """/api/social/saved/ - your personal recipe collection.

    IsRegisteredUser rather than one of the *OrReadOnly classes: a guest has
    no business listing anyone's collection, reads included.

    Not a UserContentViewSet subclass, because the queryset is narrower. The
    others are public reads scoped by recipe visibility; this one is scoped to
    the caller, so somebody else's saved_recipe_id is a 404 rather than a 403.
    That scoping, not a permission class, is what keeps one user out of
    another's collection.
    """

    serializer_class = SavedRecipeSerializer
    permission_classes = [IsRegisteredUser]

    filterset_fields = ['recipe']

    def get_queryset(self):
        return SavedRecipe.objects.filter(
            user=self.request.user,
            recipe__in=visible_recipes(self.request.user),
        ).select_related('recipe')

    def perform_create(self, serializer):
        # The same one rule UserContentViewSet uses - scoping the queryset to
        # the caller hides other people's rows, but says nothing about which
        # recipes this caller may write about.
        require_visible_recipe(
            self.request.user,
            serializer.validated_data['recipe'],
        )
        serializer.save(user=self.request.user)
