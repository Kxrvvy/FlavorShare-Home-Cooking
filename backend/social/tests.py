"""Tests for the social app: ratings, comments, tags and saved recipes.

The breadth pass, so this is deliberately not the coverage recipes/tests.py
has. It is weighted toward the rules that would fail silently if they broke:

- the two ownership rules, which differ per model and are easy to conflate -
  a rating belongs to whoever wrote it, a tag belongs to the recipe's author;
- the visibility rule, where a leak means one user reading another's unpublished
  draft through a side door;
- the uniqueness rules, which DRF does not enforce on its own here (see the
  note in serializers.py) and would otherwise surface as a 500;
- the on_delete choices, which are what keep a deactivated user's reviews.

Left for the depth pass: search and filter combinations, pagination edges,
every field-level validation message, and the admin beyond a smoke test.
"""

from django.contrib.auth import get_user_model
from django.db.models import ProtectedError
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from recipes.models import Recipe

from .models import Comment, Rating, RecipeTag, SavedRecipe, Tag

User = get_user_model()

RATINGS_URL = '/api/social/ratings/'
COMMENTS_URL = '/api/social/comments/'
RECIPE_TAGS_URL = '/api/social/recipe-tags/'
TAGS_URL = '/api/social/tags/'
SAVED_URL = '/api/social/saved/'


class SocialTestCase(APITestCase):
    """An author with one published recipe and one draft, plus two onlookers.

    `reader` is a plain registered user and `boss` an admin, because most of
    the rules below are about which of the three a request is coming from.
    """

    @classmethod
    def setUpTestData(cls):
        cls.author = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password='n0t-a-real-password',
            role=User.Role.REGISTERED,
        )
        cls.reader = User.objects.create_user(
            username='eater',
            email='eater@example.com',
            password='n0t-a-real-password',
            role=User.Role.REGISTERED,
        )
        cls.boss = User.objects.create_user(
            username='moderator',
            email='mod@example.com',
            password='n0t-a-real-password',
            role=User.Role.ADMIN,
        )
        cls.recipe = Recipe.objects.create(
            user=cls.author,
            title='Adobo',
            status=Recipe.Status.PUBLISHED,
        )
        cls.draft = Recipe.objects.create(
            user=cls.author,
            title='Half-written sinigang',
            status=Recipe.Status.DRAFT,
        )


class RatingApiTests(SocialTestCase):
    def test_guests_may_read_ratings(self):
        """Guest Users browse and view ratings - that is the role's point."""
        self.assertEqual(
            self.client.get(RATINGS_URL).status_code,
            status.HTTP_200_OK,
        )

    def test_guests_may_not_rate(self):
        response = self.client.post(
            RATINGS_URL,
            {'recipe': self.recipe.pk, 'score': 4},
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_registered_user_may_rate_someone_elses_recipe(self):
        self.client.force_authenticate(self.reader)
        response = self.client.post(
            RATINGS_URL,
            {'recipe': self.recipe.pk, 'score': 4},
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        # The rater comes from the credential, never from the payload.
        self.assertEqual(Rating.objects.get().user, self.reader)

    def test_the_uploader_cannot_be_spoofed(self):
        """`user` is read-only, so naming someone else changes nothing."""
        self.client.force_authenticate(self.reader)
        self.client.post(
            RATINGS_URL,
            {'recipe': self.recipe.pk, 'score': 4, 'user': self.author.pk},
        )

        self.assertEqual(Rating.objects.get().user, self.reader)

    def test_a_second_rating_from_the_same_user_is_refused(self):
        """One score per person per recipe, or an average can be stacked."""
        self.client.force_authenticate(self.reader)
        payload = {'recipe': self.recipe.pk, 'score': 4}
        self.client.post(RATINGS_URL, payload)

        response = self.client.post(RATINGS_URL, {**payload, 'score': 1})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('score', response.data)
        self.assertEqual(Rating.objects.count(), 1)

    def test_changing_your_mind_is_a_patch(self):
        self.client.force_authenticate(self.reader)
        rating = Rating.objects.create(
            recipe=self.recipe,
            user=self.reader,
            score=2,
        )

        response = self.client.patch(
            f'{RATINGS_URL}{rating.pk}/',
            {'score': 5},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        rating.refresh_from_db()
        self.assertEqual(rating.score, 5)

    def test_an_author_may_not_rate_their_own_recipe(self):
        """Mirrors view_count skipping the author: not feedback."""
        self.client.force_authenticate(self.author)
        response = self.client.post(
            RATINGS_URL,
            {'recipe': self.recipe.pk, 'score': 5},
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Rating.objects.exists())

    def test_scores_outside_one_to_five_are_refused(self):
        self.client.force_authenticate(self.reader)

        for score in (0, 6):
            with self.subTest(score=score):
                response = self.client.post(
                    RATINGS_URL,
                    {'recipe': self.recipe.pk, 'score': score},
                )
                self.assertEqual(
                    response.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )

        self.assertFalse(Rating.objects.exists())

    def test_a_user_may_not_edit_someone_elses_rating(self):
        rating = Rating.objects.create(
            recipe=self.recipe,
            user=self.reader,
            score=2,
        )
        self.client.force_authenticate(self.author)

        response = self.client.patch(
            f'{RATINGS_URL}{rating.pk}/',
            {'score': 5},
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class VisibilityTests(SocialTestCase):
    """The rule that matters most: a draft's rows stay with the draft."""

    def test_rating_a_recipe_you_cannot_see_is_refused(self):
        self.client.force_authenticate(self.reader)

        response = self.client.post(
            RATINGS_URL,
            {'recipe': self.draft.pk, 'score': 5},
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        # A 403 would confirm the hidden recipe exists; the error names the
        # field instead and says nothing about why.
        self.assertIn('recipe', response.data)
        self.assertFalse(Rating.objects.exists())

    def test_rows_on_a_hidden_draft_are_not_listed(self):
        """Visibility follows the recipe, not the row's own author.

        Written straight to the database because the API refuses to create it -
        which is the point: even a row that got there another way stays hidden.
        """
        Rating.objects.create(recipe=self.draft, user=self.reader, score=5)

        self.assertEqual(self.client.get(RATINGS_URL).data['count'], 0)

        # Not even the person who wrote it, while it hangs off a draft they
        # cannot read.
        self.client.force_authenticate(self.reader)
        self.assertEqual(self.client.get(RATINGS_URL).data['count'], 0)

        # Its author sees it, and so would an admin.
        self.client.force_authenticate(self.author)
        self.assertEqual(self.client.get(RATINGS_URL).data['count'], 1)


class CommentApiTests(SocialTestCase):
    def test_an_author_may_comment_on_their_own_recipe(self):
        """Unlike rating: answering a question on your own recipe is normal."""
        self.client.force_authenticate(self.author)
        response = self.client.post(
            COMMENTS_URL,
            {'recipe': self.recipe.pk, 'content': 'Use more vinegar.'},
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_several_comments_from_one_person_are_allowed(self):
        self.client.force_authenticate(self.reader)
        for content in ('First thought.', 'Second thought.'):
            self.client.post(
                COMMENTS_URL,
                {'recipe': self.recipe.pk, 'content': content},
            )

        self.assertEqual(Comment.objects.count(), 2)

    def test_a_user_may_not_delete_someone_elses_comment(self):
        comment = Comment.objects.create(
            recipe=self.recipe,
            user=self.author,
            content='Mine.',
        )
        self.client.force_authenticate(self.reader)

        response = self.client.delete(f'{COMMENTS_URL}{comment.pk}/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Comment.objects.filter(pk=comment.pk).exists())

    def test_an_admin_may_delete_any_comment(self):
        """The moderation path: remove an inappropriate review."""
        comment = Comment.objects.create(
            recipe=self.recipe,
            user=self.author,
            content='Something to take down.',
        )
        self.client.force_authenticate(self.boss)

        response = self.client.delete(f'{COMMENTS_URL}{comment.pk}/')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Comment.objects.exists())


class TagApiTests(SocialTestCase):
    def test_tagging_finds_or_creates_the_shared_row(self):
        self.client.force_authenticate(self.author)
        response = self.client.post(
            RECIPE_TAGS_URL,
            {'recipe': self.recipe.pk, 'tag_name': '  VEGAN '},
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Tag.objects.get().name, 'vegan')
        self.assertEqual(response.data['tag']['name'], 'vegan')

    def test_a_differently_cased_tag_reuses_the_same_row(self):
        """The reason Tag.save() normalises: one row, not three."""
        second = Recipe.objects.create(
            user=self.author,
            title='Another',
            status=Recipe.Status.PUBLISHED,
        )
        self.client.force_authenticate(self.author)

        self.client.post(
            RECIPE_TAGS_URL,
            {'recipe': self.recipe.pk, 'tag_name': 'Vegan'},
        )
        self.client.post(
            RECIPE_TAGS_URL,
            {'recipe': second.pk, 'tag_name': 'vegan'},
        )

        self.assertEqual(Tag.objects.count(), 1)
        self.assertEqual(RecipeTag.objects.count(), 2)

    def test_the_same_tag_twice_on_one_recipe_is_refused(self):
        self.client.force_authenticate(self.author)
        payload = {'recipe': self.recipe.pk, 'tag_name': 'vegan'}
        self.client.post(RECIPE_TAGS_URL, payload)

        response = self.client.post(RECIPE_TAGS_URL, payload)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('tag_name', response.data)
        self.assertEqual(RecipeTag.objects.count(), 1)

    def test_only_the_recipes_author_may_tag_it(self):
        """A tag has no author of its own, so the recipe's author owns it.

        This is the rule most easily got wrong: a reader may rate the recipe
        but must not be able to tag it.
        """
        self.client.force_authenticate(self.reader)

        response = self.client.post(
            RECIPE_TAGS_URL,
            {'recipe': self.recipe.pk, 'tag_name': 'vegan'},
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(RecipeTag.objects.exists())

    def test_the_tag_lookup_table_is_read_only(self):
        """Rows appear by tagging a recipe; a create route makes orphans."""
        self.client.force_authenticate(self.author)

        response = self.client.post(TAGS_URL, {'name': 'vegan'})

        self.assertEqual(
            response.status_code,
            status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def test_guests_may_read_the_tag_lookup_table(self):
        self.assertEqual(
            self.client.get(TAGS_URL).status_code,
            status.HTTP_200_OK,
        )


class SavedRecipeApiTests(SocialTestCase):
    def test_guests_may_not_list_saved_recipes(self):
        """IsRegisteredUser, not *OrReadOnly: reads are private too."""
        self.assertEqual(
            self.client.get(SAVED_URL).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_a_collection_shows_only_your_own_saves(self):
        SavedRecipe.objects.create(user=self.reader, recipe=self.recipe)
        self.client.force_authenticate(self.author)

        self.assertEqual(self.client.get(SAVED_URL).data['count'], 0)

        self.client.force_authenticate(self.reader)
        self.assertEqual(self.client.get(SAVED_URL).data['count'], 1)

    def test_someone_elses_saved_row_is_a_404_not_a_403(self):
        """Scoping, not a permission class, is what hides the row."""
        saved = SavedRecipe.objects.create(
            user=self.reader,
            recipe=self.recipe,
        )
        self.client.force_authenticate(self.author)

        response = self.client.get(f'{SAVED_URL}{saved.pk}/')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_saving_the_same_recipe_twice_is_refused(self):
        self.client.force_authenticate(self.reader)
        self.client.post(SAVED_URL, {'recipe': self.recipe.pk})

        response = self.client.post(SAVED_URL, {'recipe': self.recipe.pk})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(SavedRecipe.objects.count(), 1)

    def test_saving_a_recipe_you_cannot_see_is_refused(self):
        self.client.force_authenticate(self.reader)

        response = self.client.post(SAVED_URL, {'recipe': self.draft.pk})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(SavedRecipe.objects.exists())


class DeletionTests(TestCase):
    """The on_delete choices, which are invisible until they are wrong."""

    @classmethod
    def setUpTestData(cls):
        cls.author = User.objects.create_user(
            username='cook',
            email='cook@example.com',
            password='n0t-a-real-password',
        )
        cls.reader = User.objects.create_user(
            username='eater',
            email='eater@example.com',
            password='n0t-a-real-password',
        )
        cls.recipe = Recipe.objects.create(user=cls.author, title='Adobo')

    def test_deleting_a_rater_is_refused(self):
        """PROTECT: removing a user is a deactivation, so reviews survive."""
        Rating.objects.create(recipe=self.recipe, user=self.reader, score=4)

        with self.assertRaises(ProtectedError):
            self.reader.delete()

        self.assertEqual(Rating.objects.count(), 1)

    def test_deleting_a_commenter_is_refused(self):
        Comment.objects.create(
            recipe=self.recipe,
            user=self.reader,
            content='Tasty.',
        )

        with self.assertRaises(ProtectedError):
            self.reader.delete()

    def test_deleting_a_recipe_takes_its_social_rows_with_it(self):
        """CASCADE the other way: a rating with no recipe describes nothing."""
        Rating.objects.create(recipe=self.recipe, user=self.reader, score=4)
        Comment.objects.create(
            recipe=self.recipe,
            user=self.reader,
            content='Tasty.',
        )
        SavedRecipe.objects.create(user=self.reader, recipe=self.recipe)

        self.recipe.delete()

        self.assertFalse(Rating.objects.exists())
        self.assertFalse(Comment.objects.exists())
        self.assertFalse(SavedRecipe.objects.exists())

    def test_deleting_a_tag_in_use_is_refused(self):
        """PROTECT, so removing "vegan" cannot silently untag every recipe."""
        tag = Tag.objects.create(name='vegan')
        RecipeTag.objects.create(recipe=self.recipe, tag=tag)

        with self.assertRaises(ProtectedError):
            tag.delete()
