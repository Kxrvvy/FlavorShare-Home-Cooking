"use client";

import { useState } from "react";

import { CarouselArrows } from "@/components/ui/CarouselArrows";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { RecipeCard } from "@/components/ui/RecipeCard";
import { CATEGORIES } from "@/lib/dummy-recipes";
import type { Recipe } from "@/lib/types";

/* EXPLORE NEW RECIPES.
 *
 * The chips track which one is selected so the pressed state is real, but they
 * do not filter anything yet - that arrives with ?tag= against the live API,
 * which the backend already supports.
 *
 * Desktop lays the recipes out as a 3x2 grid. Mobile does not stack that grid:
 * the export shows a single card inside a cream panel with its own arrows, so
 * that is what the small breakpoint renders.
 */

export function ExploreRecipes({ recipes }: { recipes: Recipe[] }) {
  const [category, setCategory] = useState<string>("All");
  const [index, setIndex] = useState(0);

  if (recipes.length === 0) return null;

  function selectCategory(next: string) {
    setCategory(next);
    // Whatever the carousel was showing belongs to the previous category.
    setIndex(0);
  }

  return (
    <section
      aria-labelledby="explore-heading"
      className="mx-auto mt-14 w-full max-w-[1320px] px-5 lg:mt-20 lg:px-6"
    >
      <div className="flex flex-col items-center text-center">
        <span className="rounded-full bg-coral px-4 py-1 font-display text-[10px] font-semibold uppercase tracking-widest text-white">
          Recipes
        </span>

        <h2
          id="explore-heading"
          className="mt-4 max-w-lg font-display text-[1.9rem] font-bold uppercase leading-tight tracking-tight text-ink lg:text-[2.4rem]"
        >
          Explore new recipes!
        </h2>

        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
          With our diverse collection of recipes we have something to satisfy
          every palate.
        </p>
      </div>

      <div
        role="group"
        aria-label="Filter recipes by category"
        className="mt-8 flex flex-wrap justify-center gap-2.5 lg:mt-10 lg:gap-3"
      >
        {CATEGORIES.map((label) => (
          <CategoryChip
            key={label}
            label={label}
            active={label === category}
            onSelect={() => selectCategory(label)}
          />
        ))}
      </div>

      {/* Mobile: a carousel in a panel, one card at a time. */}
      <div className="mt-8 rounded-3xl bg-panel px-5 py-6 lg:hidden">
        <CarouselArrows
          label="recipe"
          onPrevious={() => setIndex((i) => Math.max(0, i - 1))}
          onNext={() => setIndex((i) => Math.min(recipes.length - 1, i + 1))}
          canGoPrevious={index > 0}
          canGoNext={index < recipes.length - 1}
        />
        <div className="mt-5">
          <RecipeCard recipe={recipes[index]} />
        </div>
      </div>

      {/* Desktop: three across, two rows. */}
      <div className="mt-10 hidden gap-6 lg:grid lg:grid-cols-3">
        {recipes.map((recipe) => (
          <RecipeCard key={recipe.recipe_id} recipe={recipe} />
        ))}
      </div>
    </section>
  );
}
