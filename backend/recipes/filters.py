"""Filters for the recipe list: cuisine, difficulty, tags, ingredients, times.

Wired into RecipeViewSet as filterset_class. Search and ordering live on the
viewset beside it; this file is only the field-by-field narrowing.

Nothing here imports from social, and it must stay that way. social already
imports recipes - social.models.Rating points at recipes.models.Recipe - so an
import in this direction would close the loop and break at startup. Reaching
social's tables by string field path instead costs nothing: Django resolves
`recipe_tags__tag__name` through the related_name at query time, not at import
time, so the two apps stay pointed one way.

Two decisions in here are worth reading before changing them.

`tag` and `ingredient` are OR, not AND. Passing two tags returns recipes
carrying *either*, which widens the result rather than narrowing it. One
`__in` lookup, not one chained .filter() per value.

Neither filter calls .distinct(), and that is deliberate - see the note on
RecipeViewSet.get_queryset(). The short version: the viewset annotates
aggregates onto every queryset, which puts a GROUP BY on the recipe's primary
key, and that already collapses the duplicate rows a join across tags or
ingredients would otherwise produce. django_filter's MultipleChoiceFilter
defaults `distinct=True` for exactly this hazard; NameInFilter turns it back
off because the hazard is already handled one layer up, and a redundant
DISTINCT costs a pass over every listing.

*** This FilterSet is therefore NOT self-contained. ***

Applied to a queryset that has no aggregate annotation on it, a multi-value
`tag` or `ingredient` filter returns one row per matching join row - a recipe
carrying both "vegan" and "gluten-free" comes back twice from
?tag=vegan&tag=gluten-free. Measured, not theorised:

    bare queryset       -> 2 rows, no GROUP BY
    annotated queryset  -> 1 row,  GROUP BY Recipe.recipe_id

RecipeViewSet.get_queryset() annotates unconditionally, so the listing endpoint
is correct. Anything else that reuses this FilterSet - a new viewset, an export
command, a report - has to either annotate an aggregate onto its queryset or
call .distinct() itself. It will not get deduplication for free.
"""

from django_filters import rest_framework as filters
from django_filters.fields import MultipleChoiceField

from .models import Recipe


def _normalise_name(value):
    """Match what the lookup tables do to a name before storing it.

    Ingredient.save() and social.Tag.save() both strip and lowercase, so every
    stored name is already lowercase. Normalising the query the same way is
    what lets the lookup below be a plain `__in` - which has no
    case-insensitive form - and still match "VEGAN" against the stored "vegan".

    This is a real coupling to those two save() methods. If either stops
    normalising, searches by name start missing rows and nothing here will say
    so.
    """
    return value.strip().lower()


class _AnyValueMultipleChoiceField(MultipleChoiceField):
    """A multi-value field that accepts values not drawn from a choice list.

    MultipleChoiceField exists to validate against fixed choices. Tags and
    ingredients are rows in a table, and enumerating them would mean either a
    query per request or an import of social.Tag - so this accepts whatever
    arrives and lets the filter return nothing for a name that does not exist.

    A typo therefore yields an empty result rather than a 400. That is the
    right trade here: the alternative reports "vegn is not a valid choice",
    which is only useful if the client could have known the list.
    """

    def valid_value(self, value):
        return True


class NameInFilter(filters.MultipleChoiceFilter):
    """Repeatable name filter with OR semantics: ?tag=vegan&tag=gluten-free.

    Inherits from MultipleChoiceFilter for its repeatable-parameter handling
    and replaces the filtering itself - the base class ORs one Q per value,
    which a single `__in` does in one clause.

    Returns duplicate rows on its own. Two values means two matching join rows
    for a recipe carrying both, and nothing here collapses them - the caller's
    queryset has to, by annotating an aggregate or calling .distinct(). See the
    warning in the module docstring; this is the filter it is about.
    """

    field_class = _AnyValueMultipleChoiceField

    def __init__(self, *args, **kwargs):
        # MultipleChoiceFilter defaults this to True. Turned off because
        # filter() below never consults it and because the deduplication
        # happens in the viewset's annotation - see the module docstring.
        kwargs.setdefault('distinct', False)
        super().__init__(*args, **kwargs)

    def filter(self, qs, value):
        names = [
            _normalise_name(item)
            for item in (value or [])
            if item and item.strip()
        ]

        if not names:
            return qs

        return qs.filter(**{f'{self.field_name}__in': names})


class RecipeFilterSet(filters.FilterSet):
    """Narrowing for GET /api/recipes/.

        ?cuisine_type=filipino
        ?difficulty=easy
        ?tag=vegan&tag=gluten-free          either tag
        ?ingredient=tofu&ingredient=rice    either ingredient
        ?prep_time_max=20&cook_time_max=30
        ?user=3                            one cook's recipes
        ?featured=true                     the curated panel

    Different parameters combine with AND - ?tag=vegan&cuisine_type=thai means
    both - while repeated values of the *same* parameter are OR.

    There is deliberately no `status` filter. Which recipes a caller may see is
    decided by recipes.views.visible_recipes() before any of this runs, and
    offering the field would suggest a client can ask for drafts.
    """

    cuisine_type = filters.CharFilter(lookup_expr='iexact')

    # A ChoiceFilter rather than a plain exact match, so `?difficulty=medum`
    # answers 400 naming the three valid values instead of silently returning
    # an empty page. Worth it here, unlike for tags, because the choices are
    # fixed and the client can act on the message.
    difficulty = filters.ChoiceFilter(choices=Recipe.Difficulty.choices)

    tag = NameInFilter(field_name='recipe_tags__tag__name')
    ingredient = NameInFilter(field_name='recipe_ingredients__ingredient__name')

    # Whose recipes these are. Combines with visible_recipes() rather than
    # competing with it: asking for your own id returns your drafts too,
    # because that queryset already allowed them, while asking for somebody
    # else's returns only what they have published. One filter therefore serves
    # both "my recipes" and viewing another cook's public collection.
    user = filters.NumberFilter(field_name='user__user_id')

    # Curated, not measured - see Recipe.featured. A BooleanFilter rather than
    # an exact match so ?featured=true reads the way a URL is written.
    featured = filters.BooleanFilter()

    prep_time_min = filters.NumberFilter(
        field_name='prep_time',
        lookup_expr='gte',
    )
    prep_time_max = filters.NumberFilter(
        field_name='prep_time',
        lookup_expr='lte',
    )
    cook_time_min = filters.NumberFilter(
        field_name='cook_time',
        lookup_expr='gte',
    )
    cook_time_max = filters.NumberFilter(
        field_name='cook_time',
        lookup_expr='lte',
    )

    class Meta:
        model = Recipe
        # Empty on purpose: every filter above is declared explicitly, because
        # each one either renames the query parameter, crosses into another
        # app, or changes the lookup. Generating any of them from field names
        # would hide that.
        fields = []
