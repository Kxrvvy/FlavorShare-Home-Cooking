"""Social models: Rating, Comment, Tag, RecipeTag, SavedRecipe.

Mirrors the matching tables in flavorshare.sql, with the deviations noted at
each field, the same way recipes/models.py does.

Two conventions hold across every model here.

Every FK to a user is PROTECT, never CASCADE. Removing a user is a
deactivation in this project - accounts.views.AdminUserViewSet.perform_destroy
flips is_active rather than deleting the row, precisely so their content
survives - and PROTECT makes the database refuse a hard delete through
/admin/ instead of relying on everyone remembering. FKs to a Recipe stay
CASCADE: a rating on a deleted recipe has nothing left to describe.

Rules the database cannot express live in clean(), not in a serializer.
There are two ways into these tables - DRF and the Django admin's ModelForm -
and a rule written in only one of them is a rule the other quietly ignores.
recipes.models.Image.clean() sets the pattern this follows.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from recipes.models import Recipe

# Lowest and highest score the 1-5 star control can produce. Three places need
# the same pair: the field validators, the database constraint, and __str__.
# Module level rather than class attributes because a nested Meta cannot see
# the enclosing class's namespace - Rating aliases them below so callers can
# still read Rating.MAX_SCORE.
MIN_SCORE = 1
MAX_SCORE = 5


class Rating(models.Model):
    """SQL: Rating - one user's 1-5 score for one recipe."""

    MIN_SCORE = MIN_SCORE
    MAX_SCORE = MAX_SCORE

    # rating_id INT AUTO_INCREMENT PRIMARY KEY
    rating_id = models.AutoField(primary_key=True)

    # recipe_id INT NOT NULL, FK -> Recipe ON DELETE CASCADE
    recipe = models.ForeignKey(
        Recipe,
        on_delete=models.CASCADE,
        related_name='ratings',
    )

    # user_id INT NOT NULL, FK -> Users
    # PROTECT for the reason in the module docstring. Named `user` so Django
    # derives the `user_id` column the ERD specifies, and so
    # accounts.permissions.IsOwnerOrReadOnly finds the owner with no per-view
    # configuration.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='ratings',
    )

    # score TINYINT NOT NULL  (1-5)
    # PositiveSmallIntegerField: a score is never negative and never needs
    # four bytes. The validators are what DRF turns into a readable 400; the
    # CheckConstraint below is what stops the shell and fixtures writing a 9.
    score = models.PositiveSmallIntegerField(
        validators=[
            MinValueValidator(MIN_SCORE),
            MaxValueValidator(MAX_SCORE),
        ],
    )

    # created_at TIMESTAMP
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'Rating'
        ordering = ['-created_at']
        constraints = [
            # One score per person per recipe. Without this a user can rate
            # the same recipe repeatedly and drag its average wherever they
            # like, which makes "most rated" on the admin dashboard
            # meaningless. Changing your mind is a PATCH of this row.
            models.UniqueConstraint(
                fields=['recipe', 'user'],
                name='unique_rating_per_user_per_recipe',
            ),
            # The range again, at the database. The validators above only run
            # through full_clean(), so a plain .save() from the shell or a
            # data migration would otherwise store anything that fits in the
            # column.
            models.CheckConstraint(
                condition=models.Q(score__gte=MIN_SCORE)
                & models.Q(score__lte=MAX_SCORE),
                name='rating_score_within_range',
            ),
        ]

    def __str__(self):
        return f'{self.score}/{self.MAX_SCORE} for {self.recipe.title}'

    def clean(self):
        """Authors may not rate their own recipe.

        Same reasoning as recipes.views.RecipeViewSet.retrieve() skipping
        view_count for the author: the dashboard reports on these numbers, and
        a writer scoring their own work is not feedback.

        Compared by id rather than by object so an unsaved instance built from
        ids alone still gets checked, and guarded because clean() also runs on
        a part-filled admin form where either side may be missing.
        """
        if self.recipe_id is None or self.user_id is None:
            return

        if self.recipe.user_id == self.user_id:
            # Keyed on `score` rather than raised bare: DRF and the admin form
            # both attach it to that field, which is the only one the rater
            # actually touched.
            raise ValidationError({
                'score': 'You cannot rate your own recipe.',
            })


class Comment(models.Model):
    """SQL: Comment - a written review on a recipe.

    No self-comment rule, deliberately unlike Rating. An author answering a
    question on their own recipe is the feature working; an author scoring
    their own recipe is not.
    """

    # comment_id INT AUTO_INCREMENT PRIMARY KEY
    comment_id = models.AutoField(primary_key=True)

    # recipe_id INT NOT NULL, FK -> Recipe ON DELETE CASCADE
    recipe = models.ForeignKey(
        Recipe,
        on_delete=models.CASCADE,
        related_name='comments',
    )

    # user_id INT NOT NULL, FK -> Users
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='comments',
    )

    # content TEXT NOT NULL
    content = models.TextField()

    # created_at TIMESTAMP
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'Comment'
        # Newest first: a recipe page shows the most recent reviews, and an
        # unordered queryset can repeat or skip rows between pages.
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.user.username} on {self.recipe.title}'


class Tag(models.Model):
    """SQL: Tag - "vegan", "gluten-free", "Italian".

    A shared lookup table, like Ingredient: two recipes tagged vegan point at
    this one row through RecipeTag.
    """

    # tag_id INT AUTO_INCREMENT PRIMARY KEY
    tag_id = models.AutoField(primary_key=True)

    # name VARCHAR(50) NOT NULL
    # unique for the same reason Ingredient.name is: without it "Vegan",
    # "vegan" and "vegan " become three rows and filtering by tag starts
    # missing matches.
    name = models.CharField(max_length=50, unique=True)

    class Meta:
        db_table = 'Tag'
        ordering = ['name']

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        """Normalise before saving so the unique constraint can do its job.

        Copied from Ingredient.save() on purpose - the two lookup tables
        behave the same way. Done here rather than in a serializer so it holds
        for every entry point: API, Django admin, shell, fixtures.
        Capitalising for display is the frontend's business.
        """
        self.name = self.name.strip().lower()
        super().save(*args, **kwargs)


class RecipeTag(models.Model):
    """SQL: RecipeTag - joins Recipe to Tag."""

    # recipe_tag_id INT AUTO_INCREMENT PRIMARY KEY
    recipe_tag_id = models.AutoField(primary_key=True)

    # recipe_id INT NOT NULL, FK -> Recipe ON DELETE CASCADE
    recipe = models.ForeignKey(
        Recipe,
        on_delete=models.CASCADE,
        related_name='recipe_tags',
    )

    # tag_id INT NOT NULL, FK -> Tag
    # PROTECT, not CASCADE, matching RecipeIngredient.ingredient: deleting
    # "vegan" from the lookup table should not silently untag every recipe
    # that carries it.
    tag = models.ForeignKey(
        Tag,
        on_delete=models.PROTECT,
        related_name='recipe_links',
    )

    class Meta:
        db_table = 'RecipeTag'
        constraints = [
            # The same tag twice on one recipe is a bug, not a preference.
            models.UniqueConstraint(
                fields=['recipe', 'tag'],
                name='unique_tag_per_recipe',
            ),
        ]

    def __str__(self):
        return f'{self.recipe.title} - {self.tag.name}'


class SavedRecipe(models.Model):
    """SQL: SavedRecipe - joins User to Recipe, the personal collection."""

    # saved_recipe_id INT AUTO_INCREMENT PRIMARY KEY
    saved_recipe_id = models.AutoField(primary_key=True)

    # user_id INT NOT NULL, FK -> Users
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='saved_recipes',
    )

    # recipe_id INT NOT NULL, FK -> Recipe ON DELETE CASCADE
    # `saved_by` rather than `saved_recipes` on this side: from a Recipe the
    # reverse set answers "who saved this", which is what the dashboard's
    # most-saved report counts.
    recipe = models.ForeignKey(
        Recipe,
        on_delete=models.CASCADE,
        related_name='saved_by',
    )

    # saved_at TIMESTAMP
    saved_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'SavedRecipe'
        ordering = ['-saved_at']
        constraints = [
            # Saving twice is a no-op, not a second entry in the collection.
            # The API turns this into "already saved" rather than a 500.
            models.UniqueConstraint(
                fields=['user', 'recipe'],
                name='unique_saved_recipe_per_user',
            ),
        ]

    def __str__(self):
        return f'{self.user.username} saved {self.recipe.title}'
