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
from social.models import Comment, Rating

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

        self.stdout.write(
            self.style.SUCCESS(
                f'Seeded {seeded} rating(s)/review(s) and featured {featured} recipe(s).'
            )
        )
        if missing:
            self.stdout.write(
                self.style.WARNING(
                    f"{len(missing)} recipe(s) not found and skipped - "
                    f"re-run import_themealdb with a higher --limit to "
                    f"cover them: {', '.join(missing)}"
                )
            )
