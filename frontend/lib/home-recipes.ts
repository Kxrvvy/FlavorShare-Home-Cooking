import { API_BASE_URL } from "./api";
import type { Paginated, Recipe } from "./types";

/* Public, unauthenticated recipe reads against the real API: the homepage's
 * three sections, and the /recipes Explore page's full browse/search/filter.
 *
 * Plain fetch rather than features/recipes/api.ts's request() helper: these
 * are public GETs - the recipe list is IsRegisteredUserOrReadOnly, open to
 * guests - so there is no token to attach and no 401-retry to need. That
 * also keeps this isomorphic: the homepage calls these from a Server
 * Component at first render, and ExploreRecipes/Explore's own filters call
 * them again from the browser, and neither needs the other's
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

/** The homepage's own explore teaser. `tag` is a stored tag name
 * (lib/categories.ts's tagName()), not the label a chip shows - omit it for
 * "All". Capped at 6 and never paginated - it is a teaser, not the catalogue;
 * browseRecipes() below is the real thing. */
export async function getExplore(tag?: string): Promise<Paginated<Recipe>> {
  const query = tag ? `tag=${encodeURIComponent(tag)}` : "";
  const page = await fetchRecipes(query);
  return { ...page, results: page.results.slice(0, 6) };
}

/** Every filter RecipeFilterSet supports, for the /recipes Explore page.
 * Every field is optional and every field combines with every other by AND
 * server-side. `tag` and `ingredient` can technically repeat for OR
 * semantics (?tag=vegan&tag=easy), but the Explore page only ever offers one
 * category chip and one ingredient box at a time, so this function only ever
 * sends one of each. */
export interface BrowseParams {
  search?: string;
  tag?: string;
  cuisine_type?: string;
  difficulty?: "easy" | "medium" | "hard";
  ingredient?: string;
  prep_time_min?: number;
  prep_time_max?: number;
  cook_time_min?: number;
  cook_time_max?: number;
  ordering?: string;
  page?: number;
}

/** Unlike fetchRecipes()/getExplore() above, this throws rather than
 * swallowing a failed request into an empty page. On the homepage a broken
 * section is a small partial failure with three others still working; on
 * /recipes the fetch is the whole page, and silently showing "no recipes
 * found" during a real outage would misreport what happened. */
export async function browseRecipes(params: BrowseParams): Promise<Paginated<Recipe>> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }

  const res = await fetch(`${API_BASE_URL}/recipes/?${query.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`);
  }
  return res.json();
}

/** The cuisines currently in use, for the Explore page's cuisine dropdown -
 * see recipes/views.py's cuisines action for why this can't be a fixed list
 * the way lib/categories.ts's tags are. Empty on failure rather than
 * throwing: a missing cuisine list degrades to "no cuisine filter",  a much
 * smaller loss than the page itself failing to load. */
export async function getCuisines(): Promise<string[]> {
  const res = await fetch(`${API_BASE_URL}/recipes/cuisines/`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}
