"""Recipe core models: Recipe, Ingredient, RecipeIngredient, Step, Image.

Mirrors the matching tables in flavorshare.sql, with the deviations noted at
each field. Field types, lengths and defaults come from that file; where this
differs, the comment says why.

These models are shaped for the draft-first recipe builder: the Recipe row is
created as a draft the moment the user starts the form, and ingredients,
steps and images are added one at a time afterwards. Everything except
`title` is therefore optional at the database level. "A recipe must have
ingredients and steps before it can be published" is a publish-time rule and
belongs in the serializer, not in a NOT NULL constraint - encoding it here
would make a half-built draft impossible to save.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


class Ingredient(models.Model):
    """SQL: Ingredient

    A shared lookup table. Two recipes that both use salt point at this one
    row through RecipeIngredient; the table does not hold one entry per
    recipe.
    """

    # ingredient_id INT AUTO_INCREMENT PRIMARY KEY
    ingredient_id = models.AutoField(primary_key=True)

    # name VARCHAR(100) NOT NULL
    # unique is an addition: without it "Salt", "salt" and "salt " become
    # three rows and searching recipes by ingredient starts missing matches.
    name = models.CharField(max_length=100, unique=True)

    # category VARCHAR(50)
    category = models.CharField(max_length=50, blank=True, null=True)

    class Meta:
        db_table = 'Ingredient'
        ordering = ['name']

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        """Normalise before saving so the unique constraint can do its job.

        Done here rather than in a serializer so it holds for every entry
        point - API, Django admin, shell, fixtures. Capitalising for display
        is the frontend's business.
        """
        self.name = self.name.strip().lower()
        if self.category:
            self.category = self.category.strip().lower()
        super().save(*args, **kwargs)


class Recipe(models.Model):
    """SQL: Recipe"""

    class Difficulty(models.TextChoices):
        EASY = 'easy', 'Easy'
        MEDIUM = 'medium', 'Medium'
        HARD = 'hard', 'Hard'

    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        PUBLISHED = 'published', 'Published'

    # recipe_id INT AUTO_INCREMENT PRIMARY KEY
    recipe_id = models.AutoField(primary_key=True)

    # user_id INT NOT NULL, FK -> Users
    #
    # PROTECT, not the SQL's CASCADE. Removing a user is a deactivation in
    # this project precisely so their content survives; CASCADE would let one
    # hard delete through /admin/ erase every recipe they ever wrote. This
    # makes the database refuse rather than rely on everyone remembering.
    #
    # Named `user` so Django derives the `user_id` column the ERD specifies,
    # and so accounts.permissions.IsOwnerOrReadOnly finds the owner with no
    # per-view configuration.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='recipes',
    )

    # title VARCHAR(150) NOT NULL
    title = models.CharField(max_length=150)

    # description TEXT
    description = models.TextField(blank=True, null=True)

    # cuisine_type VARCHAR(50)
    cuisine_type = models.CharField(max_length=50, blank=True, null=True)

    # prep_time INT / cook_time INT / servings INT - all in minutes except
    # servings. PositiveIntegerField rather than a plain int: a negative cook
    # time is never valid, and the unsigned column documents that.
    prep_time = models.PositiveIntegerField(blank=True, null=True)
    cook_time = models.PositiveIntegerField(blank=True, null=True)
    servings = models.PositiveIntegerField(blank=True, null=True)

    # difficulty ENUM("easy", "medium", "hard")
    difficulty = models.CharField(
        max_length=6,
        choices=Difficulty.choices,
        blank=True,
        null=True,
    )

    # status ENUM("draft", "published") DEFAULT "draft"
    status = models.CharField(
        max_length=9,
        choices=Status.choices,
        default=Status.DRAFT,
    )

    # view_count INT DEFAULT 0
    view_count = models.PositiveIntegerField(default=0)

    # created_at / updated_at TIMESTAMP
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'Recipe'
        ordering = ['-created_at']
        indexes = [
            # Nearly every public query filters to published recipes.
            models.Index(fields=['status'], name='recipe_status_idx'),
        ]

    def __str__(self):
        return self.title

    def publication_error(self):
        """Why this recipe may not be published yet, or None if it may.

        The publish rule kept out of the database on purpose - a draft has to
        be saveable while it is still half built, so "needs ingredients and
        steps" cannot be a NOT NULL constraint. It lives here rather than in
        RecipeWriteSerializer because the Django admin does not go through
        DRF, and a rule written in only one of those two places is a rule the
        other one quietly ignores.

        Returns the message rather than a bool because both callers show it
        to somebody; can_be_published() is the predicate built on top.

        Answers only "does this recipe have what it needs". Whether a given
        status change is even a transition - re-saving something already
        published is a no-op, not a failure - belongs to the caller making
        the change.
        """
        # Reverse managers raise ValueError on an unsaved row, so this guard
        # has to come first. Both entry points reach it: POST of a brand new
        # recipe, and the admin's add page.
        if self.pk is None:
            return (
                'A new recipe is saved as a draft. Add its ingredients '
                'and steps first, then publish it.'
            )

        missing = []
        if not self.recipe_ingredients.exists():
            missing.append('ingredients')
        if not self.steps.exists():
            missing.append('steps')

        if not missing:
            return None

        return (
            f'A recipe needs {" and ".join(missing)} before it can '
            f'be published.'
        )

    def can_be_published(self):
        """Whether publishing this recipe would be accepted."""
        return self.publication_error() is None


class Step(models.Model):
    """SQL: Step"""

    # step_id INT AUTO_INCREMENT PRIMARY KEY
    step_id = models.AutoField(primary_key=True)

    # recipe_id INT NOT NULL, FK -> Recipe ON DELETE CASCADE
    recipe = models.ForeignKey(
        Recipe,
        on_delete=models.CASCADE,
        related_name='steps',
    )

    # step_number INT NOT NULL
    step_number = models.PositiveIntegerField()

    # instruction TEXT NOT NULL
    instruction = models.TextField()

    class Meta:
        db_table = 'Step'
        ordering = ['step_number']
        constraints = [
            # Two steps numbered 3 in one recipe is a data bug, not a
            # preference. Note for the reorder endpoint: MySQL checks this
            # per statement, so swapping two steps needs a single UPDATE that
            # offsets every row before final numbers are written.
            models.UniqueConstraint(
                fields=['recipe', 'step_number'],
                name='unique_step_number_per_recipe',
            ),
        ]

    def __str__(self):
        return f'{self.recipe.title} - step {self.step_number}'


class Image(models.Model):
    """SQL: Image, plus a `step` FK the original schema lacks.

    Recipe-level images (the cover shot, ingredient photos) leave `step`
    null. A photo attached to one instruction sets it. Without this column
    `type='step'` records only that an image *is* a step photo, with no way
    to say which step it belongs to.
    """

    class Type(models.TextChoices):
        INGREDIENT = 'ingredient', 'Ingredient'
        STEP = 'step', 'Step'
        FINAL = 'final', 'Final'

    # image_id INT AUTO_INCREMENT PRIMARY KEY
    image_id = models.AutoField(primary_key=True)

    # recipe_id INT NOT NULL, FK -> Recipe ON DELETE CASCADE
    recipe = models.ForeignKey(
        Recipe,
        on_delete=models.CASCADE,
        related_name='images',
    )

    # step_id INT NULL, FK -> Step ON DELETE CASCADE  [not in flavorshare.sql]
    #
    # Nullable because most images belong to the recipe as a whole. Deleting
    # a step takes its photo with it.
    #
    # No column constraint stops this pointing at a step from a *different*
    # recipe - the check is cross-table. clean() below is where it lives, so
    # the API and the Django admin both get it from one place.
    step = models.ForeignKey(
        Step,
        on_delete=models.CASCADE,
        related_name='images',
        blank=True,
        null=True,
    )

    # uploaded_by INT NOT NULL, FK -> Users
    # db_column keeps the ERD's name; Django would otherwise write
    # `uploaded_by_id`. PROTECT for the same reason as Recipe.user.
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='uploaded_images',
        db_column='uploaded_by',
    )

    # url VARCHAR(255) NOT NULL
    # A plain URLField, not a Cloudinary field type: only the URL is stored
    # in MySQL, so the storage provider stays a swappable decision.
    url = models.URLField(max_length=255)

    # type ENUM("ingredient", "step", "final") NOT NULL
    type = models.CharField(max_length=10, choices=Type.choices)

    class Meta:
        db_table = 'Image'

    def __str__(self):
        return f'{self.get_type_display()} image for {self.recipe.title}'

    def clean(self):
        """The two rules the database cannot express, in one place.

        Lives on the model rather than in a serializer because there are two
        ways into this table. DRF calls it from ImageSerializer.validate();
        Django's ModelForm calls it through full_clean(), which is what makes
        the admin - including the inline on the recipe page - refuse the same
        rows the API refuses, with no admin-specific validation code.

        Errors are keyed on `step` so both callers can attach them to that
        field: DRF via as_serializer_error(), the admin form automatically.

        Note this is not called on a plain .save(). Code creating images
        directly - fixtures, the shell, a data migration - bypasses it, the
        same as any other Django model validation.
        """
        errors = {}

        # Compared by id rather than by object so an unsaved instance built
        # from ids alone still gets checked. The mismatch is part of this
        # condition, not nested inside it, so a step that *does* match falls
        # through to the checks below instead of skipping them.
        if (
            self.step_id is not None
            and self.recipe_id is not None
            and self.step.recipe_id != self.recipe_id
        ):
            errors['step'] = 'That step belongs to a different recipe.'

        # Keep `type` and `step` telling the same story: step photos name
        # their step, cover and ingredient shots belong to the recipe as a
        # whole and leave it null.
        elif self.type == self.Type.STEP and self.step_id is None:
            errors['step'] = 'A step photo must say which step it belongs to.'

        elif self.step_id is not None and self.type in (
            self.Type.INGREDIENT,
            self.Type.FINAL,
        ):
            errors['step'] = (
                f'A {self.type} image belongs to the recipe as a whole, '
                f'not to one step.'
            )

        if errors:
            raise ValidationError(errors)


class RecipeIngredient(models.Model):
    """SQL: RecipeIngredient - joins Recipe to Ingredient with an amount."""

    # recipe_ingredient_id INT AUTO_INCREMENT PRIMARY KEY
    recipe_ingredient_id = models.AutoField(primary_key=True)

    # recipe_id INT NOT NULL, FK -> Recipe ON DELETE CASCADE
    recipe = models.ForeignKey(
        Recipe,
        on_delete=models.CASCADE,
        related_name='recipe_ingredients',
    )

    # ingredient_id INT NOT NULL, FK -> Ingredient
    # PROTECT, not CASCADE: deleting "salt" from the lookup table should not
    # silently strip it out of every recipe that calls for it.
    ingredient = models.ForeignKey(
        Ingredient,
        on_delete=models.PROTECT,
        related_name='recipe_links',
    )

    # quantity DECIMAL(6,2)
    quantity = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        blank=True,
        null=True,
    )

    # unit VARCHAR(30)
    unit = models.CharField(max_length=30, blank=True, null=True)

    # notes VARCHAR(50)  [not in flavorshare.sql - suggested in its comments]
    # Holds "a pinch", "to taste", "or more if you like heat" without forcing
    # quantity to be thrown away to record them.
    notes = models.CharField(max_length=50, blank=True, null=True)

    class Meta:
        db_table = 'RecipeIngredient'
        constraints = [
            # Flour listed twice in one recipe is a bug; a second amount
            # belongs in `notes` or in the existing row.
            models.UniqueConstraint(
                fields=['recipe', 'ingredient'],
                name='unique_ingredient_per_recipe',
            ),
        ]

    def __str__(self):
        # Trim the stored scale for display: 2.00 -> "2", 2.50 -> "2.5".
        # rstrip rather than Decimal.normalize(), which turns 100.00 into
        # the exponent form 1E+2.
        quantity = (
            f'{self.quantity:f}'.rstrip('0').rstrip('.')
            if self.quantity is not None
            else None
        )
        amount = ' '.join(part for part in (quantity, self.unit) if part)
        return f'{amount} {self.ingredient.name}'.strip()
