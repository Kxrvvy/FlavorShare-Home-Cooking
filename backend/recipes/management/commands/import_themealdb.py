"""Seed the catalogue from TheMealDB (https://www.themealdb.com/api.php).

`filter.php?c=<category>` is the closest thing TheMealDB has to "list
everything" - there is no unfiltered list endpoint - so this walks the
category list and looks each meal up individually for full detail. `--limit`
caps the whole run, not each category, so it stops as soon as it has enough
rather than finishing a category first.

Idempotent per meal: Recipe.source/external_id carries a unique constraint
(see recipes/models.py) precisely so re-running this updates the row TheMealDB's
id already produced instead of creating a second one. Steps, ingredients and
the cover image are replaced wholesale on every run rather than diffed against
what is already there - TheMealDB has no "last modified" signal to diff
against, and the recipe is never edited here between runs, so there is nothing
a merge would preserve that a replace does not.

Ownership, tags and moderation are deliberately not this command's job:
recipes.sources.service_account() gives every imported row the same author,
and nothing here assigns a Tag - TheMealDB's own categories (Beef,
Vegetarian, Seafood, ...) do not line up with the fixed tag list in
frontend/lib/categories.ts, and guessing the mapping risks mislabelling a
recipe (Vegetarian is not Vegan) rather than just leaving it untagged.
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

import requests

from recipes.models import Image, Ingredient, Recipe, RecipeIngredient, Step
from recipes.sources import THEMEALDB, service_account

BASE_URL = 'https://www.themealdb.com/api/json/v1/{key}/'

# How many ingredient/measure column pairs a TheMealDB meal object carries.
# Fixed by their API shape, not configurable.
MAX_INGREDIENTS = 20


class Command(BaseCommand):
    help = "Import recipes from TheMealDB into the catalogue."

    def add_arguments(self, parser):
        parser.add_argument(
            '--limit',
            type=int,
            default=50,
            help='Maximum number of recipes to import in this run (default: 50).',
        )
        parser.add_argument(
            '--category',
            action='append',
            dest='categories',
            help=(
                'A TheMealDB category to pull from (e.g. "Vegetarian"). '
                'May be passed more than once. Default: every category '
                'TheMealDB lists.'
            ),
        )

    def handle(self, *args, **options):
        limit = options['limit']
        if limit <= 0:
            raise CommandError('--limit must be a positive number.')

        session = requests.Session()
        base_url = BASE_URL.format(key=settings.THEMEALDB_API_KEY)

        categories = options['categories'] or self._fetch_categories(session, base_url)
        owner = service_account(THEMEALDB)

        imported = 0
        for category in categories:
            if imported >= limit:
                break

            for meal_id in self._fetch_meal_ids(session, base_url, category):
                if imported >= limit:
                    break

                meal = self._fetch_meal(session, base_url, meal_id)
                if meal is None:
                    continue

                _import_meal(meal, owner)
                imported += 1
                self.stdout.write(f"Imported: {meal['strMeal']} ({meal_id})")

        self.stdout.write(self.style.SUCCESS(f'Done. Imported {imported} recipe(s).'))

    def _fetch_categories(self, session, base_url):
        data = session.get(f'{base_url}categories.php', timeout=10).json()
        return [row['strCategory'] for row in data.get('categories') or []]

    def _fetch_meal_ids(self, session, base_url, category):
        data = session.get(
            f'{base_url}filter.php', params={'c': category}, timeout=10
        ).json()
        return [row['idMeal'] for row in data.get('meals') or []]

    def _fetch_meal(self, session, base_url, meal_id):
        data = session.get(
            f'{base_url}lookup.php', params={'i': meal_id}, timeout=10
        ).json()
        meals = data.get('meals') or []
        return meals[0] if meals else None


def _import_meal(meal, owner):
    """Create or update the one Recipe TheMealDB's id maps to, in place."""
    with transaction.atomic():
        recipe, _ = Recipe.objects.update_or_create(
            source=THEMEALDB,
            external_id=meal['idMeal'],
            defaults={
                'user': owner,
                'title': meal['strMeal'],
                'cuisine_type': meal.get('strArea') or None,
                'status': Recipe.Status.PUBLISHED,
                'source_url': meal.get('strSource') or meal.get('strYoutube') or None,
            },
        )

        recipe.steps.all().delete()
        for number, instruction in enumerate(_split_instructions(meal), start=1):
            Step.objects.create(
                recipe=recipe, step_number=number, instruction=instruction
            )

        recipe.recipe_ingredients.all().delete()
        for name, measure in _ingredients(meal).items():
            ingredient, _ = Ingredient.objects.get_or_create(name=name)
            RecipeIngredient.objects.create(
                recipe=recipe,
                ingredient=ingredient,
                # The measure text ("1 1/2 cups", "a pinch") is not split into
                # quantity/unit - TheMealDB's format is too irregular to parse
                # reliably, and a wrong split is worse than plain text.
                notes=(measure or None),
            )

        recipe.images.filter(type=Image.Type.FINAL).delete()
        thumbnail = meal.get('strMealThumb')
        if thumbnail:
            Image.objects.create(
                recipe=recipe,
                uploaded_by=owner,
                url=thumbnail,
                type=Image.Type.FINAL,
            )

        return recipe


def _split_instructions(meal):
    """TheMealDB's instructions as an ordered list of non-empty steps."""
    raw = meal.get('strInstructions') or ''
    lines = [line.strip() for line in raw.splitlines()]
    return [line for line in lines if line]


def _ingredients(meal):
    """{normalised ingredient name: measure text} for this meal's columns.

    A dict, not a list: TheMealDB occasionally repeats an ingredient across
    two of its twenty columns, and RecipeIngredient has one row per
    (recipe, ingredient) - collapsing here keeps the later measure rather than
    letting the second one collide against the unique constraint.
    """
    result = {}
    for i in range(1, MAX_INGREDIENTS + 1):
        name = (meal.get(f'strIngredient{i}') or '').strip()
        if not name:
            continue
        measure = (meal.get(f'strMeasure{i}') or '').strip()
        result[name.lower()] = measure
    return result
