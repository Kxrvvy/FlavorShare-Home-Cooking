"""Tests for the recipe core models and serializers.

Weighted toward the rules that would otherwise fail silently: the deletion
behaviour that protects a user's content, the constraints that keep a
recipe's steps and ingredients coherent, and the two rules the database
cannot express - an image pinned to another recipe's step, and publishing a
recipe that has no content yet.
"""

from decimal import Decimal
from types import SimpleNamespace

from django.contrib import admin as django_admin
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.test import RequestFactory, TestCase
from django.urls import reverse

from .admin import ImageAdmin, ImageInline
from .models import Image, Ingredient, Recipe, RecipeIngredient, Step
from .serializers import (
    ImageSerializer,
    IngredientSerializer,
    RecipeIngredientSerializer,
    RecipeWriteSerializer,
    StepSerializer,
)

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


class IngredientSerializerTests(RecipeTestCase):
    """Names are normalised before the uniqueness check, not after.

    Checking after is what turns a duplicate into a 500: the raw input finds
    no matching row, passes, and only collides once save() lowercases it.
    """

    def test_name_is_normalised_on_the_way_in(self):
        serializer = IngredientSerializer(data={'name': 'Basil'})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['name'], 'basil')

    def test_differently_cased_duplicate_is_a_validation_error(self):
        Ingredient.objects.create(name='salt')

        serializer = IngredientSerializer(data={'name': 'Salt'})
        self.assertFalse(serializer.is_valid())
        self.assertIn('name', serializer.errors)

    def test_renaming_an_ingredient_does_not_clash_with_itself(self):
        salt = Ingredient.objects.create(name='salt')

        serializer = IngredientSerializer(
            salt, data={'name': 'Salt'}, partial=True
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_a_blank_name_is_rejected(self):
        serializer = IngredientSerializer(data={'name': '   '})
        self.assertFalse(serializer.is_valid())
        self.assertIn('name', serializer.errors)


class ImageCleanTests(RecipeTestCase):
    """Image.clean() - the one place the step/recipe rules are written.

    ImageSerializer and the Django admin both reach these rules through this
    method, so the cases below are what both of them inherit.
    """

    def setUp(self):
        self.step = Step.objects.create(
            recipe=self.recipe, step_number=1, instruction='Boil.'
        )

    def _image(self, **overrides):
        values = {
            'recipe': self.recipe,
            'step': self.step,
            'uploaded_by': self.user,
            'url': 'https://example.com/a.jpg',
            'type': Image.Type.STEP,
        }
        values.update(overrides)
        return Image(**values)

    def test_a_valid_step_photo_passes(self):
        self._image().clean()

    def test_a_final_image_without_a_step_passes(self):
        self._image(type=Image.Type.FINAL, step=None).clean()

    def test_a_step_from_another_recipe_is_rejected(self):
        other = Recipe.objects.create(user=self.user, title='Sinigang')
        stranger = Step.objects.create(
            recipe=other, step_number=1, instruction='Simmer.'
        )

        with self.assertRaises(DjangoValidationError):
            self._image(step=stranger).clean()

    def test_a_step_photo_must_name_its_step(self):
        with self.assertRaises(DjangoValidationError):
            self._image(step=None).clean()

    def test_a_final_image_may_not_pin_a_step(self):
        """A matching step still has to agree with `type`."""
        with self.assertRaises(DjangoValidationError):
            self._image(type=Image.Type.FINAL).clean()

    def test_an_ingredient_image_may_not_pin_a_step(self):
        with self.assertRaises(DjangoValidationError):
            self._image(type=Image.Type.INGREDIENT).clean()

    def test_errors_are_keyed_on_the_step_field(self):
        """Both callers attach the message to `step`, so it must be keyed."""
        with self.assertRaises(DjangoValidationError) as caught:
            self._image(step=None).clean()

        self.assertIn('step', caught.exception.message_dict)

    def test_full_clean_runs_it(self):
        """full_clean() is the door the admin's ModelForm comes through."""
        with self.assertRaises(DjangoValidationError):
            self._image(type=Image.Type.FINAL).full_clean()


class ImageAdminValidationTests(RecipeTestCase):
    """The admin inherits the rules from the model, with no copy of its own."""

    def setUp(self):
        self.step = Step.objects.create(
            recipe=self.recipe, step_number=1, instruction='Boil.'
        )
        self.request = RequestFactory().get('/')
        self.request.user = self.user

    def _admin_form(self, **overrides):
        data = {
            'recipe': self.recipe.pk,
            'step': self.step.pk,
            'uploaded_by': self.user.pk,
            'url': 'https://example.com/a.jpg',
            'type': Image.Type.STEP,
        }
        data.update(overrides)

        form_class = ImageAdmin(Image, django_admin.site).get_form(
            self.request
        )
        return form_class(data=data)

    def test_admin_form_accepts_a_valid_step_photo(self):
        form = self._admin_form()
        self.assertTrue(form.is_valid(), form.errors)

    def test_admin_form_rejects_a_step_from_another_recipe(self):
        other = Recipe.objects.create(user=self.user, title='Sinigang')
        stranger = Step.objects.create(
            recipe=other, step_number=1, instruction='Simmer.'
        )

        form = self._admin_form(step=stranger.pk)
        self.assertFalse(form.is_valid())
        self.assertIn('step', form.errors)

    def test_admin_form_rejects_a_final_image_pinned_to_a_step(self):
        form = self._admin_form(type=Image.Type.FINAL)
        self.assertFalse(form.is_valid())
        self.assertIn('step', form.errors)

    def test_the_inline_step_dropdown_hides_other_recipes_steps(self):
        """Belt and braces: the cross-recipe row is unreachable from the UI."""
        other = Recipe.objects.create(user=self.user, title='Sinigang')
        stranger = Step.objects.create(
            recipe=other, step_number=1, instruction='Simmer.'
        )

        request = RequestFactory().get(
            f'/admin/recipes/recipe/{self.recipe.pk}/change/'
        )
        request.user = self.user
        request.resolver_match = SimpleNamespace(
            kwargs={'object_id': str(self.recipe.pk)}
        )

        field = ImageInline(
            Recipe, django_admin.site
        ).formfield_for_foreignkey(Image._meta.get_field('step'), request)

        self.assertIn(self.step, field.queryset)
        self.assertNotIn(stranger, field.queryset)


class ImageInlineAdminTests(TestCase):
    """The recipe page's image inline, driven through the real admin.

    Posted rather than assembled by hand: an inline formset built from a bare
    request treats its extra form as unchanged and skips validation entirely,
    so a hand-built one passes without ever running clean() and proves
    nothing. These go through the change view the way a person would.
    """

    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            username='boss',
            email='boss@example.com',
            password='n0t-a-real-password',
            role=User.Role.ADMIN,
        )
        cls.recipe = Recipe.objects.create(user=cls.admin, title='Adobo')
        cls.step = Step.objects.create(
            recipe=cls.recipe, step_number=1, instruction='Boil.'
        )

    def setUp(self):
        self.client.force_login(self.admin)

    def _post_image_row(self, image_type):
        return self.client.post(
            reverse('admin:recipes_recipe_change', args=[self.recipe.pk]),
            {
                'title': 'Adobo',
                'user': str(self.admin.pk),
                'description': '',
                'cuisine_type': '',
                'prep_time': '',
                'cook_time': '',
                'servings': '',
                'difficulty': '',
                'status': Recipe.Status.DRAFT,
                'steps-TOTAL_FORMS': '0',
                'steps-INITIAL_FORMS': '0',
                'steps-MIN_NUM_FORMS': '0',
                'steps-MAX_NUM_FORMS': '1000',
                'recipe_ingredients-TOTAL_FORMS': '0',
                'recipe_ingredients-INITIAL_FORMS': '0',
                'recipe_ingredients-MIN_NUM_FORMS': '0',
                'recipe_ingredients-MAX_NUM_FORMS': '1000',
                'images-TOTAL_FORMS': '1',
                'images-INITIAL_FORMS': '0',
                'images-MIN_NUM_FORMS': '0',
                'images-MAX_NUM_FORMS': '1000',
                'images-0-type': image_type,
                'images-0-step': str(self.step.pk),
                'images-0-url': 'https://example.com/a.jpg',
                'images-0-uploaded_by': str(self.admin.pk),
            },
        )

    def test_a_valid_step_photo_saves(self):
        """Also proves the parent FK is set before clean() compares it."""
        response = self._post_image_row(Image.Type.STEP)

        self.assertEqual(response.status_code, 302)
        image = Image.objects.get()
        self.assertEqual(image.recipe_id, self.recipe.pk)
        self.assertEqual(image.step_id, self.step.pk)

    def test_an_incoherent_type_is_refused(self):
        """Image.clean() reaches inline rows, with no admin-side copy."""
        response = self._post_image_row(Image.Type.FINAL)

        # The page is redisplayed rather than redirecting on save.
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Image.objects.count(), 0)
        self.assertContains(
            response, 'belongs to the recipe as a whole', html=False
        )


class ImageSerializerTests(RecipeTestCase):
    """The cross-recipe check the database cannot make."""

    def setUp(self):
        self.step = Step.objects.create(
            recipe=self.recipe, step_number=1, instruction='Boil.'
        )

    def _data(self, **overrides):
        data = {
            'recipe': self.recipe.pk,
            'url': 'https://example.com/a.jpg',
            'type': Image.Type.STEP,
            'step': self.step.pk,
        }
        data.update(overrides)
        return data

    def test_a_valid_step_photo_passes(self):
        serializer = ImageSerializer(data=self._data())
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_step_belonging_to_another_recipe_is_rejected(self):
        other = Recipe.objects.create(user=self.user, title='Sinigang')
        stranger = Step.objects.create(
            recipe=other, step_number=1, instruction='Simmer.'
        )

        serializer = ImageSerializer(data=self._data(step=stranger.pk))
        self.assertFalse(serializer.is_valid())
        self.assertIn('step', serializer.errors)

    def test_a_step_photo_must_name_its_step(self):
        serializer = ImageSerializer(data=self._data(step=None))
        self.assertFalse(serializer.is_valid())
        self.assertIn('step', serializer.errors)

    def test_a_final_image_may_not_pin_a_step(self):
        serializer = ImageSerializer(
            data=self._data(type=Image.Type.FINAL)
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn('step', serializer.errors)

    def test_a_final_image_without_a_step_is_fine(self):
        serializer = ImageSerializer(
            data=self._data(type=Image.Type.FINAL, step=None)
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_uploaded_by_is_not_writable(self):
        """The view sets the uploader; a client must not be able to."""
        intruder = User.objects.create_user(
            username='intruder',
            email='intruder@example.com',
            password='n0t-a-real-password',
        )

        serializer = ImageSerializer(
            data=self._data(uploaded_by=intruder.pk)
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertNotIn('uploaded_by', serializer.validated_data)


class StepSerializerTests(RecipeTestCase):
    """Step numbers are the server's to assign."""

    def test_the_first_step_is_numbered_one(self):
        serializer = StepSerializer(
            data={'recipe': self.recipe.pk, 'instruction': 'Boil.'}
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['step_number'], 1)

    def test_the_next_step_continues_the_count(self):
        Step.objects.create(
            recipe=self.recipe, step_number=1, instruction='Boil.'
        )

        serializer = StepSerializer(
            data={'recipe': self.recipe.pk, 'instruction': 'Simmer.'}
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['step_number'], 2)

    def test_a_duplicate_number_is_a_validation_error(self):
        Step.objects.create(
            recipe=self.recipe, step_number=1, instruction='Boil.'
        )

        serializer = StepSerializer(data={
            'recipe': self.recipe.pk,
            'step_number': 1,
            'instruction': 'Simmer.',
        })
        self.assertFalse(serializer.is_valid())
        self.assertIn('step_number', serializer.errors)

    def test_the_same_number_in_another_recipe_is_fine(self):
        Step.objects.create(
            recipe=self.recipe, step_number=1, instruction='Boil.'
        )
        other = Recipe.objects.create(user=self.user, title='Sinigang')

        serializer = StepSerializer(data={
            'recipe': other.pk,
            'step_number': 1,
            'instruction': 'Simmer.',
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)


class RecipeIngredientSerializerTests(RecipeTestCase):
    """Typing a name finds the shared row instead of making a new one."""

    def _data(self, **overrides):
        data = {
            'recipe': self.recipe.pk,
            'ingredient_name': 'Salt',
            'quantity': '2.00',
            'unit': 'tsp',
        }
        data.update(overrides)
        return data

    def test_a_new_name_creates_the_lookup_row(self):
        serializer = RecipeIngredientSerializer(data=self._data())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        link = serializer.save()

        self.assertEqual(link.ingredient.name, 'salt')
        self.assertEqual(Ingredient.objects.filter(name='salt').count(), 1)

    def test_an_existing_ingredient_is_reused(self):
        """"Salt" must find the stored "salt" rather than collide with it."""
        salt = Ingredient.objects.create(name='salt')

        serializer = RecipeIngredientSerializer(data=self._data())
        self.assertTrue(serializer.is_valid(), serializer.errors)
        link = serializer.save()

        self.assertEqual(link.ingredient, salt)
        self.assertEqual(Ingredient.objects.count(), 1)

    def test_the_same_ingredient_twice_is_a_validation_error(self):
        RecipeIngredient.objects.create(
            recipe=self.recipe,
            ingredient=Ingredient.objects.create(name='salt'),
        )

        serializer = RecipeIngredientSerializer(data=self._data())
        self.assertFalse(serializer.is_valid())
        self.assertIn('ingredient_name', serializer.errors)

    def test_quantity_unit_and_notes_stay_optional(self):
        serializer = RecipeIngredientSerializer(
            data={'recipe': self.recipe.pk, 'ingredient_name': 'pepper'}
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)


class RecipeWriteSerializerTests(RecipeTestCase):
    """Ownership, the view counter, and the publish gate."""

    def _publish(self, recipe=None):
        return RecipeWriteSerializer(
            recipe or self.recipe,
            data={'status': Recipe.Status.PUBLISHED},
            partial=True,
        )

    def test_user_and_view_count_are_not_writable(self):
        intruder = User.objects.create_user(
            username='intruder',
            email='intruder@example.com',
            password='n0t-a-real-password',
        )

        serializer = RecipeWriteSerializer(data={
            'title': 'Lumpia',
            'user': intruder.pk,
            'view_count': 999,
        })
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertNotIn('user', serializer.validated_data)
        self.assertNotIn('view_count', serializer.validated_data)

    def test_a_new_recipe_may_not_be_published_outright(self):
        """Writes are flat, so a recipe being created has no content yet."""
        serializer = RecipeWriteSerializer(data={
            'title': 'Lumpia',
            'status': Recipe.Status.PUBLISHED,
        })
        self.assertFalse(serializer.is_valid())
        self.assertIn('status', serializer.errors)

    def test_a_near_empty_draft_still_saves(self):
        serializer = RecipeWriteSerializer(data={'title': 'Lumpia'})
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_publishing_without_steps_is_refused(self):
        RecipeIngredient.objects.create(
            recipe=self.recipe,
            ingredient=Ingredient.objects.create(name='salt'),
        )

        serializer = self._publish()
        self.assertFalse(serializer.is_valid())
        self.assertIn('steps', str(serializer.errors['status']))

    def test_publishing_without_ingredients_is_refused(self):
        Step.objects.create(
            recipe=self.recipe, step_number=1, instruction='Boil.'
        )

        serializer = self._publish()
        self.assertFalse(serializer.is_valid())
        self.assertIn('ingredients', str(serializer.errors['status']))

    def test_publishing_with_both_succeeds(self):
        Step.objects.create(
            recipe=self.recipe, step_number=1, instruction='Boil.'
        )
        RecipeIngredient.objects.create(
            recipe=self.recipe,
            ingredient=Ingredient.objects.create(name='salt'),
        )

        serializer = self._publish()
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.save().status, Recipe.Status.PUBLISHED)

    def test_resaving_a_published_recipe_is_not_blocked(self):
        """The gate guards the transition, not every later edit."""
        published = Recipe.objects.create(
            user=self.user,
            title='Sinigang',
            status=Recipe.Status.PUBLISHED,
        )

        serializer = self._publish(published)
        self.assertTrue(serializer.is_valid(), serializer.errors)
