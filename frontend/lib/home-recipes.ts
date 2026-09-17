import { API_BASE_URL } from "./api";
import type { Paginated, Recipe } from "./types";

/* The homepage's three sections, against the real API.
 *
 * Plain fetch rather than features/recipes/api.ts's request() helper: these
 * are public GETs - the recipe list is IsRegisteredUserOrReadOnly, open to
 * guests - so there is no token to attach and no 401-retry to need. That
 * also keeps this isomorphic: the homepage calls these from a Server
 * Component at first render, and ExploreRecipes calls getExplore() again
 * from the browser on every chip click, and neither needs the other's
 * localStorage-backed session machinery.
 *
 * "no-store" rather than a revalidate window: a freshly published or
 * featured recipe should appear on the next load, not after a cache
 * window this project has no reason to tune yet.
 */

function empty(): Paginated<Recipe> {
  return { count: 0, next: null, previous: null, results: [] };
}

async function fetchRecipes(query: string): Promise<Paginated<Recipe>> {
  const res = await fetch(`${API_BASE_URL}/recipes/?${query}`, { cache: "no-store" });
  if (!res.ok) return empty();
  return res.json();
}

/** The hero carousel. */
export async function getTrending(): Promise<Paginated<Recipe>> {
  const page = await fetchRecipes("ordering=-view_count");
  return { ...page, results: page.results.slice(0, 5) };
}

/** The FEATURED RECIPES panel - recipe.featured, an admin's own curation. */
export async function getFeatured(): Promise<Paginated<Recipe>> {
  return fetchRecipes("featured=true");
}

/** The explore grid. `tag` is a stored tag name (lib/categories.ts's
 * tagName()), not the label a chip shows - omit it for "All". */
export async function getExplore(tag?: string): Promise<Paginated<Recipe>> {
  const query = tag ? `tag=${encodeURIComponent(tag)}` : "";
  const page = await fetchRecipes(query);
  return { ...page, results: page.results.slice(0, 6) };
}
