import { API_BASE_URL, errorsFromBody } from "@/lib/api";

interface RecipeResponse {
  recipe_id: number;
}

interface UploadResponse {
  url: string;
}

interface StepResponse {
  step_id: number;
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

async function request<T>(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

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
    title: string;
    description: string;
    servings: number;
    cook_time: number;
    prep_time?: number;
    cuisine_type?: string;
    difficulty?: "easy" | "medium" | "hard";
  },
  token: string
) {
  return request<RecipeResponse>("/recipes/", token, {
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
  ingredient: { name: string; quantity?: string; unit?: string },
  token: string
) {
  return request("/recipes/recipe-ingredients/", token, {
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
  token: string
) {
  // Returns the created step: a photo for this instruction needs its step_id,
  // and the response is the only place that id exists.
  return request<StepResponse>("/recipes/steps/", token, {
    method: "POST",
    body: JSON.stringify({
      recipe: recipeId,
      instruction,
      step_number: stepNumber,
    }),
  });
}

export async function uploadRecipeImage(file: File, token: string) {
  const formData = new FormData();
  formData.append("file", file);
  return request<UploadResponse>("/recipes/images/upload/", token, {
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
  token: string,
  options: { type?: "final" | "ingredient" | "step"; step?: number } = {}
) {
  const { type = "final", step } = options;
  return request("/recipes/images/", token, {
    method: "POST",
    body: JSON.stringify({
      recipe: recipeId,
      url,
      type,
      ...(step === undefined ? {} : { step }),
    }),
  });
}

export async function publishRecipe(recipeId: number, token: string) {
  return request(`/recipes/${recipeId}/publish/`, token, { method: "POST" });
}
