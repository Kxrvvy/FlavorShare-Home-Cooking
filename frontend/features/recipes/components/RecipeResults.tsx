/* The grid itself - a Server Component, async, re-rendered fresh on every
 * navigation app/recipes/page.tsx's Suspense boundary wraps it in. Owns the
 * three states this app already renders consistently elsewhere (an error
 * message, an empty state, or the results): a thrown fetch (browseRecipes()
 * throws rather than swallowing failures, unlike the homepage's fetchers -
 * see lib/home-recipes.ts) becomes a plain error message here, not a crashed
 * page.
 */

import { RecipeCard } from "@/components/ui/RecipeCard";
import { RecipePager } from "@/features/recipes/components/RecipePager";
import { browseRecipes, type BrowseParams } from "@/lib/home-recipes";

export async function RecipeResults({
  current,
  params,
}: {
  current: Record<string, string>;
  params: BrowseParams;
}) {
  let data;
  try {
    data = await browseRecipes(params);
  } catch {
    return (
      <p className="mt-10 text-center text-sm text-red-600">
        Could not load recipes. Try again in a moment.
      </p>
    );
  }

  if (data.results.length === 0) {
    return (
      <div className="mt-10 rounded-2xl border border-rule bg-card p-10 text-center">
        <p className="font-display text-lg font-semibold text-ink">
          {params.search ? `Nothing matches "${params.search}"` : "No recipes match those filters"}
        </p>
        <p className="mt-2 text-sm text-muted">Try a different search or fewer filters.</p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {data.results.map((recipe) => (
          <RecipeCard key={recipe.recipe_id} recipe={recipe} />
        ))}
      </div>

      <RecipePager current={current} page={params.page ?? 1} hasNext={!!data.next} />
    </>
  );
}
