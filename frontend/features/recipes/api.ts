const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000/api";

interface RecipeResponse {
  recipe_id: number;
}

interface UploadResponse {
  url: string;
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
    const detail = errorBody?.detail || Object.values(errorBody || {})[0];
    throw new Error(
      typeof detail === "string"
        ? detail
        : `Request failed with status ${response.status}`
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

export async function createRecipe(
  payload: {
    title: string;
    description: string;
    servings: number;
    cook_time: number;
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

export async function addIngredient(
  recipeId: number,
  ingredient: string,
  token: string
) {
  return request("/recipes/recipe-ingredients/", token, {
    method: "POST",
    body: JSON.stringify({
      recipe: recipeId,
      ingredient_name: ingredient,
    }),
  });
}

export async function addStep(recipeId: number, instruction: string, token: string) {
  return request("/recipes/steps/", token, {
    method: "POST",
    body: JSON.stringify({ recipe: recipeId, instruction }),
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

export async function attachRecipeImage(
  recipeId: number,
  url: string,
  token: string
) {
  return request("/recipes/images/", token, {
    method: "POST",
    body: JSON.stringify({ recipe: recipeId, url, type: "final" }),
  });
}

export async function publishRecipe(recipeId: number, token: string) {
  return request(`/recipes/${recipeId}/publish/`, token, { method: "POST" });
}
