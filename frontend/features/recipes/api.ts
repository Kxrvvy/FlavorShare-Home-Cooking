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

async function request<T>(
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
  stepNumber: number
) {
  // Returns the created step: a photo for this instruction needs its step_id,
  // and the response is the only place that id exists.
  return request<StepResponse>("/recipes/steps/", {
    method: "POST",
    body: JSON.stringify({
      recipe: recipeId,
      instruction,
      step_number: stepNumber,
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
  return request("/recipes/images/", {
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

export interface RecipeRow {
  recipe_id: number;
  title: string;
  description: string | null;
  servings: number | null;
  prep_time: number | null;
  cook_time: number | null;
  cuisine_type: string | null;
  difficulty: "easy" | "medium" | "hard" | null;
  status: "draft" | "published";
  created_at: string;
}

export interface StepRow {
  step_id: number;
  step_number: number;
  instruction: string;
  images: { image_id: number; url: string; type: string }[];
}

export interface IngredientRow {
  recipe_ingredient_id: number;
  ingredient: { ingredient_id: number; name: string };
  quantity: string | null;
  unit: string | null;
}

interface Paginated<T> {
  results?: T[];
}

/** DRF paginates the child lists; a recipe's rows always fit one page. */
function rows<T>(payload: Paginated<T> | T[]): T[] {
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

export async function listSteps(recipeId: number) {
  return rows(await request<Paginated<StepRow>>(`/recipes/steps/?recipe=${recipeId}`));
}

export async function updateStep(
  stepId: number,
  patch: { instruction?: string; step_number?: number }
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

export async function unpublishRecipe(recipeId: number) {
  return request(`/recipes/${recipeId}/unpublish/`, { method: "POST" });
}
