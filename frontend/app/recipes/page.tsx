import type { Metadata } from "next";
import { Suspense } from "react";

import { AppShell } from "@/components/layout/AppShell";
import { CategoryChipNav } from "@/features/recipes/components/CategoryChipNav";
import { FiltersPanel } from "@/features/recipes/components/FiltersPanel";
import { RecipeResults } from "@/features/recipes/components/RecipeResults";
import { getCuisines, type BrowseParams } from "@/lib/home-recipes";

export const metadata: Metadata = {
  title: "Explore | FlavorShare",
};

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function toNumber(value: string): number | undefined {
  const n = Number(value);
  return value && Number.isFinite(n) ? n : undefined;
}

/* The real Explore page: search (via the header SearchField, which lands
 * here as ?search=), tag chips, a cuisine/ingredient/rating/sort form, and
 * pagination - every filter RecipeFilterSet supports except the
 * one this app has no way to see a caller's own drafts for (there is
 * deliberately no `status`/`user` filter here; this is the public catalogue).
 *
 * `current` is the parsed query as a plain record, handed to every client
 * control so each can patch just the fields it owns - see
 * features/recipes/browseParams.ts. `params` is the same values, shaped and
 * numbered for browseRecipes() itself.
 *
 * The Suspense key is the whole serialized filter set, not just page: without
 * it, a navigation inside the transition these controls already use keeps
 * showing the previous result while the new one streams in, which does not
 * match the "replace with a loading state" behaviour used everywhere else
 * filters exist in this app (see ExploreRecipes.tsx on the homepage).
 */
export default async function ExploreRecipesPage({
  searchParams,
}: PageProps<"/recipes">) {
  const raw = await searchParams;

  const current: Record<string, string> = {};
  for (const key of [
    "search",
    "tag",
    "cuisine_type",
    "difficulty",
    "ingredient",
    "min_rating",
    "prep_time_min",
    "prep_time_max",
    "cook_time_min",
    "cook_time_max",
    "ordering",
    "page",
  ]) {
    const value = first(raw[key]);
    if (value) current[key] = value;
  }

  const params: BrowseParams = {
    search: current.search,
    tag: current.tag,
    cuisine_type: current.cuisine_type,
    difficulty: current.difficulty as BrowseParams["difficulty"],
    ingredient: current.ingredient,
    min_rating: toNumber(current.min_rating ?? ""),
    prep_time_min: toNumber(current.prep_time_min ?? ""),
    prep_time_max: toNumber(current.prep_time_max ?? ""),
    cook_time_min: toNumber(current.cook_time_min ?? ""),
    cook_time_max: toNumber(current.cook_time_max ?? ""),
    ordering: current.ordering,
    page: toNumber(current.page ?? "") ?? 1,
  };

  const cuisines = await getCuisines();

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1320px] px-5 py-10 lg:px-6 lg:py-14">
        <header className="text-center">
          <h1 className="font-display text-2xl font-semibold text-ink lg:text-3xl">
            Explore recipes
          </h1>
          <p className="mt-2 text-sm text-muted">
            Browse, search and filter every published recipe.
          </p>
        </header>

        <CategoryChipNav current={current} tag={current.tag ?? ""} />
        <FiltersPanel current={current} cuisines={cuisines} />

        <Suspense
          key={JSON.stringify(current)}
          fallback={<p className="mt-10 text-center text-sm text-muted">Loading recipes...</p>}
        >
          <RecipeResults current={current} params={params} />
        </Suspense>
      </div>
    </AppShell>
  );
}
