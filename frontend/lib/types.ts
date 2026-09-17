/* The shapes the Django API actually returns.
 *
 * These mirror recipes/serializers.py field for field, including the ones this
 * page does not use yet - status, view_count, created_at. Matching the real
 * payload is what let swapping dummy data for fetch() (lib/home-recipes.ts)
 * be a change of three functions rather than a redesign.
 *
 * `featured` and `tags` are both real, live fields on RecipeListSerializer -
 * an admin curates the former (see the /admin/recipes moderation page), and
 * the latter is what lets RecipeCard's VEGAN badge show real data. An earlier
 * version of this comment called both pending backend work; they landed.
 */

export type Difficulty = "easy" | "medium" | "hard";

export type RecipeAuthor = {
  user_id: number;
  username: string;
};

export type Recipe = {
  recipe_id: number;
  user: RecipeAuthor;
  title: string;
  description: string;
  cuisine_type: string | null;
  prep_time: number | null;
  cook_time: number | null;
  servings: number | null;
  difficulty: Difficulty | null;
  status: "draft" | "published";
  view_count: number;
  cover_image: string | null;
  avg_score: number | null;
  save_count: number;
  created_at: string;
  updated_at: string;

  /** Pending backend work - see the note above. */
  featured: boolean;
  /** Not yet returned by the list endpoint - see the note above. */
  tags: string[];
};

/** DRF's PageNumberPagination envelope, at the project's PAGE_SIZE of 20. */
export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};
