"use client";

import Link from "next/link";
import { useState } from "react";

import { CarouselArrows } from "@/components/ui/CarouselArrows";
import { CategoryChip } from "@/components/ui/CategoryChip";
import { RecipeCard } from "@/components/ui/RecipeCard";
import { CATEGORIES, tagName } from "@/lib/categories";
import { getExplore } from "@/lib/home-recipes";
import type { Recipe } from "@/lib/types";

/* EXPLORE NEW RECIPES.
 *
 * `recipes` is only the initial, server-rendered "All" list - the first
 * paint needs no request of its own. Every chip click after that calls
 * getExplore() again from here, in the browser, with that chip's tag name;
 * "All" clears the filter the same way. That is a genuine event handler, not
 * an effect reacting to `category` changing - fetching from a useEffect
 * keyed on state is exactly the shape Next 16's set-state-in-effect rule
 * flags (see the note in RecipeDetail.tsx), and a click is the actual thing
 * being reacted to here, not a derived value.
 *
 * Desktop lays the recipes out as a 3x2 grid. Mobile does not stack that grid:
 * the export shows a single card inside a cream panel with its own arrows, so
 * that is what the small breakpoint renders. Either way, an "Explore
 * recipes" button below always leads to the full catalogue at /recipes -
 * this section is a teaser, not the only way to browse.
 */

export function ExploreRecipes({ recipes: initialRecipes }: { recipes: Recipe[] }) {
  const [category, setCategory] = useState<string>("All");
  const [recipes, setRecipes] = useState<Recipe[]>(initialRecipes);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function selectCategory(next: string) {
    if (next === category || loading) return;

    setCategory(next);
    setIndex(0);
    setLoading(true);
    setError(false);
    try {
      const page = await getExplore(next === "All" ? undefined : tagName(next));
      setRecipes(page.results);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
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
            disabled={loading}
            onSelect={() => selectCategory(label)}
          />
        ))}
      </div>

      {loading ? (
        <p className="mt-10 text-center text-sm text-muted">Loading recipes...</p>
      ) : error ? (
        <p className="mt-10 text-center text-sm text-red-600">
          Could not load these recipes. Try another category.
        </p>
      ) : recipes.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted">
          Nothing tagged &ldquo;{category}&rdquo; yet.
        </p>
      ) : (
        <>
          {/* Mobile: a carousel in a panel, one card at a time. */}
          <div className="mt-8 rounded-3xl bg-panel px-5 py-6 lg:hidden">
            <div className="flex justify-center">
              <CarouselArrows
                size="small"
                label="recipe"
                onPrevious={() => setIndex((i) => Math.max(0, i - 1))}
                onNext={() => setIndex((i) => Math.min(recipes.length - 1, i + 1))}
                canGoPrevious={index > 0}
                canGoNext={index < recipes.length - 1}
              />
            </div>
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
        </>
      )}

      <div className="mt-10 flex justify-center">
        <Link
          href="/recipes"
          className="rounded-full bg-maroon px-7 py-3 font-display text-xs font-semibold uppercase tracking-widest text-card transition-opacity hover:opacity-90"
        >
          Explore more recipes
        </Link>
      </div>

      
    </section>
  );
}
