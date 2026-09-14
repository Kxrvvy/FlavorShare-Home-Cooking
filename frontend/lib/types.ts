/* The shapes the Django API actually returns.
 *
 * These mirror recipes/serializers.py field for field, including the ones this
 * page does not use yet - status, view_count, avg_score, created_at. Matching
 * the real payload now is what makes swapping dummy data for fetch() a change
 * of one function rather than a redesign.
 *
 * Two fields are worth a note:
 *
 * `featured` does not exist on the backend yet. It is the column we agreed to
 * add so the FEATURED RECIPES section has something to select on, instead of
 * quietly meaning "most saved".
 *
 * `tags` is not returned by RecipeListSerializer at all. The design puts a
 * VEGAN badge on cards, so it is modelled here - but the list endpoint will
 * need to start returning it before that badge can show real data.
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
