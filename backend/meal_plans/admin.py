"""Django admin registration for the meal_plans app.

Deliberately thin, like social/admin.py: enough to read the tables and hand-
enter a row while the frontend and the nutrition provider are still ahead of
us. Reporting and moderation views belong to the depth pass.

Entries are edited inline on their plan rather than registered in their own
right - the choice recipes/admin.py makes for steps and ingredient links, and
for the same reason. A MealPlanEntry means nothing away from the plan it
belongs to, and a flat list of every "dinner on the 15th" in the database helps
nobody. Ratings and comments are registered standalone in social because a
moderator arrives knowing the review, not the recipe; nobody ever arrives
knowing only the meal slot.

No custom forms: ModelForm runs full_clean(), so MealPlan.clean() and
MealPlanEntry.clean() already refuse the rows the API refuses - a plan ending
before it starts, and an entry dated outside its plan.
"""

from django.contrib import admin

from .models import MealPlan, MealPlanEntry, NutritionInfo


class MealPlanEntryInline(admin.TabularInline):
    """The schedule, in date order, on the plan page.

    One caveat, the same one RecipeAdminForm documents for the publish gate:
    MealPlanEntry.clean() reads the plan as it exists in the database, so
    moving a plan's dates and adding an out-of-range entry in the *same*
    submission is checked against the old range. Save the dates first, then add
    the entry.
    """

    model = MealPlanEntry
    extra = 1
    fields = ('day', 'meal_type', 'recipe')
    ordering = ('day',)

    # Every recipe in the database would otherwise load as a dropdown option on
    # every plan page - the reason RecipeIngredientInline autocompletes too.
    autocomplete_fields = ('recipe',)


@admin.register(MealPlan)
class MealPlanAdmin(admin.ModelAdmin):
    """Admin for meal_plans.MealPlan, with its schedule edited inline."""

    list_display = ('name', 'user', 'start_date', 'end_date', 'entry_count')
    search_fields = ('name', 'user__username')
    ordering = ('-start_date', '-meal_plan_id')
    autocomplete_fields = ('user',)

    # The changelist shows the owner on every row; without this that is one
    # extra query per plan.
    list_select_related = ('user',)

    inlines = (MealPlanEntryInline,)

    @admin.display(description='Slots filled')
    def entry_count(self, meal_plan):
        """How many slots this plan has scheduled."""
        return meal_plan.entries.count()


@admin.register(NutritionInfo)
class NutritionInfoAdmin(admin.ModelAdmin):
    """Admin for meal_plans.NutritionInfo.

    The only way to put a row in this table today: the API is read-only and no
    provider has been chosen, so hand-entering one here is how the nutrition
    display gets something to render against.

    Editable on purpose for that reason. Once a provider is fetching these,
    hand-editing them would falsify what the recipe actually contains - worth
    revisiting then.
    """

    list_display = (
        'recipe',
        'calories',
        'protein',
        'carbs',
        'fat',
        'fetched_at',
    )
    search_fields = ('recipe__title',)
    ordering = ('-fetched_at',)
    autocomplete_fields = ('recipe',)
    list_select_related = ('recipe',)

    # auto_now - it records when the figures were last pulled, so it is not a
    # field anyone should be typing into.
    readonly_fields = ('fetched_at',)
