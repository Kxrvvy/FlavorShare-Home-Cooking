import { API_BASE_URL, errorsFromBody } from "@/lib/api";
import { getAccessToken, refreshSession } from "@/lib/auth";

interface RecipeResponse {
  recipe_id: number;
}

interface UploadResponse {
  url: string;
}

interface StepResponse {
  step_id: number;
  step_number: number;
}

/* A failed request, with the server's own words kept intact.
 *
 * `message` is for the person; `fields` is keyed by API field name so a caller
 * can put "Ensure this field has no more than 150 characters." on the title
 * input rather than showing everyone "Request failed with status 400".
 */
export class ApiError extends Error {
  readonly status: number;
  readonly fields: Record<string, string>;

  constructor(status: number, fields: Record<string, string>, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

/* The token is read here rather than passed in, and read again on retry.
 *
 * Callers used to capture it once - `const token = getAccessToken()` at the top
 * of a submit - and reuse that string for every request that followed. After a
 * refresh they would still have been sending the old one, so renewing a session
 * mid-submit would have changed nothing. */
async function send(path: string, init: RequestInit): Promise<Response> {
  const token = getAccessToken();

  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
}

/* Exported for other feature modules (features/dashboard/api.ts) rather than
 * duplicated - the 401-retry-once behaviour above is exactly the kind of
 * thing two copies would drift on, the same reason API_BASE_URL moved out of
 * this file's earlier, page-local copies. */
export async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  let response: Response;

  try {
    response = await send(path, init);

    /* One retry, and only for 401. An expired access token is the ordinary
     * reason to see one, and refreshSession() is single-flight, so a page
     * saving several rows at once renews the session once rather than racing
     * itself into a blacklisted token. A second 401 is not staleness - it is
     * an answer - and is reported rather than retried. */
    if (response.status === 401 && (await refreshSession())) {
      response = await send(path, init);
    }
  } catch {
    /* fetch rejects rather than resolving when the request never reaches the
     * server - backend down, connection dropped, DNS gone - and the TypeError
     * it throws reads "Failed to fetch", which tells the author nothing. Status
     * 0 because there is no response to have a status.
     *
     * Same wording as lib/api.ts uses for the auth pages, so the app gives one
     * answer to one situation. */
    throw new ApiError(
      0,
      {},
      "Could not reach the server. Is the backend running?",
    );
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const { fields, message } = errorsFromBody(
      errorBody,
      `Request failed with status ${response.status}`,
    );

    /* A message only when the body had no per-field detail; otherwise the first
     * field message stands in, so something readable always reaches the screen
     * even if the caller does not map that particular field. */
    const summary =
      message ?? Object.values(fields)[0] ?? `Request failed with status ${response.status}`;

    throw new ApiError(response.status, fields, summary);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

/* The optional columns are omitted when empty rather than sent as null, so a
 * recipe created without them is indistinguishable from one saved before they
 * were collected. All three are nullable on Recipe and writable through
 * RecipeWriteSerializer. */
export async function createRecipe(
  payload: {
    /* The only field the API insists on, and the only one the builder has when
     * it creates the draft - everything else is filled in afterwards, one PATCH
     * at a time, and every other column on Recipe is nullable. */
    title: string;
    description?: string;
    servings?: number;
    cook_time?: number;
    prep_time?: number;
    cuisine_type?: string;
    difficulty?: "easy" | "medium" | "hard";
  }
) {
  return request<RecipeResponse>("/recipes/", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      status: "draft",
    }),
  });
}

/* `quantity` and `unit` are sent only when given.
 *
 * Both columns are nullable and RecipeIngredientSerializer accepts them
 * alongside ingredient_name, so an amount is recorded where the schema means it
 * to be rather than being baked into the ingredient's name. An empty box is
 * omitted rather than sent as "", which a DecimalField would reject.
 */
export async function addIngredient(
  recipeId: number,
  ingredient: { name: string; quantity?: string; unit?: string }
) {
  return request<IngredientRow>("/recipes/recipe-ingredients/", {
    method: "POST",
    body: JSON.stringify({
      recipe: recipeId,
      ingredient_name: ingredient.name,
      ...(ingredient.quantity ? { quantity: ingredient.quantity } : {}),
      ...(ingredient.unit ? { unit: ingredient.unit } : {}),
    }),
  });
}

/* `stepNumber` is sent rather than left to the server.
 *
 * StepSerializer will derive one from Max(step_number) + 1 when it is omitted,
 * which is fine one request at a time and wrong the moment two arrive together:
 * both read the same max, both write the same number, and the second loses to
 * unique_step_number_per_recipe as an IntegrityError - a 500, since the race is
 * between validate() and save() where the serializer's own clash check cannot
 * see it. Numbering here removes the derivation, and with it the race. It also
 * fixes the order, which the server's counter only ever got right by the order
 * requests happened to land.
 */
export async function addStep(
  recipeId: number,
  instruction: string,
  stepNumber: number,
  title?: string
) {
  // Returns the created step: a photo for this instruction needs its step_id,
  // and the response is the only place that id exists.
  return request<StepResponse>("/recipes/steps/", {
    method: "POST",
    body: JSON.stringify({
      recipe: recipeId,
      instruction,
      step_number: stepNumber,
      ...(title ? { title } : {}),
    }),
  });
}

export async function uploadRecipeImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return request<UploadResponse>("/recipes/images/upload/", {
    method: "POST",
    body: formData,
  });
}

/* Record a hosted URL against the recipe, or against one of its steps.
 *
 * Image.clean() keeps `type` and `step` telling the same story: a "step" photo
 * must name its step, and a "final" or "ingredient" one must not. Defaulting to
 * the cover keeps every existing caller unchanged.
 */
export async function attachRecipeImage(
  recipeId: number,
  url: string,
  options: { type?: "final" | "ingredient" | "step"; step?: number } = {}
) {
  const { type = "final", step } = options;
  return request<ImageRow>("/recipes/images/", {
    method: "POST",
    body: JSON.stringify({
      recipe: recipeId,
      url,
      type,
      ...(step === undefined ? {} : { step }),
    }),
  });
}

export async function publishRecipe(recipeId: number) {
  return request(`/recipes/${recipeId}/publish/`, { method: "POST" });
}

/* ---------------------------------------------------------------------------
 * Incremental editing.
 *
 * The builder saves each row as it is finished rather than writing everything
 * at once, so alongside the create helpers above it needs to read a draft back,
 * change one row, and remove one. Every verb below was proved against the live
 * API before being written: RecipeChildViewSet is a full ModelViewSet with
 * ownership enforced on create and on update, and ?recipe=<id> scopes both
 * child lists.
 * ------------------------------------------------------------------------- */

export interface ImageRow {
  image_id: number;
  url: string;
  type: "final" | "ingredient" | "step";
  step: number | null;
}

export interface RecipeRow {
  recipe_id: number;
  /** Nested by both recipe serializers; who wrote it. */
  user?: { user_id: number; username: string };
  title: string;
  description: string | null;
  servings: number | null;
  prep_time: number | null;
  cook_time: number | null;
  cuisine_type: string | null;
  difficulty: "easy" | "medium" | "hard" | null;
  status: "draft" | "published";
  created_at: string;
  /* RecipeDetailSerializer nests these; the list serializer does not. Present
   * on getRecipe, which is the only caller that needs them. */
  images?: ImageRow[];
  /* Detail-only, same reasoning as `images` - a card has no use for a
   * recipe's full long-form content. `body` is plain text, one paragraph per
   * blank line; `equipment` is plain text, one item per line - see the
   * comments on both fields in recipes/models.py for why neither is a
   * richer shape. */
  body?: string | null;
  equipment?: string | null;
  /* Both serializers return these, but only the detail page reads them, so
   * they stayed untyped until now - same reasoning as `images` above. `tags`
   * is names, not labels; lib/categories.ts's tagLabel() converts. */
  tags?: string[];
  avg_score?: number | null;
  save_count?: number;
  view_count?: number;
  /** Curated by an admin, not derived - see Recipe.featured in models.py. */
  featured?: boolean;
}

export interface StepRow {
  step_id: number;
  step_number: number;
  /** Optional - the coral heading above a step in the reference design.
   * A step written before this field existed simply has none. */
  title: string | null;
  instruction: string;
  images: { image_id: number; url: string; type: string }[];
}

export interface IngredientRow {
  recipe_ingredient_id: number;
  ingredient: { ingredient_id: number; name: string };
  quantity: string | null;
  unit: string | null;
}

export interface Paginated<T> {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: T[];
}

/** DRF paginates the child lists; a recipe's rows always fit one page. */
export function rows<T>(payload: Paginated<T> | T[]): T[] {
  return Array.isArray(payload) ? payload : payload.results ?? [];
}

export async function getRecipe(recipeId: number) {
  return request<RecipeRow>(`/recipes/${recipeId}/`);
}

/** Only the fields that changed - the whole point of saving field by field. */
export async function updateRecipe(
  recipeId: number,
  patch: Partial<Omit<RecipeRow, "recipe_id" | "status" | "created_at">>
) {
  return request<RecipeRow>(`/recipes/${recipeId}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteRecipe(recipeId: number) {
  return request<void>(`/recipes/${recipeId}/`, { method: "DELETE" });
}

/** A cook's recipes. Your own id includes your drafts, because visible_recipes()
 * already allowed them; anyone else's returns only what they published. */
export async function listMyRecipes(userId: number) {
  const payload = await request<Paginated<RecipeRow>>(
    `/recipes/?user=${userId}&ordering=-created_at`
  );
  return rows(payload);
}

/** Every recipe, drafts included - only an admin's own token can reach the
 * drafts, since visible_recipes() is what returns them at all. The whole
 * paginated payload comes back, not just the rows, so a caller can page. */
export async function listAllRecipes(params: {
  search?: string;
  status?: "draft" | "published";
  user?: number;
  tag?: string;
  ordering?: string;
  page?: number;
} = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);
  if (params.user) query.set("user", String(params.user));
  if (params.tag) query.set("tag", params.tag);
  query.set("ordering", params.ordering ?? "-created_at");
  if (params.page) query.set("page", String(params.page));

  return request<Paginated<RecipeRow>>(`/recipes/?${query.toString()}`);
}

/* Sorted here, because the endpoint does not.
 *
 * RecipeChildViewSet.get_queryset() ends in .order_by('pk'), which overrides
 * Step.Meta.ordering, so this list comes back in creation order. Until a recipe
 * is reordered the two agree and the difference is invisible; afterwards the
 * builder would reopen showing the order the steps were written in rather than
 * the order they were arranged into. The recipe detail endpoint nests its steps
 * through the related manager and is ordered correctly.
 */
export async function listSteps(recipeId: number) {
  const steps = rows(await request<Paginated<StepRow>>(`/recipes/steps/?recipe=${recipeId}`));
  return [...steps].sort((a, b) => a.step_number - b.step_number);
}

export async function updateStep(
  stepId: number,
  patch: { instruction?: string; step_number?: number; title?: string | null }
) {
  return request<StepRow>(`/recipes/steps/${stepId}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteStep(stepId: number) {
  return request<void>(`/recipes/steps/${stepId}/`, { method: "DELETE" });
}

/* Every step in the recipe, exactly once, in its new order. Partial lists are
 * refused - there is no right answer for where the omitted ones land. This also
 * closes any gap left by a deletion, which is why deleting does not renumber. */
export async function reorderSteps(
  recipeId: number,
  stepIds: number[]
) {
  return request(`/recipes/${recipeId}/steps/reorder/`, {
    method: "POST",
    body: JSON.stringify({ step_ids: stepIds }),
  });
}

export async function listIngredients(recipeId: number) {
  return rows(
    await request<Paginated<IngredientRow>>(
      `/recipes/recipe-ingredients/?recipe=${recipeId}`
    )
  );
}

/** `ingredient_name` re-points the row at another Ingredient, creating it if
 * nothing by that name exists - the same write path as adding one. */
export async function updateIngredient(
  rowId: number,
  patch: { ingredient_name?: string; quantity?: string | null; unit?: string | null }
) {
  return request<IngredientRow>(`/recipes/recipe-ingredients/${rowId}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteIngredient(rowId: number) {
  return request<void>(`/recipes/recipe-ingredients/${rowId}/`, {
    method: "DELETE",
  });
}

/* Removing the Image row unlinks the photo; the file itself stays on
 * Cloudinary, which the upload endpoint's own docstring already notes. Used
 * when a photo is replaced, so a recipe does not end up with two covers. */
export async function deleteImage(imageId: number) {
  return request<void>(`/recipes/images/${imageId}/`, { method: "DELETE" });
}

/** One entry in your collection, with the recipe itself attached. */
export interface SavedRow {
  saved_recipe_id: number;
  recipe: number;
  recipe_detail: RecipeRow;
  saved_at: string;
}

/* Recipes you saved from other cooks. The nested recipe_detail is what lets
 * this render cards without a request per row - see SavedRecipeSerializer. */
export async function listSavedRecipes() {
  return rows(await request<Paginated<SavedRow>>("/social/saved/?ordering=-saved_at"));
}

export interface RecipeTagRow {
  recipe_tag_id: number;
  tag: { tag_id: number; name: string };
}

export async function listRecipeTags(recipeId: number) {
  return rows(
    await request<Paginated<RecipeTagRow>>(`/social/recipe-tags/?recipe=${recipeId}`)
  );
}

/* `tag_name` is plain text and the shared Tag row is found or created for you -
 * the same shape addIngredient uses. The name must already be normalised the
 * way Tag.save() will store it; lib/categories.ts does that. */
export async function addRecipeTag(recipeId: number, name: string) {
  return request<RecipeTagRow>("/social/recipe-tags/", {
    method: "POST",
    body: JSON.stringify({ recipe: recipeId, tag_name: name }),
  });
}

export async function removeRecipeTag(rowId: number) {
  return request<void>(`/social/recipe-tags/${rowId}/`, { method: "DELETE" });
}

export async function unpublishRecipe(recipeId: number) {
  return request(`/recipes/${recipeId}/unpublish/`, { method: "POST" });
}

/* --------------------------------------------------- ratings and reviews */

export interface RatingRow {
  rating_id: number;
  recipe: number;
  user: { user_id: number; username: string };
  score: number;
  created_at: string;
}

/** Your own rating on this recipe, or null if you have not rated it - the
 * only shape the score widget needs to decide between POST and PATCH. */
export async function getMyRating(recipeId: number, userId: number) {
  const found = rows(
    await request<Paginated<RatingRow>>(
      `/social/ratings/?recipe=${recipeId}&user=${userId}`
    )
  );
  return found[0] ?? null;
}

export async function createRating(recipeId: number, score: number) {
  return request<RatingRow>("/social/ratings/", {
    method: "POST",
    body: JSON.stringify({ recipe: recipeId, score }),
  });
}

/** Changing your mind is a PATCH of the row you already own - the API
 * refuses a second rating on the same recipe from the same person. */
export async function updateRating(ratingId: number, score: number) {
  return request<RatingRow>(`/social/ratings/${ratingId}/`, {
    method: "PATCH",
    body: JSON.stringify({ score }),
  });
}

export interface CommentRow {
  comment_id: number;
  recipe: number;
  user: { user_id: number; username: string };
  content: string;
  created_at: string;
}

export async function listComments(recipeId: number) {
  return rows(
    await request<Paginated<CommentRow>>(
      `/social/comments/?recipe=${recipeId}&ordering=-created_at`
    )
  );
}

export async function postComment(recipeId: number, content: string) {
  return request<CommentRow>("/social/comments/", {
    method: "POST",
    body: JSON.stringify({ recipe: recipeId, content }),
  });
}

export async function deleteComment(commentId: number) {
  return request<void>(`/social/comments/${commentId}/`, { method: "DELETE" });
}

/* -------------------------------------------------------- saved recipes */

/** Your own saved-recipe row for this recipe, or null - lets the Save button
 * know its own state without fetching the whole collection. */
export async function getSavedEntry(recipeId: number) {
  const found = rows(
    await request<Paginated<SavedRow>>(`/social/saved/?recipe=${recipeId}`)
  );
  return found[0] ?? null;
}

export async function saveRecipe(recipeId: number) {
  return request<SavedRow>("/social/saved/", {
    method: "POST",
    body: JSON.stringify({ recipe: recipeId }),
  });
}

export async function unsaveRecipe(savedRecipeId: number) {
  return request<void>(`/social/saved/${savedRecipeId}/`, { method: "DELETE" });
}

/* ------------------------------------------------------------ nutrition */

/** Every macro is a decimal string or null - DRF's DecimalField serializes
 * that way by default, and null means either "never looked up" or "looked
 * up and Edamam had nothing usable", which fetchNutrition's caller cannot
 * tell apart from the response alone (nor needs to - both render the same
 * "not available" state). */
export interface NutritionInfoRow {
  nutrition_info_id: number;
  recipe: number;
  calories: string | null;
  protein: string | null;
  carbs: string | null;
  fat: string | null;
  fetched_at: string;
}

/** Populates and returns this recipe's macros, or returns the already-cached
 * row - meal_plans.views.NutritionInfoViewSet.fetch decides which. Registered
 * users only; a guest's call 401s the same as any other request here. */
export async function fetchNutrition(recipeId: number) {
  return request<NutritionInfoRow>("/meal-plans/nutrition/fetch/", {
    method: "POST",
    body: JSON.stringify({ recipe: recipeId }),
  });
}

/* -------------------------------------------------------------- reports */

export type ReportReason = "spam" | "inappropriate" | "misinformation" | "other";

/** Exactly one of `recipe`/`comment` - the API 400s otherwise, the same
 * either/or dashboard/models.py's Report enforces server-side. */
export async function createReport(target: {
  recipe?: number;
  comment?: number;
  reason: ReportReason;
  details?: string;
}) {
  return request<{ report_id: number }>("/dashboard/reports/", {
    method: "POST",
    body: JSON.stringify(target),
  });
}
