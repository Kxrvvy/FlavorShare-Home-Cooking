"""Django admin registration for the recipe core.

The fallback management surface while the custom Admin Dashboard is being
built, and the place to fix the things the API deliberately will not let
anyone fix - a mis-typed ingredient name, most of all, since IngredientViewSet
is read-only.

Steps and ingredient links are edited inline on their recipe rather than being
registered in their own right: neither means anything away from the recipe it
belongs to, and a flat list of every "Simmer for 20 minutes" in the database
helps nobody. Images are registered both ways, because moderating a bad photo
starts from the photo, not from the recipe it happens to sit in.
"""

from django.contrib import admin

from .models import Image, Ingredient, Recipe, RecipeIngredient, Step


class StepInline(admin.TabularInline):
    """The instructions, in order, on the recipe page."""

    model = Step
    extra = 1
    fields = ('step_number', 'instruction')
    ordering = ('step_number',)


class RecipeIngredientInline(admin.TabularInline):
    """What the recipe calls for."""

    model = RecipeIngredient
    extra = 1
    fields = ('ingredient', 'quantity', 'unit', 'notes')

    # The lookup table grows with every recipe, so a plain dropdown would
    # eventually load thousands of options on every recipe page.
    autocomplete_fields = ('ingredient',)


class ImageInline(admin.TabularInline):
    """Photos attached to this recipe."""

    model = Image
    extra = 1
    fields = ('type', 'step', 'url', 'uploaded_by')
    autocomplete_fields = ('uploaded_by',)

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        """Offer only this recipe's own steps in the `step` dropdown.

        Left alone, the dropdown lists every step in the database and invites
        exactly the cross-recipe mistake Image.clean() rejects. Narrowing the
        choices means the mistake is hard to make, not merely caught - this is
        UX, and the model keeps the rule.
        """
        if db_field.name == 'step':
            recipe_id = None
            match = getattr(request, 'resolver_match', None)
            if match is not None:
                recipe_id = match.kwargs.get('object_id')

            # No parent yet means the recipe is being added, so it has no
            # steps to choose from.
            kwargs['queryset'] = (
                Step.objects.filter(recipe_id=recipe_id)
                if recipe_id
                else Step.objects.none()
            )

        return super().formfield_for_foreignkey(db_field, request, **kwargs)


@admin.register(Recipe)
class RecipeAdmin(admin.ModelAdmin):
    """Admin for recipes.Recipe, with its content edited inline."""

    list_display = (
        'title',
        'user',
        'cuisine_type',
        'status',
        'difficulty',
        'view_count',
        'created_at',
    )
    list_filter = ('status', 'difficulty', 'cuisine_type')
    search_fields = ('title', 'description', 'user__username')
    ordering = ('-created_at',)
    autocomplete_fields = ('user',)

    # The changelist shows the author on every row; without this that is one
    # extra query per recipe.
    list_select_related = ('user',)

    # created_at and updated_at are auto_now_add/auto_now. view_count is
    # maintained by RecipeViewSet.retrieve, and hand-editing it would quietly
    # falsify the dashboard's "most viewed" report.
    readonly_fields = ('created_at', 'updated_at', 'view_count')

    inlines = (RecipeIngredientInline, StepInline, ImageInline)

    fieldsets = (
        (None, {'fields': ('title', 'user', 'description')}),
        (
            'Details',
            {
                'fields': (
                    'cuisine_type',
                    'prep_time',
                    'cook_time',
                    'servings',
                    'difficulty',
                ),
                'description': 'Times are in minutes.',
            },
        ),
        (
            'Publishing',
            {
                'fields': ('status', 'view_count'),
                # Saying so here because this form is the one way to publish
                # that skips RecipeWriteSerializer's gate.
                'description': (
                    'Publishing through the API requires the recipe to have '
                    'ingredients and steps. This form does not enforce that, '
                    'so check the tabs below before switching to Published.'
                ),
            },
        ),
        ('Dates', {'fields': ('created_at', 'updated_at')}),
    )


@admin.register(Ingredient)
class IngredientAdmin(admin.ModelAdmin):
    """Admin for the shared ingredient lookup table.

    The one place a name can be corrected: IngredientViewSet is read-only, so
    a typo that reached the table stays there until someone fixes it here.
    Renaming a row changes it for every recipe using it, which is the point of
    a shared table - and the reason to be careful.
    """

    list_display = ('name', 'category', 'recipe_count')
    list_filter = ('category',)
    search_fields = ('name',)
    ordering = ('name',)

    @admin.display(description='Used by', ordering='name')
    def recipe_count(self, ingredient):
        """How many recipes call for this ingredient."""
        return ingredient.recipe_links.count()


@admin.register(Image)
class ImageAdmin(admin.ModelAdmin):
    """Admin for recipes.Image, for moderating photos directly.

    Registered separately from the recipe inline because taking down an
    inappropriate image starts from the image itself, and the moderator will
    not know which recipe it belongs to.

    No custom form: ModelForm runs full_clean() on the instance, so
    Image.clean() already refuses the rows the API refuses.
    """

    list_display = ('__str__', 'type', 'recipe', 'step', 'uploaded_by')
    list_filter = ('type',)
    search_fields = ('recipe__title', 'uploaded_by__username', 'url')
    ordering = ('-image_id',)
    autocomplete_fields = ('recipe', 'uploaded_by')
    list_select_related = ('recipe', 'step', 'uploaded_by')
