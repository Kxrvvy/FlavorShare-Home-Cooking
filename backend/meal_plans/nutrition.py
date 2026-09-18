"""Nutrition lookups from Edamam's Recipe Analysis API.

https://developer.edamam.com/edamam-nutrition-api

Chosen over Spoonacular/USDA FoodData Central/CalorieNinjas for the shape of
what this project already stores: RecipeIngredient rows are free-typed name +
quantity + unit (see recipes/models.py), never matched against a fixed food
database, and this is the one option of the four that takes exactly that - a
title plus a list of plain-English lines like "2 cup rice" - and returns
macros for the whole recipe in one call. The alternatives all need each
ingredient resolved to a specific food id first, which this project's data
was never structured to provide.

Modelled on accounts/emails.py, which solves the same shape of problem:
credentials are checked before any request is made, and a missing one raises
NutritionNotConfigured rather than failing somewhere inside the request.
Translating that to a status code is the view's job, not this module's - kept
out so a future management command could call fetch_nutrition() the same way.
"""

from django.conf import settings

import requests

RECIPE_ANALYSIS_URL = 'https://api.edamam.com/api/nutrition-details'

#: Edamam's own field names for the four macros this project stores.
#: https://www.edamam.com/dev/tools/nutrient-mapping-info
NUTRIENT_CODES = {
    'protein': 'PROCNT',
    'carbs': 'CHOCDF',
    'fat': 'FAT',
}


class NutritionNotConfigured(Exception):
    """EDAMAM_APP_ID or EDAMAM_APP_KEY is missing.

    A deployment problem, not a caller's mistake - the view answers 503.
    """


class NutritionLookupFailed(Exception):
    """Edamam was reachable and refused or could not use the request, or the
    request never reached it at all.

    Their problem, our ingredient data's, or the network's - never the
    caller's - the view answers 502 either way.
    """


def _ingredient_lines(recipe):
    """This recipe's ingredients as the plain-English lines Edamam expects.

    RecipeIngredient.quantity and .unit are both nullable - a free-typed
    amount like "a pinch" has nowhere else to go, see recipes/models.py's own
    note on RecipeIngredient.notes - so a missing quantity falls back to "1"
    rather than leaving Edamam a line with no amount at all, which it cannot
    parse into a food match.
    """
    lines = []
    for row in recipe.recipe_ingredients.select_related('ingredient'):
        quantity = row.quantity if row.quantity is not None else 1
        unit = row.unit or ''
        line = ' '.join(part for part in (str(quantity), unit, row.ingredient.name) if part)
        lines.append(line)
    return lines


def fetch_nutrition(recipe):
    """Ask Edamam for this recipe's nutrition, or raise.

    Returns a dict with whichever of calories/protein/carbs/fat the response
    actually carries. A line Edamam cannot parse is silently dropped from its
    own total rather than failing the whole request - `ignoredIngredients` in
    the response would say which, but nothing here surfaces that; a partial
    total beats none; failing loudly is what NutritionLookupFailed is for.
    """
    app_id = settings.EDAMAM_APP_ID
    app_key = settings.EDAMAM_APP_KEY

    if not app_id or not app_key:
        raise NutritionNotConfigured(
            'Nutrition lookups are not configured on this server. Set '
            'EDAMAM_APP_ID and EDAMAM_APP_KEY - see README.md.'
        )

    lines = _ingredient_lines(recipe)
    if not lines:
        raise NutritionLookupFailed(
            'This recipe has no ingredients yet, so there is nothing to look up.'
        )

    try:
        response = requests.post(
            RECIPE_ANALYSIS_URL,
            params={'app_id': app_id, 'app_key': app_key},
            json={'title': recipe.title, 'ingr': lines},
            timeout=15,
        )
    except requests.RequestException as exc:
        raise NutritionLookupFailed(f'Could not reach Edamam: {exc}') from exc

    if not response.ok:
        raise NutritionLookupFailed(
            f'Edamam refused the request (HTTP {response.status_code}): {response.text}'
        )

    payload = response.json()
    nutrients = payload.get('totalNutrients') or {}

    def macro(code):
        value = nutrients.get(code, {}).get('quantity')
        return round(value, 2) if value is not None else None

    calories = payload.get('calories')

    return {
        'calories': round(calories, 2) if calories is not None else None,
        **{field: macro(code) for field, code in NUTRIENT_CODES.items()},
    }
