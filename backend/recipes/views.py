"""Views for the recipes app: recipe CRUD, steps, ingredients and images.

Two rules shape everything here.

Visibility is queryset filtering, not permission classes. accounts.permissions
says so directly: "guests see published recipes but never drafts" is a
question of which rows exist for this caller, so it lives in get_queryset().
A permission class answering it would turn a draft into a 403, which tells a
stranger the recipe is there; filtering makes it a plain 404.

Ownership on create cannot come from a permission class. DRF only runs
object-level checks on objects fetched through get_object(), and a POST has
no object yet - so nothing would stop a signed-in user adding a step to
someone else's recipe. RecipeChildViewSet.perform_create closes that.
"""

from django.db import transaction
from django.db.models import Case, F, IntegerField, Max, Q, When
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from accounts.permissions import (
    IsAdmin,
    IsOwnerOrReadOnly,
    IsRegisteredUserOrReadOnly,
)

from .models import Image, Ingredient, Recipe, RecipeIngredient, Step
from .permissions import IsRecipeOwnerOrReadOnly
from .serializers import (
    ImageSerializer,
    IngredientSerializer,
    RecipeDetailSerializer,
    RecipeIngredientSerializer,
    RecipeListSerializer,
    RecipeWriteSerializer,
    StepSerializer,
)


def visible_recipes(user):
    """The recipes this caller is allowed to see at all.

    Published recipes are public. A draft is visible only to its author, and
    to admins, who need every row to moderate. Defined once here because the
    child viewsets have to scope their rows the same way - a step of a hidden
    draft must not be readable just because it is reachable by a different
    URL.
    """
    recipes = Recipe.objects.all()

    if not user.is_authenticated:
        return recipes.filter(status=Recipe.Status.PUBLISHED)

    if user.is_admin:
        return recipes

    return recipes.filter(Q(status=Recipe.Status.PUBLISHED) | Q(user=user))


class RecipeViewSet(viewsets.ModelViewSet):
    """/api/recipes/ - browse, publish and manage recipes.

        GET    /                      list (published, plus your own drafts)
        POST   /                      create a draft
        GET    /<id>/                 one recipe, with steps and ingredients
        PATCH  /<id>/                 edit your own
        DELETE /<id>/                 delete your own
        POST   /<id>/publish/         draft -> published, if it has content
        POST   /<id>/unpublish/       published -> draft
        POST   /<id>/steps/reorder/   renumber steps in one pass
    """

    # A Recipe carries its author in `user`, which is IsOwnerOrReadOnly's
    # default owner_field - so this one uses the accounts class as-is. The
    # hop through obj.recipe is for the child viewsets below.
    permission_classes = [
        IsRegisteredUserOrReadOnly,
        IsOwnerOrReadOnly | IsAdmin,
    ]

    def get_queryset(self):
        recipes = visible_recipes(self.request.user).select_related('user')

        if self.action == 'list':
            # cover_image reads recipe.images in Python, so without this the
            # list fans out into one query per row.
            return recipes.prefetch_related('images')

        return recipes.prefetch_related(
            'images',
            'steps__images',
            'recipe_ingredients__ingredient',
        )

    def get_serializer_class(self):
        if self.action == 'list':
            return RecipeListSerializer
        if self.action in ('retrieve', 'publish', 'unpublish'):
            return RecipeDetailSerializer
        return RecipeWriteSerializer

    def perform_create(self, serializer):
        # `user` is read-only on the serializer; the author is whoever is
        # holding the token, never whatever the payload claims.
        serializer.save(user=self.request.user)

    def retrieve(self, request, *args, **kwargs):
        recipe = self.get_object()

        # Don't let authors inflate their own numbers - the dashboard reports
        # "most viewed", and a writer refreshing their draft is not a view.
        viewer = request.user
        if not (viewer.is_authenticated and viewer == recipe.user):
            # F() rather than read-modify-write: two simultaneous views would
            # otherwise both read 5 and both store 6, losing one.
            Recipe.objects.filter(pk=recipe.pk).update(
                view_count=F('view_count') + 1,
            )
            # Reflect it in this response without a second SELECT.
            recipe.view_count += 1

        return Response(self.get_serializer(recipe).data)

    def _set_status(self, recipe, status):
        """Run a status change through the serializer's publish gate."""
        serializer = RecipeWriteSerializer(
            recipe,
            data={'status': status},
            partial=True,
            context=self.get_serializer_context(),
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(
            RecipeDetailSerializer(
                recipe, context=self.get_serializer_context()
            ).data
        )

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        """Publish a draft, if it has ingredients and steps.

        A dedicated route rather than PATCH {"status": "published"}, which
        also works: publishing is a deliberate act and reads better as one in
        the frontend. Both paths run the same gate.
        """
        return self._set_status(self.get_object(), Recipe.Status.PUBLISHED)

    @action(detail=True, methods=['post'])
    def unpublish(self, request, pk=None):
        """Pull a recipe back to draft.

        Also the soft moderation action: an admin can take an inappropriate
        recipe out of public view without destroying the author's work.
        """
        return self._set_status(self.get_object(), Recipe.Status.DRAFT)

    @action(detail=True, methods=['post'], url_path='steps/reorder')
    def reorder_steps(self, request, pk=None):
        """Renumber a recipe's steps from a full ordering of their ids.

        Expects {"step_ids": [12, 9, 15]} - every step in the recipe, exactly
        once, in the order they should end up. Answers with the recipe.

        Partial orderings are refused on purpose: accepting a subset would
        leave the rest holding numbers that collide or leave gaps, and there
        is no obvious right answer for where they should land.
        """
        recipe = self.get_object()
        step_ids = request.data.get('step_ids')

        if not isinstance(step_ids, list) or not step_ids:
            raise ValidationError({
                'step_ids': 'Provide the step ids in their new order.',
            })

        try:
            step_ids = [int(step_id) for step_id in step_ids]
        except (TypeError, ValueError):
            raise ValidationError({'step_ids': 'Step ids must be numbers.'})

        existing = list(recipe.steps.values_list('step_id', flat=True))
        if sorted(step_ids) != sorted(existing):
            raise ValidationError({
                'step_ids': (
                    'List every step in this recipe exactly once.'
                ),
            })

        with transaction.atomic():
            # Move every step out of the way first. models.py warns that
            # MySQL checks (recipe, step_number) per statement, so writing
            # the final numbers straight away collides the moment two steps
            # trade places. Offsetting past the current maximum guarantees
            # the second statement lands on free numbers.
            offset = len(existing)
            Step.objects.filter(recipe=recipe).update(
                step_number=F('step_number') + offset,
            )

            # One statement for the final numbers, for the same reason.
            Step.objects.filter(recipe=recipe).update(
                step_number=Case(
                    *[
                        When(pk=step_id, then=position)
                        for position, step_id in enumerate(step_ids, start=1)
                    ],
                    output_field=IntegerField(),
                ),
            )

        recipe.refresh_from_db()
        return Response(
            RecipeDetailSerializer(
                recipe, context=self.get_serializer_context()
            ).data
        )


class RecipeChildViewSet(viewsets.ModelViewSet):
    """Shared behaviour for rows that belong to a recipe.

    Steps, ingredient links and images are all the same shape: readable when
    their recipe is, writable only by that recipe's author or an admin, and
    scoped so a row of somebody's hidden draft never surfaces.
    """

    permission_classes = [
        IsRegisteredUserOrReadOnly,
        IsRecipeOwnerOrReadOnly | IsAdmin,
    ]

    #: Set by subclasses - the model's related_name back to Recipe is always
    #: 'recipe', so only the queryset differs.
    model = None

    filterset_fields = ['recipe']

    def get_queryset(self):
        return self.model.objects.filter(
            recipe__in=visible_recipes(self.request.user),
        ).order_by('pk')

    def _require_ownership(self, recipe):
        """Refuse writes into a recipe the caller does not own.

        This is the create-time half of IsRecipeOwnerOrReadOnly. Without it a
        registered user can POST a step naming any recipe_id at all, because
        object-level permissions never run on create.
        """
        user = self.request.user

        if user.is_admin or recipe.user == user:
            return

        raise PermissionDenied('You may only add to your own recipes.')

    def perform_create(self, serializer):
        self._require_ownership(serializer.validated_data['recipe'])
        serializer.save()

    def perform_update(self, serializer):
        # Catches a row being moved into a recipe belonging to someone else;
        # the object-level check only vouched for where it came from.
        recipe = serializer.validated_data.get('recipe')
        if recipe is not None:
            self._require_ownership(recipe)
        serializer.save()


class StepViewSet(RecipeChildViewSet):
    """/api/recipes/steps/ - the instructions of a recipe.

    Filter to one recipe with ?recipe=<id>. step_number may be omitted on
    create; the serializer appends the step at the end. To change the order
    afterwards, use /api/recipes/<id>/steps/reorder/ rather than patching
    numbers one at a time, which collides.
    """

    model = Step
    serializer_class = StepSerializer

    def get_queryset(self):
        return super().get_queryset().prefetch_related('images')


class RecipeIngredientViewSet(RecipeChildViewSet):
    """/api/recipes/recipe-ingredients/ - what a recipe calls for.

    Write `ingredient_name` as plain text ("salt"); the shared Ingredient row
    is found or created for you.
    """

    model = RecipeIngredient
    serializer_class = RecipeIngredientSerializer

    def get_queryset(self):
        return super().get_queryset().select_related('ingredient')


class ImageViewSet(RecipeChildViewSet):
    """/api/recipes/images/ - recipe and step photos.

    Takes a `url` that is already hosted. Uploading the file itself, and
    getting that URL back from Cloudinary, is the next piece of work.
    """

    model = Image
    serializer_class = ImageSerializer

    def get_queryset(self):
        return super().get_queryset().select_related('uploaded_by')

    def perform_create(self, serializer):
        self._require_ownership(serializer.validated_data['recipe'])
        # uploaded_by is read-only on the serializer for the same reason
        # Recipe.user is: the credential decides, not the payload.
        serializer.save(uploaded_by=self.request.user)


class IngredientViewSet(viewsets.ReadOnlyModelViewSet):
    """/api/recipes/ingredients/ - the shared ingredient lookup table.

    Read-only over the API: rows are created as a side effect of adding an
    ingredient to a recipe, so a separate create route would only produce
    orphans. Fixing a mis-typed name is an admin job and belongs in the
    Django admin.

    Open to guests, since the recipe builder's autocomplete and Person 3's
    ingredient search both read it without being signed in.
    """

    queryset = Ingredient.objects.all()
    serializer_class = IngredientSerializer
    permission_classes = [IsRegisteredUserOrReadOnly]

    filterset_fields = ['category']
    search_fields = ['name']
    ordering_fields = ['name', 'category']
