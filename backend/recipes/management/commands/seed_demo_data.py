"""Demo reviewer activity on top of the TheMealDB import.

Recipe.featured and a spread of ratings/reviews turn a bare import into
something that actually demonstrates Ratings & Reviews, the card meta
line's community-signal fallback (lib/format.ts's formatRecipeMeta on the
frontend), and the homepage's Featured Recipes panel - none of which have
anything to show against an empty catalogue.

Keyed by (source, external_id) - TheMealDB's own meal id - rather than by
local recipe_id, on purpose. recipe_id is assigned by each database's own
auto-increment sequence, so it differs between machines even for the exact
same imported catalogue; external_id is the one thing every copy of this
data agrees on. That is what lets a groupmate run this against their own
fresh import and get the same demo state import_themealdb's own run order
happened to produce here.

Safe to run more than once: Rating is update_or_create (the model allows
only one per user per recipe anyway), Comment's get_or_create matches on
the exact content already seeded, and .update(featured=True) is naturally
idempotent.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.core.management import call_command
from django.core.management.base import BaseCommand

from recipes.models import Recipe
from recipes.sources import THEMEALDB
from social.models import Comment, Rating, RecipeTag, Tag

# Five distinct personas rather than one account rating everything - a
# single reviewer leaving a dozen reviews reads as fake in a way five
# people each leaving two or three does not.
REVIEWERS = [
    "home_cook_amara",
    "weeknight_marco",
    "kevin_grills",
    "lola_ren",
    "priya_tries_it",
]

# (TheMealDB external_id, reviewer, score, review) - a deliberate subset of
# the 24-recipe import, not all of it. Leaving half genuinely unrated is
# what keeps the "nothing yet" case honest instead of everything having
# been reviewed, which would look as templated as a fabricated number.
SEED = [
    ("53281", "home_cook_amara", 5, "Made these for a dinner party and they disappeared in minutes. The spice mix is spot on - didn't change a thing."),
    ("53133", "kevin_grills", 4, "Took longer over the coals than the recipe suggests, but worth the wait. Great weekend project."),
    ("53099", "weeknight_marco", 4, "The beetroot really does make the difference. My kids side-eyed it before eating two each."),
    ("53366", "priya_tries_it", 5, "Faster than delivery and tastes better. Doubled the sauce, no regrets."),
    ("52878", "lola_ren", 3, "Good flavor but my pastry went soggy on the bottom. Might blind-bake the base next time."),
    ("52904", "home_cook_amara", 5, "Classic for a reason. Let it sit overnight before serving - the flavor deepens a lot."),
    ("53070", "lola_ren", 5, "Tastes just like my lola's version. The liver spread is not optional, don't skip it."),
    ("52952", "weeknight_marco", 4, "Solid weeknight recipe. I added extra garlic because more garlic is always correct."),
    ("53068", "kevin_grills", 4, "Comforting and easy to scale up. Froze half and it reheated perfectly."),
    ("53238", "priya_tries_it", 5, "The broth needs the full simmer time, don't rush it. Best pho I've made at home."),
    ("53053", "home_cook_amara", 5, "Low and slow really pays off here. The coconut milk reduces down to something incredible."),
    ("52834", "weeknight_marco", 3, "Decent base recipe but a bit bland as written - I added extra paprika and a splash of brandy."),
]

# Beef Bourguignon, Beef Rendang - both already 5-star above. Exactly two:
# the homepage's Featured Recipes panel is a fixed 2-up grid on desktop.
FEATURED_EXTERNAL_IDS = ["52904", "53053"]

# (TheMealDB external_id -> frontend/lib/categories.ts tag labels, lowercased
# to match Tag.save()'s own normalisation). Hand-picked per dish, the same
# reasoning import_themealdb.py's docstring gives for never doing this
# automatically from TheMealDB's own categories: "Vegetarian" is not
# "Vegan", and a categoriser guessing from a category name alone would
# mislabel dishes that are vegetarian but not vegan (dairy, eggs) as vegan.
# "vegan" is applied only to imports actually pulled from TheMealDB's Vegan
# category - never inferred from an ingredient list here.
TAGS = {
    # Beef (dinner-leaning mains; a few quicker stir-fries/wraps read as
    # lunch or a quick bite too)
    "53281": ["dinner", "quick bite!"],   # Algerian Kefta (Meatballs)
    "53334": ["lunch"],                    # Arepa Pabellon
    "53329": ["lunch"],                    # Arepa pelua
    "53133": ["dinner"],                   # Asado
    "53099": ["lunch", "quick bite!"],     # Aussie Burgers
    "53457": ["dinner"],                   # Barbados Pepperpot
    "53366": ["dinner", "quick bite!"],    # Beef and Broccoli Stir-Fry
    "52874": ["dinner"],                   # Beef and Mustard Pie
    "52878": ["dinner"],                   # Beef and Oyster pie
    "53071": ["dinner"],                   # Beef Asado
    "52997": ["lunch", "quick bite!"],     # Beef Banh Mi Bowls
    "52904": ["dinner"],                   # Beef Bourguignon
    "52812": ["dinner"],                   # Beef Brisket Pot Roast
    "53070": ["dinner"],                   # Beef Caldereta
    "52873": ["dinner"],                   # Beef Dumpling Stew
    "53317": ["lunch", "quick bite!"],     # Beef Empanadas
    "52952": ["dinner", "quick bite!"],    # Beef Lo Mein
    "53421": ["dinner", "quick bite!"],    # Beef Lok Lak
    "53359": ["dinner"],                   # Beef Mandi
    "53068": ["dinner"],                   # Beef Mechado
    "53238": ["dinner"],                   # Beef pho
    "53469": ["dinner"],                   # Beef pumpkin Stew
    "53053": ["dinner"],                   # Beef Rendang
    "52834": ["dinner"],                   # Beef stroganoff

    # Vegan (pulled from TheMealDB's own Vegan category)
    "53092": ["vegan", "lunch", "quick bite!"],  # Fasoliyyeh Bi Z-Zayt
    "53150": ["vegan", "quick bite!"],           # Padron peppers
    "53115": ["vegan", "quick bite!"],           # Red onion pickle
    "52942": ["vegan", "dinner"],                # Roast fennel & aubergine paella
    "53250": ["vegan", "lunch", "quick bite!"],  # Vegan banh mi

    # Vegetarian (may carry dairy/eggs - never tagged vegan)
    "53158": ["lunch", "quick bite!"],     # Air fryer patatas bravas
    "53288": ["lunch", "quick bite!"],     # Algerian Flafla (Bell Pepper Salad)
    "53278": ["lunch", "quick bite!"],     # Aubergine & hummus grills
    "53267": ["lunch"],                    # Aubergine couscous salad
    "53107": ["lunch", "quick bite!"],     # Avocado dip with new potatoes

    # Dessert
    "53120": ["dessert"],                  # Aebleskiver
    "53138": ["dessert"],                  # Alfajores
    "53111": ["dessert"],                  # Anzac biscuits
    "53049": ["dessert"],                  # Apam balik
    "52893": ["dessert"],                  # Apple & Blackberry Crumble

    # Breakfast
    "53430": ["breakfast"],                # Antiguan Breakfast
    "53076": ["breakfast", "quick bite!"], # Bread omelette
    "52965": ["breakfast", "quick bite!"], # Breakfast Potatoes
    "53379": ["breakfast", "dessert"],     # Dutch poffertjes (mini pancakes)
    "52895": ["breakfast"],                # English Breakfast

    # Seafood
    "53483": ["lunch", "quick bite!"],     # Acaraje fritters with shrimp
    "53495": ["dinner"],                   # Amok Trey (Cambodian Fish Curry)
    "53147": ["dinner"],                   # Arroz con gambas y calamar

    # Pasta
    "52839": ["dinner", "quick bite!"],    # Chilli prawn linguine
    "53064": ["dinner", "quick bite!"],    # Fettuccine Alfredo
    "52835": ["dinner", "quick bite!"],    # Fettucine alfredo
}


class Command(BaseCommand):
    help = (
        "Seed demo reviewer accounts, ratings and reviews, and feature two "
        "recipes, on top of the TheMealDB import - what the homepage and "
        "Explore page look like with real community activity on them."
    )

    def handle(self, *args, **options):
        User = get_user_model()

        if not Recipe.objects.filter(source=THEMEALDB).exists():
            self.stdout.write("No imported recipes found - running import_themealdb first...")
            call_command('import_themealdb')

        for username in REVIEWERS:
            User.objects.get_or_create(
                username=username,
                defaults={
                    'email': f'{username}@example.com',
                    'role': User.Role.REGISTERED,
                    # Unusable on purpose, the same reason sources.py's
                    # service_account() gives: these exist to own demo
                    # content, not to be signed into.
                    'password': make_password(None),
                },
            )

        seeded = 0
        missing = []
        for external_id, username, score, review in SEED:
            try:
                recipe = Recipe.objects.get(source=THEMEALDB, external_id=external_id)
            except Recipe.DoesNotExist:
                missing.append(external_id)
                continue

            user = User.objects.get(username=username)
            Rating.objects.update_or_create(
                recipe=recipe, user=user, defaults={'score': score},
            )
            Comment.objects.get_or_create(
                recipe=recipe, user=user, content=review,
            )
            seeded += 1

        featured = Recipe.objects.filter(
            source=THEMEALDB, external_id__in=FEATURED_EXTERNAL_IDS,
        ).update(featured=True)

        tagged = 0
        tag_missing = []
        for external_id, names in TAGS.items():
            try:
                recipe = Recipe.objects.get(source=THEMEALDB, external_id=external_id)
            except Recipe.DoesNotExist:
                tag_missing.append(external_id)
                continue

            for name in names:
                tag, _ = Tag.objects.get_or_create(name=name)
                RecipeTag.objects.get_or_create(recipe=recipe, tag=tag)
            tagged += 1

        self.stdout.write(
            self.style.SUCCESS(
                f'Seeded {seeded} rating(s)/review(s), featured {featured} '
                f'recipe(s), and tagged {tagged} recipe(s).'
            )
        )
        if missing or tag_missing:
            missing_ids = ', '.join(sorted(set(missing) | set(tag_missing)))
            self.stdout.write(
                self.style.WARNING(
                    f"Some recipe(s) not found and skipped - re-run "
                    f"import_themealdb with a higher --limit to cover them: "
                    f"{missing_ids}"
                )
            )
