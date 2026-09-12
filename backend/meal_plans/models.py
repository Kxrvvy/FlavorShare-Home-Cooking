"""Meal plan models: MealPlan, MealPlanEntry, NutritionInfo.

Mirrors the matching tables in flavorshare.sql, with the deviations noted at
each field, the same way recipes/models.py and social/models.py do.

Plans are built the same draft-first way recipes are: the MealPlan row exists
before the schedule is filled in, so `start_date` and `end_date` stay optional
at the database level and the rules that need them guard for their absence.
What is *not* optional is a MealPlanEntry's `day` and `meal_type` - see the
note on the uniqueness constraint for why.

NutritionInfo lives in this app rather than in recipes because CLAUDE.md
assigns it here, alongside the meal planning it feeds. Nothing writes it yet:
the nutrition provider is still unchosen, so the table ships empty and its
API is read-only.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from recipes.models import Recipe


class MealPlan(models.Model):
    """SQL: MealPlan - a named schedule over a date range."""

    # meal_plan_id INT AUTO_INCREMENT PRIMARY KEY
    meal_plan_id = models.AutoField(primary_key=True)

    # user_id INT NOT NULL, FK -> Users
    #
    # PROTECT, not the SQL's CASCADE, for the reason recipes.Recipe.user gives:
    # removing a user is a deactivation in this project so their content
    # survives, and PROTECT makes the database refuse a hard delete through
    # /admin/ rather than relying on everyone remembering.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='meal_plans',
    )

    # name VARCHAR(100) NOT NULL
    name = models.CharField(max_length=100)

    # start_date DATE / end_date DATE
    # Both nullable, as in the SQL, and for the same draft-first reason a
    # recipe's fields are: a plan named "Next week" should be saveable before
    # its dates are pinned down.
    start_date = models.DateField(blank=True, null=True)
    end_date = models.DateField(blank=True, null=True)

    class Meta:
        db_table = 'MealPlan'

        # Newest plan first. meal_plan_id breaks the tie: start_date is not
        # unique - and may be null - so ordering on it alone lets pagination
        # repeat or skip a row between pages.
        ordering = ['-start_date', '-meal_plan_id']

        constraints = [
            # A plan that ends before it starts is a data bug. The isnull arms
            # are explicit rather than relying on MySQL treating a NULL CHECK
            # as satisfied, so the rule reads the same as it behaves.
            models.CheckConstraint(
                condition=models.Q(end_date__gte=models.F('start_date'))
                | models.Q(start_date__isnull=True)
                | models.Q(end_date__isnull=True),
                name='meal_plan_ends_after_it_starts',
            ),
        ]

    def __str__(self):
        return self.name

    def clean(self):
        """The date-order rule, where a person can read it.

        The CheckConstraint above is the backstop for code that bypasses
        validation - the shell, fixtures, a data migration. This is what turns
        the same mistake into a 400 naming the field instead of an
        IntegrityError that DRF reports as a 500.
        """
        if self.start_date is None or self.end_date is None:
            return

        if self.end_date < self.start_date:
            raise ValidationError({
                'end_date': 'A plan cannot end before it starts.',
            })

    def covers(self, day):
        """Whether `day` falls inside this plan's range.

        True when the range is open-ended: a plan with no dates yet does not
        constrain anything, which is what makes a half-built plan saveable.
        """
        if self.start_date is not None and day < self.start_date:
            return False
        if self.end_date is not None and day > self.end_date:
            return False
        return True


class MealPlanEntry(models.Model):
    """SQL: MealPlanEntry - one recipe in one slot of a plan."""

    class MealType(models.TextChoices):
        BREAKFAST = 'breakfast', 'Breakfast'
        LUNCH = 'lunch', 'Lunch'
        DINNER = 'dinner', 'Dinner'
        SNACK = 'snack', 'Snack'

    # meal_plan_entry_id INT AUTO_INCREMENT PRIMARY KEY
    meal_plan_entry_id = models.AutoField(primary_key=True)

    # meal_plan_id INT NOT NULL, FK -> MealPlan ON DELETE CASCADE
    meal_plan = models.ForeignKey(
        MealPlan,
        on_delete=models.CASCADE,
        related_name='entries',
    )

    # recipe_id INT NOT NULL, FK -> Recipe ON DELETE CASCADE
    #
    # CASCADE as the SQL has it, matching social.SavedRecipe.recipe: an entry
    # pointing at a deleted recipe describes nothing. PROTECT would be worse
    # than useless here - it would let a stranger's meal plan stop an author
    # from deleting their own recipe.
    recipe = models.ForeignKey(
        Recipe,
        on_delete=models.CASCADE,
        related_name='meal_plan_entries',
    )

    # day VARCHAR(20)  ->  DateField, and NOT NULL
    #
    # A deviation from flavorshare.sql on both counts. VARCHAR would store
    # "Monday", which cannot say *which* Monday - and MealPlan already carries
    # start_date and end_date, so a concrete date is both available and the
    # only thing that can be checked against that range. It also makes
    # "generate a week" arithmetic instead of string handling.
    #
    # NOT NULL although the SQL allows null: see the uniqueness constraint
    # below, which cannot do its job if this column is nullable.
    day = models.DateField()

    # meal_type ENUM("breakfast", "lunch", "dinner", "snack")
    #
    # NOT NULL although the SQL allows null, for the same reason as `day`.
    # max_length 9 is "breakfast", the longest of the four.
    meal_type = models.CharField(max_length=9, choices=MealType.choices)

    class Meta:
        db_table = 'MealPlanEntry'

        # Chronological by date. meal_plan_entry_id breaks the tie rather than
        # meal_type, which would sort alphabetically - breakfast, dinner,
        # lunch, snack - and read as wrong. Ordering the four meals properly is
        # a display concern and belongs with the frontend work.
        ordering = ['day', 'meal_plan_entry_id']

        constraints = [
            # The same recipe twice in one slot is a bug. Two *different*
            # dishes at dinner is not, which is why `recipe` is part of the
            # key rather than the slot alone.
            #
            # This is what forces `day` and `meal_type` to be NOT NULL above:
            # MySQL treats NULLs as distinct inside a unique index, so a
            # nullable column here would wave duplicates straight through.
            models.UniqueConstraint(
                fields=['meal_plan', 'day', 'meal_type', 'recipe'],
                name='unique_recipe_per_meal_slot',
            ),
        ]

    def __str__(self):
        return f'{self.get_meal_type_display()} on {self.day}: {self.recipe.title}'

    def clean(self):
        """An entry's day must fall inside its plan's range.

        A cross-table comparison no column constraint can express, so it lives
        here rather than in a serializer - the pattern
        recipes.models.Image.clean() sets, and for the same payoff: DRF calls
        it from the serializer and Django's ModelForm calls it through
        full_clean(), so the API and the admin refuse the same rows with no
        admin-specific validation code.

        Guarded on both sides because clean() also runs on a part-filled admin
        form, and because a plan with no dates yet deliberately constrains
        nothing.
        """
        if self.meal_plan_id is None or self.day is None:
            return

        if not self.meal_plan.covers(self.day):
            raise ValidationError({
                'day': (
                    f'{self.day} is outside this plan, which runs '
                    f'{self.meal_plan.start_date} to '
                    f'{self.meal_plan.end_date}.'
                ),
            })


class NutritionInfo(models.Model):
    """SQL: NutritionInfo - macros for one recipe, from an external API.

    Nothing populates this yet. The provider is still undecided, so the model
    and its read-only endpoint exist to be filled in once that choice is made
    rather than to be used now.
    """

    # nutrition_info_id INT AUTO_INCREMENT PRIMARY KEY
    nutrition_info_id = models.AutoField(primary_key=True)

    # recipe_id INT NOT NULL, FK -> Recipe ON DELETE CASCADE
    #
    # OneToOneField rather than a plain ForeignKey. It *is* a ForeignKey with
    # unique=True - same recipe_id column, same cascade - so the only thing it
    # changes is that the relationship cannot become plural and that the
    # reverse side reads `recipe.nutrition_info` directly instead of handing
    # back a manager to call .first() on.
    #
    # The uniqueness itself is an addition: flavorshare.sql puts no unique
    # index on recipe_id, which would allow a second, contradictory set of
    # macros for the same recipe.
    #
    # Note for callers: the reverse accessor raises RelatedObjectDoesNotExist
    # when there is no row, so guard it with hasattr() rather than expecting
    # None.
    recipe = models.OneToOneField(
        Recipe,
        on_delete=models.CASCADE,
        related_name='nutrition_info',
    )

    # calories / protein / carbs / fat DECIMAL(6,2)
    # Nullable: a provider may answer with some macros and not others, and a
    # partial record beats discarding the response.
    calories = models.DecimalField(
        max_digits=6, decimal_places=2, blank=True, null=True,
    )
    protein = models.DecimalField(
        max_digits=6, decimal_places=2, blank=True, null=True,
    )
    carbs = models.DecimalField(
        max_digits=6, decimal_places=2, blank=True, null=True,
    )
    fat = models.DecimalField(
        max_digits=6, decimal_places=2, blank=True, null=True,
    )

    # fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    #
    # auto_now, not auto_now_add: this records when the figures were last
    # pulled from the provider, so a refetch has to move it. That is also what
    # a future cache-expiry check would read.
    fetched_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'NutritionInfo'
        ordering = ['-fetched_at']

    def __str__(self):
        return f'Nutrition for {self.recipe.title}'
