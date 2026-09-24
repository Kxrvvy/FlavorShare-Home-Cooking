"use client";

import { useState } from "react";

import { CarouselArrows } from "@/components/ui/CarouselArrows";
import { RecipeCard } from "@/components/ui/RecipeCard";
import type { Recipe } from "@/lib/types";

/* FEATURED RECIPES - a cream panel holding two cards.
 *
 * Desktop shows both side by side with the arrows top-right of the heading;
 * phone and tablet show one at a time with a small, centred pair of arrows
 * under the card. Same data, two arrangements.
 *
 * Which recipes appear here is an editorial choice, not a popularity contest:
 * these come from recipe.featured, the column being added to the backend so an
 * admin can actually curate the section.
 */

export function FeaturedRecipes({ recipes }: { recipes: Recipe[] }) {
  const [index, setIndex] = useState(0);

  if (recipes.length === 0) return null;

  return (
    <section
      aria-labelledby="featured-heading"
      className="mx-auto mt-12 w-full max-w-[1320px] px-5 lg:mt-16 lg:px-6"
    >
      <div className="rounded-3xl bg-panel px-5 py-8 lg:px-10 lg:py-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <h2
            id="featured-heading"
            className="font-display text-2xl font-bold uppercase tracking-tight text-ink lg:text-[1.9rem]"
          >
            Featured Recipes
          </h2>

          {/* Desktop only: top-right of the heading, full size, as before. */}
          <div className="hidden lg:block">
            <CarouselArrows
              label="featured recipe"
              onPrevious={() => setIndex((i) => Math.max(0, i - 1))}
              onNext={() => setIndex((i) => Math.min(recipes.length - 1, i + 1))}
              canGoPrevious={index > 0}
              canGoNext={index < recipes.length - 1}
            />
          </div>
        </div>

        {/* Phone and tablet: one card, chosen by a smaller pair of arrows
          * centred beneath it rather than sharing a row with the heading. */}
        <div className="mt-6 lg:hidden">
          <RecipeCard recipe={recipes[index]} size="wide" />

          <div className="mt-4 flex justify-center">
            <CarouselArrows
              size="small"
              label="featured recipe"
              onPrevious={() => setIndex((i) => Math.max(0, i - 1))}
              onNext={() => setIndex((i) => Math.min(recipes.length - 1, i + 1))}
              canGoPrevious={index > 0}
              canGoNext={index < recipes.length - 1}
            />
          </div>
        </div>

        {/* Desktop: both, side by side. */}
        <div className="mt-8 hidden gap-6 lg:grid lg:grid-cols-2">
          {recipes.map((recipe) => (
            <RecipeCard key={recipe.recipe_id} recipe={recipe} size="wide" />
          ))}
        </div>
      </div>
    </section>
  );
}
