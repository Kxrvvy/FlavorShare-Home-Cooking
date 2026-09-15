"""Tests for the recipe core models and serializers.

Weighted toward the rules that would otherwise fail silently: the deletion
behaviour that protects a user's content, the constraints that keep a
recipe's steps and ingredients coherent, and the two rules the database
cannot express - an image pinned to another recipe's step, and publishing a
recipe that has no content yet.
"""

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from cloudinary.exceptions import Error as CloudinaryError
from django.conf import settings
from django.contrib import admin as django_admin
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.db.models import Count, ProtectedError
from django.db import connection
from django.test import RequestFactory, TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .admin import ImageAdmin, ImageInline
from .filters import RecipeFilterSet
from .models import Image, Ingredient, Recipe, RecipeIngredient, Step
from .serializers import (
    ImageSerializer,
    IngredientSerializer,
    RecipeIngredientSerializer,
    RecipeListSerializer,
    RecipeWriteSerializer,
    StepSerializer,
)
from .views import RecipeViewSet, visible_recipes

RECIPES_URL = '/api/recipes/'

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


class ImageUploadTests(APITestCase):
    """POST /api/recipes/images/upload/ - the file's trip to Cloudinary.

    cloudinary.uploader.upload is mocked throughout: the suite must not make
    network calls, and it has to pass on a checkout with no credentials. The
    mock is asserted against, so an endpoint that quietly stopped uploading
    would fail here rather than look green.
    """

    URL = '/api/recipes/images/upload/'

    CREDENTIALS = {
        'CLOUD_NAME': 'test-cloud',
        'API_KEY': 'test-key',
        'API_SECRET': 'test-secret',
    }

    RESPONSE = {
        'secure_url': 'https://res.cloudinary.com/test-cloud/image/upload/a.jpg',
        'url': 'http://res.cloudinary.com/test-cloud/image/upload/a.jpg',
        'public_id': 'a',
    }

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password='n0t-a-real-password',
        )

    def _file(self, name='photo.jpg', content=b'not-really-a-jpeg'):
        return SimpleUploadedFile(name, content, content_type='image/jpeg')

    def _post(self, **kwargs):
        with override_settings(CLOUDINARY_STORAGE=self.CREDENTIALS):
            return self.client.post(self.URL, kwargs, format='multipart')

    def test_a_signed_in_user_can_upload(self):
        self.client.force_authenticate(self.user)

        with patch('cloudinary.uploader.upload', return_value=self.RESPONSE) as up:
            response = self._post(file=self._file())

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['url'], self.RESPONSE['secure_url'])
        self.assertEqual(response.data['public_id'], 'a')

        # The endpoint really called out, rather than inventing a URL.
        up.assert_called_once()

    def test_the_https_url_is_returned_not_the_plain_one(self):
        self.client.force_authenticate(self.user)

        with patch('cloudinary.uploader.upload', return_value=self.RESPONSE):
            response = self._post(file=self._file())

        self.assertTrue(response.data['url'].startswith('https://'))

    def test_an_anonymous_caller_is_refused(self):
        with patch('cloudinary.uploader.upload') as up:
            response = self._post(file=self._file())

        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )
        up.assert_not_called()

    def test_a_missing_file_is_a_400(self):
        self.client.force_authenticate(self.user)

        with patch('cloudinary.uploader.upload') as up:
            response = self._post()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('file', response.data)
        up.assert_not_called()

    def test_an_oversized_file_is_refused_before_it_is_sent(self):
        """The size check has to come first, or a huge upload costs bandwidth."""
        self.client.force_authenticate(self.user)
        oversized = self._file(
            content=b'x' * (settings.MAX_IMAGE_UPLOAD_BYTES + 1)
        )

        with patch('cloudinary.uploader.upload') as up:
            response = self._post(file=oversized)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        up.assert_not_called()

    def test_a_non_image_is_a_400_not_a_502(self):
        """The caller's mistake, so it must not be reported as an outage."""
        self.client.force_authenticate(self.user)
        not_an_image = SimpleUploadedFile(
            'notes.pdf', b'%PDF-1.4', content_type='application/pdf'
        )

        with patch('cloudinary.uploader.upload') as up:
            response = self._post(file=not_an_image)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('file', response.data)
        up.assert_not_called()

    def test_missing_credentials_answer_503_not_a_traceback(self):
        """A clone with no .env should be told what is wrong."""
        self.client.force_authenticate(self.user)

        with override_settings(CLOUDINARY_STORAGE={'CLOUD_NAME': ''}):
            with patch('cloudinary.uploader.upload') as up:
                response = self.client.post(
                    self.URL, {'file': self._file()}, format='multipart'
                )

        self.assertEqual(
            response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE
        )
        up.assert_not_called()

    def test_an_upload_failure_is_reported_as_a_502(self):
        self.client.force_authenticate(self.user)

        with patch(
            'cloudinary.uploader.upload', side_effect=CloudinaryError('nope')
        ):
            response = self._post(file=self._file())

        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)


class PublicationGateTests(RecipeTestCase):
    """Recipe.publication_error() - the rule both callers share."""

    def _add_ingredient(self, recipe):
        RecipeIngredient.objects.create(
            recipe=recipe,
            ingredient=Ingredient.objects.create(name='salt'),
        )

    def _add_step(self, recipe):
        Step.objects.create(
            recipe=recipe, step_number=1, instruction='Boil.'
        )

    def test_an_unsaved_recipe_is_refused_without_touching_the_database(self):
        """The pk guard. Reverse managers raise ValueError on an unsaved row.

        This is the shared landmine behind both create paths - a POST of a
        brand new recipe and the admin's add page.
        """
        error = Recipe().publication_error()

        self.assertIsNotNone(error)
        self.assertIn('saved as a draft', error)

    def test_an_empty_recipe_names_both_things(self):
        error = self.recipe.publication_error()

        self.assertIn('ingredients', error)
        self.assertIn('steps', error)

    def test_only_steps_names_the_ingredients(self):
        self._add_step(self.recipe)
        error = self.recipe.publication_error()

        self.assertIn('ingredients', error)
        self.assertNotIn('steps', error)

    def test_only_ingredients_names_the_steps(self):
        self._add_ingredient(self.recipe)
        error = self.recipe.publication_error()

        self.assertIn('steps', error)
        self.assertNotIn('ingredients', error)

    def test_a_complete_recipe_has_no_error(self):
        self._add_step(self.recipe)
        self._add_ingredient(self.recipe)

        self.assertIsNone(self.recipe.publication_error())

    def test_can_be_published_agrees(self):
        self.assertFalse(self.recipe.can_be_published())
        self.assertFalse(Recipe().can_be_published())

        self._add_step(self.recipe)
        self._add_ingredient(self.recipe)
        self.assertTrue(self.recipe.can_be_published())


class RecipeAdminPublishGateTests(TestCase):
    """The same gate, through the admin's status dropdown."""

    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_user(
            username='boss',
            email='boss@example.com',
            password='n0t-a-real-password',
            role=User.Role.ADMIN,
        )
        cls.recipe = Recipe.objects.create(user=cls.admin, title='Adobo')

    def setUp(self):
        self.client.force_login(self.admin)

    def _form_data(self, status=Recipe.Status.PUBLISHED, **overrides):
        data = {
            'title': 'Adobo',
            'user': str(self.admin.pk),
            'description': '',
            'cuisine_type': '',
            'prep_time': '',
            'cook_time': '',
            'servings': '',
            'difficulty': '',
            'status': status,
            'steps-TOTAL_FORMS': '0',
            'steps-INITIAL_FORMS': '0',
            'steps-MIN_NUM_FORMS': '0',
            'steps-MAX_NUM_FORMS': '1000',
            'recipe_ingredients-TOTAL_FORMS': '0',
            'recipe_ingredients-INITIAL_FORMS': '0',
            'recipe_ingredients-MIN_NUM_FORMS': '0',
            'recipe_ingredients-MAX_NUM_FORMS': '1000',
            'images-TOTAL_FORMS': '0',
            'images-INITIAL_FORMS': '0',
            'images-MIN_NUM_FORMS': '0',
            'images-MAX_NUM_FORMS': '1000',
        }
        data.update(overrides)
        return data

    def _post_change(self, **overrides):
        return self.client.post(
            reverse('admin:recipes_recipe_change', args=[self.recipe.pk]),
            self._form_data(**overrides),
        )

    def _fill_in(self):
        Step.objects.create(
            recipe=self.recipe, step_number=1, instruction='Boil.'
        )
        RecipeIngredient.objects.create(
            recipe=self.recipe,
            ingredient=Ingredient.objects.create(name='salt'),
        )

    def test_publishing_an_empty_recipe_is_refused(self):
        response = self._post_change()

        self.assertEqual(response.status_code, 200)
        self.recipe.refresh_from_db()
        self.assertEqual(self.recipe.status, Recipe.Status.DRAFT)
        self.assertContains(response, 'before it can be published')

    def test_publishing_a_complete_recipe_works(self):
        self._fill_in()
        response = self._post_change()

        self.assertEqual(response.status_code, 302)
        self.recipe.refresh_from_db()
        self.assertEqual(self.recipe.status, Recipe.Status.PUBLISHED)

    def test_saving_as_a_draft_is_never_gated(self):
        response = self._post_change(status=Recipe.Status.DRAFT)

        self.assertEqual(response.status_code, 302)

    def test_resaving_an_already_published_recipe_is_allowed(self):
        """The gate guards the transition, not every later edit."""
        Recipe.objects.filter(pk=self.recipe.pk).update(
            status=Recipe.Status.PUBLISHED
        )

        response = self._post_change()
        self.assertEqual(response.status_code, 302)

    def test_the_add_page_cannot_publish_outright(self):
        """The other half of the pk guard, through the admin this time."""
        response = self.client.post(
            reverse('admin:recipes_recipe_add'),
            self._form_data(title='Brand new'),
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'saved as a draft')
        self.assertFalse(Recipe.objects.filter(title='Brand new').exists())

    def test_adding_the_first_step_and_publishing_at_once_is_refused(self):
        """KNOWN LIMITATION, asserted so it cannot be fixed silently.

        Inline rows save after the parent form is validated, so a submission
        that adds the first step *and* flips to Published is refused - the
        step does not exist yet when clean_status() looks. This is documented
        in RecipeAdminForm's help_text for `status`.

        If this test ever fails, the limitation is gone: delete the test and
        the help_text sentence that warns about it.
        """
        RecipeIngredient.objects.create(
            recipe=self.recipe,
            ingredient=Ingredient.objects.create(name='salt'),
        )

        response = self._post_change(**{
            'steps-TOTAL_FORMS': '1',
            'steps-0-step_number': '1',
            'steps-0-instruction': 'Boil.',
        })

        self.assertEqual(response.status_code, 200)
        self.recipe.refresh_from_db()
        self.assertEqual(self.recipe.status, Recipe.Status.DRAFT)


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


class BrowseTestCase(APITestCase):
    """A small catalogue with known answers, for search, filter and sort.

    Deliberately includes the awkward rows: a recipe carrying two tags that
    both match one search term, one with no ratings or saves at all, and a
    draft that must stay out of every public result.

        Tofu curry      Thai/easy      10/20  vegan, gluten-free  tofu, rice
                                              ratings 5 and 3 -> 4.0, 2 saves
        Lentil soup     Indian/easy    15/40  vegan               lentils
                                              rating 4 -> 4.0
        Rice cake       Filipino/med   30/60  gluten-free         rice
                                              rating 1 -> 1.0, 1 save
        Adobo           Filipino/hard  20/90  -                   pork, vinegar
                                              no ratings, no saves
        Vegan feast     Fusion/easy    10/10  vegan, vegan-friendly   tofu
                                              title AND two tags match "vegan"
        Secret sinigang DRAFT
    """

    @classmethod
    def setUpTestData(cls):
        # Imported here rather than at module scope as a reminder of the
        # direction of dependency: social imports recipes, never the reverse.
        # A test module may reach across; recipes/filters.py may not.
        from social.models import Rating, RecipeTag, SavedRecipe, Tag

        cls.author = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password='n0t-a-real-password',
            role=User.Role.REGISTERED,
        )
        cls.fan = User.objects.create_user(
            username='eater',
            email='eater@example.com',
            password='n0t-a-real-password',
            role=User.Role.REGISTERED,
        )
        cls.other_fan = User.objects.create_user(
            username='second-eater',
            email='second@example.com',
            password='n0t-a-real-password',
            role=User.Role.REGISTERED,
        )
        cls.boss = User.objects.create_user(
            username='moderator',
            email='mod@example.com',
            password='n0t-a-real-password',
            role=User.Role.ADMIN,
        )

        def make(title, cuisine=None, difficulty=None, prep=None, cook=None,
                 description=None, tags=(), ingredients=(), views=0,
                 status_=Recipe.Status.PUBLISHED):
            recipe = Recipe.objects.create(
                user=cls.author,
                title=title,
                cuisine_type=cuisine,
                difficulty=difficulty,
                prep_time=prep,
                cook_time=cook,
                description=description,
                status=status_,
            )
            # .update() rather than assignment: view_count is maintained
            # server-side and this keeps the fixture from looking like a view.
            Recipe.objects.filter(pk=recipe.pk).update(view_count=views)
            for name in tags:
                RecipeTag.objects.create(
                    recipe=recipe,
                    tag=Tag.objects.get_or_create(name=name)[0],
                )
            for name in ingredients:
                RecipeIngredient.objects.create(
                    recipe=recipe,
                    ingredient=Ingredient.objects.get_or_create(name=name)[0],
                )
            recipe.refresh_from_db()
            return recipe

        cls.curry = make(
            'Tofu curry', 'Thai', 'easy', 10, 20,
            description='creamy and quick',
            tags=('vegan', 'gluten-free'), ingredients=('tofu', 'rice'),
            views=50,
        )
        cls.soup = make(
            'Lentil soup', 'Indian', 'easy', 15, 40,
            description='warming', tags=('vegan',),
            ingredients=('lentils',), views=10,
        )
        cls.cake = make(
            'Rice cake', 'Filipino', 'medium', 30, 60,
            tags=('gluten-free',), ingredients=('rice',), views=200,
        )
        cls.adobo = make(
            'Adobo', 'Filipino', 'hard', 20, 90,
            ingredients=('pork', 'vinegar'), views=5,
        )
        cls.feast = make(
            'Vegan feast', 'Fusion', 'easy', 10, 10,
            description='a vegan spread',
            tags=('vegan', 'vegan-friendly'), ingredients=('tofu',),
        )
        cls.draft = make(
            'Secret sinigang', 'Filipino', 'easy', 5, 10,
            tags=('vegan',), ingredients=('tofu',),
            status_=Recipe.Status.DRAFT,
        )

        Rating.objects.create(recipe=cls.curry, user=cls.fan, score=5)
        Rating.objects.create(recipe=cls.curry, user=cls.other_fan, score=3)
        Rating.objects.create(recipe=cls.soup, user=cls.fan, score=4)
        Rating.objects.create(recipe=cls.cake, user=cls.fan, score=1)
        SavedRecipe.objects.create(user=cls.fan, recipe=cls.curry)
        SavedRecipe.objects.create(user=cls.other_fan, recipe=cls.curry)
        SavedRecipe.objects.create(user=cls.fan, recipe=cls.cake)

    def browse(self, query='', user=None):
        """GET the list, returning (titles in order, reported count)."""
        if user is not None:
            self.client.force_authenticate(user)
        response = self.client.get(f'{RECIPES_URL}{query}')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        return (
            [row['title'] for row in response.data['results']],
            response.data['count'],
        )


class RecipeFilterTests(BrowseTestCase):
    def test_filter_by_cuisine(self):
        titles, _ = self.browse('?cuisine_type=Filipino')

        self.assertCountEqual(titles, ['Rice cake', 'Adobo'])

    def test_cuisine_is_case_insensitive(self):
        """cuisine_type is free text, so the filter normalises rather than
        relying on the database collation."""
        titles, _ = self.browse('?cuisine_type=filipino')

        self.assertCountEqual(titles, ['Rice cake', 'Adobo'])

    def test_filter_by_difficulty(self):
        titles, _ = self.browse('?difficulty=medium')

        self.assertEqual(titles, ['Rice cake'])

    def test_an_unknown_difficulty_is_refused(self):
        """A ChoiceFilter, so a typo is a 400 naming the valid values rather
        than an empty page that looks like "no such recipes"."""
        response = self.client.get(f'{RECIPES_URL}?difficulty=medum')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_filter_by_one_tag(self):
        titles, _ = self.browse('?tag=vegan')

        self.assertCountEqual(titles, ['Tofu curry', 'Lentil soup', 'Vegan feast'])

    def test_two_tags_mean_either_not_both(self):
        """OR, deliberately. This is the test that catches someone "fixing"
        the filter into AND."""
        titles, _ = self.browse('?tag=vegan&tag=gluten-free')

        self.assertCountEqual(
            titles,
            ['Tofu curry', 'Lentil soup', 'Vegan feast', 'Rice cake'],
        )

    def test_a_recipe_matching_only_one_of_two_tags_is_returned(self):
        """Rice cake has gluten-free and not vegan; it must still appear."""
        titles, _ = self.browse('?tag=vegan&tag=gluten-free')

        self.assertIn('Rice cake', titles)

    def test_a_recipe_matching_both_tags_is_returned_once(self):
        """The join fan-out case. The annotation's GROUP BY is what collapses
        it - see RecipeViewSet.get_queryset()."""
        titles, count = self.browse('?tag=vegan&tag=gluten-free')

        self.assertEqual(titles.count('Tofu curry'), 1)
        self.assertEqual(count, len(titles))

    def test_a_tag_is_matched_regardless_of_case(self):
        titles, _ = self.browse('?tag=VEGAN')

        self.assertIn('Tofu curry', titles)

    def test_an_unknown_tag_matches_nothing(self):
        titles, _ = self.browse('?tag=brunchy')

        self.assertEqual(titles, [])

    def test_filter_by_ingredient(self):
        titles, _ = self.browse('?ingredient=rice')

        self.assertCountEqual(titles, ['Tofu curry', 'Rice cake'])

    def test_two_ingredients_mean_either(self):
        titles, _ = self.browse('?ingredient=lentils&ingredient=pork')

        self.assertCountEqual(titles, ['Lentil soup', 'Adobo'])

    def test_different_filters_combine_with_and(self):
        titles, _ = self.browse('?tag=vegan&ingredient=rice')

        self.assertEqual(titles, ['Tofu curry'])

    def test_three_filters_combine(self):
        titles, _ = self.browse(
            '?tag=vegan&difficulty=easy&cuisine_type=Thai')

        self.assertEqual(titles, ['Tofu curry'])

    def test_combining_a_tag_and_an_ingredient_returns_one_row(self):
        """Two joined tables at once - the worst case for duplication."""
        titles, count = self.browse('?tag=vegan&tag=gluten-free'
                                    '&ingredient=tofu&ingredient=rice')

        self.assertEqual(titles.count('Tofu curry'), 1)
        self.assertEqual(count, len(titles))

    def test_filter_by_prep_time_range(self):
        self.assertCountEqual(
            self.browse('?prep_time_max=15')[0],
            ['Tofu curry', 'Lentil soup', 'Vegan feast'],
        )
        self.assertCountEqual(
            self.browse('?prep_time_min=30')[0],
            ['Rice cake'],
        )

    def test_filter_by_cook_time_range(self):
        titles, _ = self.browse('?cook_time_min=40&cook_time_max=60')

        self.assertCountEqual(titles, ['Lentil soup', 'Rice cake'])

    def test_no_filters_returns_everything_visible(self):
        titles, _ = self.browse()

        self.assertCountEqual(
            titles,
            ['Tofu curry', 'Lentil soup', 'Rice cake', 'Adobo', 'Vegan feast'],
        )


class RecipeSearchTests(BrowseTestCase):
    def test_search_matches_the_title(self):
        titles, _ = self.browse('?search=adobo')

        self.assertEqual(titles, ['Adobo'])

    def test_search_matches_the_description(self):
        titles, _ = self.browse('?search=warming')

        self.assertEqual(titles, ['Lentil soup'])

    def test_search_matches_the_cuisine(self):
        titles, _ = self.browse('?search=thai')

        self.assertEqual(titles, ['Tofu curry'])

    def test_search_finds_a_recipe_by_ingredient_name_alone(self):
        """"lentils" appears in no title, description or cuisine."""
        titles, _ = self.browse('?search=lentils')

        self.assertEqual(titles, ['Lentil soup'])

    def test_search_finds_a_recipe_by_tag_name_alone(self):
        """"gluten" appears in no title, description or cuisine either."""
        titles, _ = self.browse('?search=gluten')

        self.assertCountEqual(titles, ['Tofu curry', 'Rice cake'])

    def test_a_recipe_matching_through_a_tag_join_appears_once(self):
        """Search duplication is a separate hazard from filter duplication.

        "Vegan feast" matches on its title, on its description, and on two
        different tag rows - four join matches for one recipe. DRF's
        SearchFilter rewrites to base.filter(Exists(...)) to collapse that;
        this is the test that notices if it stops.
        """
        titles, count = self.browse('?search=vegan')

        self.assertEqual(titles.count('Vegan feast'), 1)
        self.assertEqual(count, len(titles))

    def test_search_and_filter_compose(self):
        titles, _ = self.browse('?search=vegan&difficulty=easy&cuisine_type=Fusion')

        self.assertEqual(titles, ['Vegan feast'])


class RecipeOrderingTests(BrowseTestCase):
    def test_default_order_is_newest_first(self):
        titles, _ = self.browse()

        self.assertEqual(titles[0], 'Secret sinigang'
                         if 'Secret sinigang' in titles else 'Vegan feast')

    def test_order_by_view_count(self):
        titles, _ = self.browse('?ordering=-view_count')

        self.assertEqual(titles[0], 'Rice cake')
        self.assertEqual(titles[-1], 'Vegan feast')

    def test_order_by_average_rating(self):
        response = self.client.get(f'{RECIPES_URL}?ordering=-avg_score')
        rows = response.data['results']

        self.assertEqual(rows[0]['avg_score'], 4.0)
        self.assertEqual(rows[2]['title'], 'Rice cake')

    def test_unrated_recipes_sort_last_by_rating(self):
        """MySQL sorts NULLs last on DESC, which is what "top rated" wants."""
        titles, _ = self.browse('?ordering=-avg_score')

        self.assertCountEqual(titles[-2:], ['Adobo', 'Vegan feast'])

    def test_order_by_save_count(self):
        titles, _ = self.browse('?ordering=-save_count')

        self.assertEqual(titles[0], 'Tofu curry')
        self.assertEqual(titles[1], 'Rice cake')

    def test_ordering_ascending_also_works(self):
        titles, _ = self.browse('?ordering=view_count')

        self.assertEqual(titles[0], 'Vegan feast')
        self.assertEqual(titles[-1], 'Rice cake')

    def test_the_annotated_queryset_is_still_ordered(self):
        """The regression guard.

        A GROUP BY discards the model's Meta.ordering - Django says so in
        QuerySet.ordered: "A default ordering doesn't affect GROUP BY queries".
        The annotation in get_queryset() introduces that GROUP BY, so the
        explicit .order_by() is the only thing ordering the list. Drop it and
        nothing else in this suite fails; pagination just quietly starts
        repeating and skipping rows.
        """
        view = RecipeViewSet()
        view.action = 'list'
        view.request = SimpleNamespace(user=self.author)

        queryset = view.get_queryset()
        order_by = str(queryset.query).upper().split('ORDER BY')

        self.assertTrue(queryset.ordered)
        self.assertEqual(len(order_by), 2, 'the queryset has no ORDER BY')
        # A unique tiebreaker, because created_at is not unique.
        self.assertIn('RECIPE_ID', order_by[1])

    def test_paging_the_list_raises_no_ordering_warning(self):
        """The same guard from the other end: DRF warns on an unordered page."""
        import warnings

        with warnings.catch_warnings():
            warnings.simplefilter('error')
            response = self.client.get(RECIPES_URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)


class BrowseVisibilityTests(BrowseTestCase):
    """Search and filter narrow what visible_recipes() allows; never widen it."""

    def test_a_guest_filtering_by_tag_does_not_see_drafts(self):
        titles, _ = self.browse('?tag=vegan')

        self.assertNotIn('Secret sinigang', titles)

    def test_a_guest_cannot_search_out_a_draft(self):
        titles, _ = self.browse('?search=sinigang')

        self.assertEqual(titles, [])

    def test_an_author_finds_their_own_draft(self):
        titles, _ = self.browse('?tag=vegan', user=self.author)

        self.assertIn('Secret sinigang', titles)

    def test_an_admin_finds_anybody_s_draft(self):
        titles, _ = self.browse('?search=sinigang', user=self.boss)

        self.assertEqual(titles, ['Secret sinigang'])

    def test_another_user_cannot_find_someone_elses_draft(self):
        titles, _ = self.browse('?search=sinigang', user=self.fan)

        self.assertEqual(titles, [])


class FilterSetInIsolationTests(BrowseTestCase):
    """What RecipeFilterSet does *without* the viewset's annotation.

    Documented behaviour rather than desired, and locked in here so the warning
    in recipes/filters.py cannot quietly become untrue. Anything that reuses
    this FilterSet has to annotate or call .distinct() itself.
    """

    def test_without_an_annotation_multi_value_filters_duplicate(self):
        bare = visible_recipes(self.author)

        filtered = RecipeFilterSet(
            data={'tag': ['vegan', 'gluten-free']},
            queryset=bare,
        ).qs

        self.assertEqual([r.title for r in filtered].count('Tofu curry'), 2)

    def test_with_an_annotation_they_do_not(self):
        annotated = visible_recipes(self.author).annotate(
            save_count=Count('saved_by', distinct=True),
        )

        filtered = RecipeFilterSet(
            data={'tag': ['vegan', 'gluten-free']},
            queryset=annotated,
        ).qs

        self.assertEqual([r.title for r in filtered].count('Tofu curry'), 1)


class AnnotatedFieldTests(BrowseTestCase):
    """avg_score and save_count are annotations, exposed through the serializer."""

    def test_the_values_reach_the_payload(self):
        response = self.client.get(f'{RECIPES_URL}{self.curry.pk}/')

        self.assertEqual(response.data['avg_score'], 4.0)
        self.assertEqual(response.data['save_count'], 2)

    def test_an_unrated_recipe_reports_null_and_zero(self):
        """None for the average, 0 for the count - "nobody rated it" is not a
        rating, but "nobody saved it" is a real count of zero."""
        response = self.client.get(f'{RECIPES_URL}{self.adobo.pk}/')

        self.assertIsNone(response.data['avg_score'])
        self.assertEqual(response.data['save_count'], 0)

    def test_reorder_steps_serialises_them_without_raising(self):
        """The refresh_from_db() path, end to end.

        reorder_steps() calls recipe.refresh_from_db() and then serialises the
        result. refresh_from_db() copies only concrete fields, so annotations
        set on the instance survive it and the real numbers come back - which
        is worth asserting precisely because an earlier version of the
        serializer's comment claimed they were lost.

        Either way this must not raise: a declared FloatField would have.
        """
        first = Step.objects.create(
            recipe=self.curry, step_number=1, instruction='Fry the tofu')
        second = Step.objects.create(
            recipe=self.curry, step_number=2, instruction='Simmer')
        self.client.force_authenticate(self.author)

        response = self.client.post(
            f'{RECIPES_URL}{self.curry.pk}/steps/reorder/',
            {'step_ids': [second.pk, first.pk]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['avg_score'], 4.0)
        self.assertEqual(response.data['save_count'], 2)
        self.assertEqual(
            [step['instruction'] for step in response.data['steps']],
            ['Simmer', 'Fry the tofu'],
        )

    def test_an_instance_that_never_carried_the_annotation_serialises_as_null(self):
        """Why the serializer uses getattr rather than a declared field.

        A recipe fetched outside the viewset's queryset - here a plain
        .get() - has no avg_score attribute at all. A declared FloatField
        raises AttributeError on it; the method field returns None.
        """
        plain = Recipe.objects.get(pk=self.curry.pk)

        data = RecipeListSerializer(plain).data

        self.assertIsNone(data['avg_score'])
        self.assertIsNone(data['save_count'])


class ReorderAfterDeletionTests(BrowseTestCase):
    """Reordering steps whose numbering has a gap in it.

    The gap is not an edge case: deleting a step leaves one on purpose, since
    nothing renumbers the survivors. So this is the ordinary sequence for
    anyone editing a recipe - remove a step, then move another - and it raised
    a 500 until the offset in reorder_steps() stopped being derived from the
    count of rows.
    """

    def setUp(self):
        self.client.force_authenticate(self.author)
        self.first = Step.objects.create(
            recipe=self.curry, step_number=1, instruction='Fry the tofu')
        self.second = Step.objects.create(
            recipe=self.curry, step_number=2, instruction='Simmer')
        self.third = Step.objects.create(
            recipe=self.curry, step_number=3, instruction='Serve')

    def reorder(self, step_ids):
        return self.client.post(
            f'{RECIPES_URL}{self.curry.pk}/steps/reorder/',
            {'step_ids': step_ids},
            format='json',
        )

    def test_reordering_after_a_deletion_does_not_collide(self):
        """The regression. Numbers are {1, 3}; a count-based offset of 2 sent
        1 -> 3 into the row still holding 3."""
        self.second.delete()

        response = self.reorder([self.third.pk, self.first.pk])

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            [step['instruction'] for step in response.data['steps']],
            ['Serve', 'Fry the tofu'],
        )

    def test_it_also_closes_the_gap(self):
        """Reordering renumbers from 1, which is what makes leaving gaps on
        delete acceptable: they do not accumulate forever."""
        self.second.delete()

        self.reorder([self.first.pk, self.third.pk])

        self.assertEqual(
            list(
                Step.objects.filter(recipe=self.curry)
                .order_by('step_number')
                .values_list('step_number', flat=True)
            ),
            [1, 2],
        )

    def test_contiguous_steps_still_reorder(self):
        """The case that always worked, kept so a fix to the gap cannot quietly
        break the ordinary path."""
        response = self.reorder([self.third.pk, self.second.pk, self.first.pk])

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            [step['instruction'] for step in response.data['steps']],
            ['Serve', 'Simmer', 'Fry the tofu'],
        )

    def test_a_single_step_reorders(self):
        """One step, offset 1: the shifted number must still clear the original."""
        self.second.delete()
        self.third.delete()

        response = self.reorder([self.first.pk])

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.first.refresh_from_db()
        self.assertEqual(self.first.step_number, 1)


class AuthorFilterTests(BrowseTestCase):
    """?user=<id> - one cook's recipes.

    Layered on visible_recipes() rather than replacing it, so who may see a
    draft is still decided in one place. That is what lets the same parameter
    serve both "my recipes", drafts included, and browsing somebody else's
    public collection.
    """

    def test_your_own_id_includes_your_drafts(self):
        self.client.force_authenticate(self.author)

        response = self.client.get(f'{RECIPES_URL}?user={self.author.pk}')

        titles = [r['title'] for r in response.data['results']]
        self.assertIn('Secret sinigang', titles)
        self.assertIn('Tofu curry', titles)

    def test_somebody_elses_id_hides_their_drafts(self):
        """The fan has no recipes, so asking for the author's as someone else
        must return the published ones and nothing more."""
        self.client.force_authenticate(self.fan)

        response = self.client.get(f'{RECIPES_URL}?user={self.author.pk}')

        titles = [r['title'] for r in response.data['results']]
        self.assertNotIn('Secret sinigang', titles)
        self.assertIn('Tofu curry', titles)

    def test_anonymous_callers_see_only_published(self):
        response = self.client.get(f'{RECIPES_URL}?user={self.author.pk}')

        titles = [r['title'] for r in response.data['results']]
        self.assertNotIn('Secret sinigang', titles)

    def test_an_id_with_no_recipes_returns_nothing(self):
        self.client.force_authenticate(self.author)

        response = self.client.get(f'{RECIPES_URL}?user={self.fan.pk}')

        self.assertEqual(response.data['results'], [])

    def test_it_combines_with_another_filter(self):
        """Different parameters are AND, the same as every other pair."""
        self.client.force_authenticate(self.author)

        response = self.client.get(
            f'{RECIPES_URL}?user={self.author.pk}&difficulty=easy'
        )

        titles = [r['title'] for r in response.data['results']]
        self.assertIn('Tofu curry', titles)
        self.assertNotIn('Adobo', titles)


class FeaturedRuleTests(RecipeTestCase):
    """A draft may not be featured, wherever the tick comes from."""

    def test_a_published_recipe_can_be_featured(self):
        self.recipe.status = Recipe.Status.PUBLISHED
        self.recipe.featured = True

        self.recipe.full_clean()  # must not raise

    def test_a_draft_cannot_be_featured(self):
        self.recipe.status = Recipe.Status.DRAFT
        self.recipe.featured = True

        with self.assertRaises(DjangoValidationError) as caught:
            self.recipe.full_clean()

        self.assertIn('featured', caught.exception.error_dict)

    def test_an_unfeatured_draft_is_fine(self):
        self.recipe.status = Recipe.Status.DRAFT
        self.recipe.featured = False

        self.recipe.full_clean()

    def test_save_does_not_enforce_it(self):
        """Documented, not desired: clean() is not called by .save(), so a
        fixture or a shell session can still write the pair. Worth pinning so
        nobody assumes the column is self-defending."""
        self.recipe.status = Recipe.Status.DRAFT
        self.recipe.featured = True
        self.recipe.save()

        self.recipe.refresh_from_db()
        self.assertTrue(self.recipe.featured)


class FeaturedApiTests(BrowseTestCase):
    """?featured=true, and what the API will and will not accept."""

    def setUp(self):
        self.curry.featured = True
        self.curry.save(update_fields=['featured'])

    def test_the_filter_narrows_to_featured(self):
        response = self.client.get(f'{RECIPES_URL}?featured=true')

        titles = [r['title'] for r in response.data['results']]
        self.assertEqual(titles, ['Tofu curry'])

    def test_featured_false_excludes_them(self):
        response = self.client.get(f'{RECIPES_URL}?featured=false')

        titles = [r['title'] for r in response.data['results']]
        self.assertNotIn('Tofu curry', titles)
        self.assertIn('Adobo', titles)

    def test_a_featured_draft_is_still_invisible_to_a_guest(self):
        """visible_recipes() decides first, so featuring cannot leak a draft
        even if one somehow carries the flag."""
        self.draft.featured = True
        self.draft.save(update_fields=['featured'])

        response = self.client.get(f'{RECIPES_URL}?featured=true')

        titles = [r['title'] for r in response.data['results']]
        self.assertNotIn('Secret sinigang', titles)

    def test_the_api_refuses_to_feature_a_draft(self):
        self.client.force_authenticate(self.author)

        response = self.client.patch(
            f'{RECIPES_URL}{self.draft.pk}/',
            {'featured': True},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('featured', response.data)

    def test_unpublishing_clears_the_feature(self):
        """The alternative - refusing the unpublish - is the wrong failure: an
        admin taking something out of public view needs that to work."""
        self.client.force_authenticate(self.author)

        response = self.client.post(f'{RECIPES_URL}{self.curry.pk}/unpublish/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.curry.refresh_from_db()
        self.assertEqual(self.curry.status, Recipe.Status.DRAFT)
        self.assertFalse(self.curry.featured)


class FeaturedAdminActionTests(TestCase):
    """The bulk actions, which never reach Recipe.clean() on their own."""

    @classmethod
    def setUpTestData(cls):
        cls.boss = User.objects.create_superuser(
            username='chief',
            email='chief@example.com',
            password='n0t-a-real-password',
        )
        cls.live = Recipe.objects.create(
            user=cls.boss, title='Live one', status=Recipe.Status.PUBLISHED)
        cls.draft = Recipe.objects.create(
            user=cls.boss, title='Draft one', status=Recipe.Status.DRAFT)

    def setUp(self):
        self.client.force_login(self.boss)

    def run_action(self, action, recipes):
        return self.client.post(
            reverse('admin:recipes_recipe_changelist'),
            {
                'action': action,
                '_selected_action': [str(r.pk) for r in recipes],
            },
            follow=True,
        )

    def test_featuring_a_published_recipe_works(self):
        self.run_action('feature_recipes', [self.live])

        self.live.refresh_from_db()
        self.assertTrue(self.live.featured)

    def test_featuring_a_draft_is_skipped_and_reported(self):
        response = self.run_action('feature_recipes', [self.draft])

        self.draft.refresh_from_db()
        self.assertFalse(self.draft.featured)
        self.assertContains(response, 'only a published recipe can be')

    def test_a_mixed_selection_features_what_it_can(self):
        """The reason the action loops instead of calling queryset.update():
        one bad row must not take the good ones with it, or silently pass."""
        self.run_action('feature_recipes', [self.live, self.draft])

        self.live.refresh_from_db()
        self.draft.refresh_from_db()
        self.assertTrue(self.live.featured)
        self.assertFalse(self.draft.featured)

    def test_unfeaturing(self):
        self.live.featured = True
        self.live.save(update_fields=['featured'])

        self.run_action('unfeature_recipes', [self.live])

        self.live.refresh_from_db()
        self.assertFalse(self.live.featured)


class RecipeTagsPayloadTests(BrowseTestCase):
    """Tag names on the list payload, and what keeps them affordable."""

    def test_tags_come_back_as_names(self):
        response = self.client.get(f'{RECIPES_URL}{self.curry.pk}/')

        self.assertEqual(response.data['tags'], ['gluten-free', 'vegan'])

    def test_they_are_sorted_not_in_insertion_order(self):
        """Two recipes carrying the same tags should render them the same way
        round, whatever order they happened to be applied in."""
        response = self.client.get(f'{RECIPES_URL}{self.feast.pk}/')

        self.assertEqual(
            response.data['tags'],
            sorted(response.data['tags']),
        )

    def test_an_untagged_recipe_reports_an_empty_list(self):
        """Empty, not null - "no tags" is a real answer and the client renders
        a list either way."""
        response = self.client.get(f'{RECIPES_URL}{self.adobo.pk}/')

        self.assertEqual(response.data['tags'], [])

    def test_the_list_carries_them_too(self):
        response = self.client.get(RECIPES_URL)

        by_title = {r['title']: r['tags'] for r in response.data['results']}
        self.assertEqual(by_title['Tofu curry'], ['gluten-free', 'vegan'])
        self.assertEqual(by_title['Adobo'], [])

    def test_more_recipes_do_not_cost_more_queries(self):
        """The prefetch is the point. get_tags scans loaded rows in Python
        precisely so one is enough; without it every recipe on the page costs
        a query of its own.
        """
        from social.models import RecipeTag, Tag

        # Six recipes at this point; eleven after the loop below. Both fit one
        # page - PAGE_SIZE is 20 and there is no page_size query parameter - so
        # what changes between the two measurements is only the row count.
        with CaptureQueriesContext(connection) as small:
            self.client.get(RECIPES_URL)

        spare = Tag.objects.create(name='weeknight')
        for index in range(5):
            extra = Recipe.objects.create(
                user=self.author,
                title=f'Filler {index}',
                status=Recipe.Status.PUBLISHED,
            )
            RecipeTag.objects.create(recipe=extra, tag=spare)

        with CaptureQueriesContext(connection) as bigger:
            self.client.get(RECIPES_URL)

        self.assertEqual(len(bigger), len(small))
