"""Tests for the recipe core models.

Weighted toward the rules that would otherwise fail silently: the deletion
behaviour that protects a user's content, and the constraints that keep a
recipe's steps and ingredients coherent.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.test import TestCase

from .models import Image, Ingredient, Recipe, RecipeIngredient, Step

User = get_user_model()


class RecipeTestCase(TestCase):
    """A user with one recipe, shared by the cases below."""

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password='n0t-a-real-password',
        )
        cls.recipe = Recipe.objects.create(user=cls.user, title='Adobo')


class IngredientTests(TestCase):
    def test_name_is_lowercased_and_stripped(self):
        ingredient = Ingredient.objects.create(name='  Salt  ')
        self.assertEqual(ingredient.name, 'salt')

    def test_category_is_normalised_too(self):
        ingredient = Ingredient.objects.create(name='basil', category=' Herbs ')
        self.assertEqual(ingredient.category, 'herbs')

    def test_differently_cased_duplicates_collide(self):
        """The whole point of normalising: Salt and salt are one row."""
        Ingredient.objects.create(name='salt')
        with self.assertRaises(IntegrityError):
            Ingredient.objects.create(name='Salt')

    def test_category_is_optional(self):
        self.assertIsNone(Ingredient.objects.create(name='water').category)


class RecipeDefaultsTests(RecipeTestCase):
    def test_new_recipes_start_as_drafts(self):
        """Draft-first: the row exists before the recipe is finished."""
        self.assertEqual(self.recipe.status, Recipe.Status.DRAFT)

    def test_view_count_starts_at_zero(self):
        self.assertEqual(self.recipe.view_count, 0)

    def test_a_draft_may_be_almost_empty(self):
        """Everything but title is optional, or the builder cannot save."""
        recipe = Recipe.objects.create(user=self.user, title='Untitled')
        self.assertIsNone(recipe.description)
        self.assertIsNone(recipe.servings)
        self.assertIsNone(recipe.difficulty)

    def test_timestamps_are_set(self):
        self.assertIsNotNone(self.recipe.created_at)
        self.assertIsNotNone(self.recipe.updated_at)


class UserDeletionTests(RecipeTestCase):
    """A removed user's content must survive - enforced by PROTECT."""

    def test_deleting_an_author_is_refused(self):
        with self.assertRaises(ProtectedError):
            self.user.delete()

        self.assertTrue(Recipe.objects.filter(pk=self.recipe.pk).exists())

    def test_deactivating_keeps_the_recipe_and_its_author(self):
        self.user.is_active = False
        self.user.save(update_fields=['is_active'])

        self.recipe.refresh_from_db()
        self.assertEqual(self.recipe.user, self.user)

    def test_deleting_an_uploader_is_refused(self):
        other = User.objects.create_user(
            username='photographer',
            email='photo@example.com',
            password='n0t-a-real-password',
        )
        Image.objects.create(
            recipe=self.recipe,
            uploaded_by=other,
            url='https://example.com/a.jpg',
            type=Image.Type.FINAL,
        )

        with self.assertRaises(ProtectedError):
            other.delete()


class RecipeDeletionTests(RecipeTestCase):
    """Deleting a recipe takes its own children with it."""

    def test_children_are_removed_with_the_recipe(self):
        step = Step.objects.create(
            recipe=self.recipe, step_number=1, instruction='Simmer.'
        )
        Image.objects.create(
            recipe=self.recipe,
            uploaded_by=self.user,
            url='https://example.com/a.jpg',
            type=Image.Type.FINAL,
        )
        RecipeIngredient.objects.create(
            recipe=self.recipe,
            ingredient=Ingredient.objects.create(name='soy sauce'),
        )

        self.recipe.delete()

        self.assertFalse(Step.objects.filter(pk=step.pk).exists())
        self.assertEqual(Image.objects.count(), 0)
        self.assertEqual(RecipeIngredient.objects.count(), 0)

    def test_the_ingredient_itself_survives(self):
        """Only the link dies - the shared lookup row is still there."""
        ingredient = Ingredient.objects.create(name='soy sauce')
        RecipeIngredient.objects.create(
            recipe=self.recipe, ingredient=ingredient
        )

        self.recipe.delete()

        self.assertTrue(Ingredient.objects.filter(pk=ingredient.pk).exists())

    def test_deleting_an_in_use_ingredient_is_refused(self):
        ingredient = Ingredient.objects.create(name='soy sauce')
        RecipeIngredient.objects.create(
            recipe=self.recipe, ingredient=ingredient
        )

        with self.assertRaises(ProtectedError):
            ingredient.delete()


class StepTests(RecipeTestCase):
    def test_steps_come_back_in_order(self):
        Step.objects.create(recipe=self.recipe, step_number=2, instruction='B')
        Step.objects.create(recipe=self.recipe, step_number=1, instruction='A')

        self.assertEqual(
            [s.instruction for s in self.recipe.steps.all()], ['A', 'B']
        )

    def test_duplicate_step_number_in_one_recipe_is_rejected(self):
        Step.objects.create(recipe=self.recipe, step_number=1, instruction='A')

        with self.assertRaises(IntegrityError):
            Step.objects.create(
                recipe=self.recipe, step_number=1, instruction='B'
            )

    def test_the_same_number_in_another_recipe_is_fine(self):
        other = Recipe.objects.create(user=self.user, title='Sinigang')
        Step.objects.create(recipe=self.recipe, step_number=1, instruction='A')

        Step.objects.create(recipe=other, step_number=1, instruction='A')

        self.assertEqual(Step.objects.filter(step_number=1).count(), 2)


class ImageTests(RecipeTestCase):
    def make_image(self, **kwargs):
        return Image.objects.create(
            recipe=self.recipe,
            uploaded_by=self.user,
            url='https://example.com/a.jpg',
            **kwargs,
        )

    def test_final_image_has_no_step(self):
        self.assertIsNone(self.make_image(type=Image.Type.FINAL).step)

    def test_step_image_is_reachable_from_its_step(self):
        step = Step.objects.create(
            recipe=self.recipe, step_number=1, instruction='Simmer.'
        )
        image = self.make_image(type=Image.Type.STEP, step=step)

        self.assertEqual(list(step.images.all()), [image])

    def test_deleting_a_step_removes_only_its_photo(self):
        step = Step.objects.create(
            recipe=self.recipe, step_number=1, instruction='Simmer.'
        )
        step_image = self.make_image(type=Image.Type.STEP, step=step)
        cover = self.make_image(type=Image.Type.FINAL)

        step.delete()

        self.assertFalse(Image.objects.filter(pk=step_image.pk).exists())
        self.assertTrue(Image.objects.filter(pk=cover.pk).exists())

    def test_recipe_images_include_both_kinds(self):
        step = Step.objects.create(
            recipe=self.recipe, step_number=1, instruction='Simmer.'
        )
        self.make_image(type=Image.Type.STEP, step=step)
        self.make_image(type=Image.Type.FINAL)

        self.assertEqual(self.recipe.images.count(), 2)


class RecipeIngredientTests(RecipeTestCase):
    def setUp(self):
        self.salt = Ingredient.objects.create(name='salt')

    def test_quantity_unit_and_notes_are_all_optional(self):
        link = RecipeIngredient.objects.create(
            recipe=self.recipe, ingredient=self.salt
        )
        self.assertIsNone(link.quantity)
        self.assertIsNone(link.unit)
        self.assertIsNone(link.notes)

    def test_notes_carry_an_unmeasurable_amount(self):
        """The reason `notes` exists: keep quantity AND "to taste"."""
        link = RecipeIngredient.objects.create(
            recipe=self.recipe,
            ingredient=self.salt,
            quantity=Decimal('1.00'),
            unit='tsp',
            notes='or to taste',
        )
        self.assertEqual(link.quantity, Decimal('1.00'))
        self.assertEqual(link.notes, 'or to taste')

    def test_the_same_ingredient_twice_is_rejected(self):
        RecipeIngredient.objects.create(
            recipe=self.recipe, ingredient=self.salt
        )

        with self.assertRaises(IntegrityError):
            RecipeIngredient.objects.create(
                recipe=self.recipe, ingredient=self.salt
            )

    def test_two_recipes_share_one_ingredient_row(self):
        """Sharing works through the join table, not duplicate rows."""
        other = Recipe.objects.create(user=self.user, title='Sinigang')
        RecipeIngredient.objects.create(
            recipe=self.recipe, ingredient=self.salt
        )
        RecipeIngredient.objects.create(recipe=other, ingredient=self.salt)

        self.assertEqual(Ingredient.objects.filter(name='salt').count(), 1)
        self.assertEqual(self.salt.recipe_links.count(), 2)


class StrTests(RecipeTestCase):
    """Readable labels in the Django admin and in shell output."""

    def test_recipe(self):
        self.assertEqual(str(self.recipe), 'Adobo')

    def test_ingredient(self):
        self.assertEqual(str(Ingredient.objects.create(name='Salt')), 'salt')

    def test_step(self):
        step = Step.objects.create(
            recipe=self.recipe, step_number=2, instruction='Simmer.'
        )
        self.assertEqual(str(step), 'Adobo - step 2')

    def test_image(self):
        image = Image.objects.create(
            recipe=self.recipe,
            uploaded_by=self.user,
            url='https://example.com/a.jpg',
            type=Image.Type.FINAL,
        )
        self.assertEqual(str(image), 'Final image for Adobo')

    def test_recipe_ingredient(self):
        link = RecipeIngredient.objects.create(
            recipe=self.recipe,
            ingredient=Ingredient.objects.create(name='salt'),
            quantity=Decimal('2.00'),
            unit='tsp',
        )
        self.assertEqual(str(link), '2 tsp salt')
