import Image from "next/image";
import Link from "next/link";

import { formatRecipeMeta, hasDetailMeta } from "@/lib/format";
import type { Recipe } from "@/lib/types";

/* One card, used by both FEATURED RECIPES and EXPLORE NEW RECIPES.
 *
 * The two sections look different in the mockup only because their containers
 * are different widths - the anatomy is identical: photo, title, description,
 * meta line, button. Building it twice would mean fixing every future change
 * twice.
 */

type RecipeCardProps = {
  recipe: Recipe;
  /** Featured cards sit two-up and give the photo more height. */
  size?: "default" | "wide";
};

export function RecipeCard({ recipe, size = "default" }: RecipeCardProps) {
  const meta = formatRecipeMeta(recipe);
  // Which of the two meta lines this is decides how it may wrap - see below.
  const detailed = hasDetailMeta(recipe);
  const isVegan = recipe.tags.includes("vegan");

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl bg-card">
      {/* Both ratios are the photo's real dimensions in the export - 630x235
       * for a featured card, 425x235 for a grid card. They are wider and
       * shorter respectively rather than one shape scaled. */}
      <div
        className={`relative w-full shrink-0 ${
          size === "wide" ? "aspect-[630/235]" : "aspect-[425/235]"
        }`}
      >
        {recipe.cover_image ? (
          <Image
            src={recipe.cover_image}
            alt={recipe.title}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
            className="object-cover"
          />
        ) : (
          // A published recipe can legitimately have no cover photo yet.
          <div className="h-full w-full bg-panel" />
        )}

        {isVegan && (
          <span
            className="absolute -bottom-5 right-4 grid h-14 w-14 place-items-center rounded-full bg-lime text-center font-display text-[9px] font-bold uppercase leading-[1.1] tracking-wide text-ink"
            aria-label="Vegan recipe"
          >
            Vegan
            <br />&amp; Vegan
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 px-6 pb-6 pt-5">
        <h3 className="font-display text-lg font-semibold leading-snug text-ink">
          {recipe.title}
        </h3>

        <p className="text-sm leading-relaxed text-muted">
          {recipe.description}
        </p>

        {/* Pushed to the bottom so cards of differing text length still line
         * their meta rows and buttons up across a row.
         *
         * The two arrangements are both from the export: mobile stacks the meta
         * above a full-width button, desktop sets them side by side.
         *
         * Desktop treats the two meta lines differently, on purpose:
         * - the long form (time, difficulty, servings) may wrap, and is
         *   allowed to shrink down to 7.5rem beside the button, so the button
         *   stays next to the text instead of dropping under it. Those cards
         *   simply come out taller.
         * - the short form (rating, saves) never wraps, whatever the width.
         *
         * The row itself still wraps for both, and that is what stops the long
         * form collapsing: cards beside the sidebar are only ~220-320px wide
         * below 1300px, and with the button taking 129px of that a text column
         * with no minimum shrinks to 35px and runs to nine lines. Below 7.5rem
         * of room the button drops under the text, exactly as it always has. */}
        <div className="mt-auto flex flex-col gap-4 pt-5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between lg:gap-3">
          {/* Cuisine leads the line and links to Explore filtered by it, so
           * the card is also the quickest way to see more of the same. Plain
           * inline flow rather than a flex row, so a long line breaks between
           * words like a sentence instead of only between its three pieces.
           * Six of the fifty imports have no cuisine, so it is optional. */}
          <p
            className={`font-display text-[11px] font-medium tracking-wide text-ink ${
              detailed ? "lg:min-w-[7.5rem] lg:flex-1" : "whitespace-nowrap"
            }`}
          >
            {recipe.cuisine_type && (
              <>
                <Link
                  href={`/recipes?cuisine_type=${encodeURIComponent(recipe.cuisine_type)}`}
                  className="uppercase underline decoration-ink/30 underline-offset-2 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon"
                >
                  {recipe.cuisine_type}
                </Link>
                {meta && (
                  <span aria-hidden="true" className="mx-1.5">
                    -
                  </span>
                )}
              </>
            )}
            {meta}
          </p>

          <Link
            href={`/recipes/${recipe.recipe_id}`}
            className="block rounded-full border border-ink/70 px-6 py-2.5 text-center font-display text-[11px] font-medium tracking-widest text-ink transition-colors hover:bg-ink hover:text-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon lg:inline-block lg:w-auto lg:shrink-0"
          >
            VIEW RECIPE
          </Link>
        </div>
      </div>
    </article>
  );
}
