export interface IngredientInput {
  id: string;
  text: string;
}

export interface StepInput {
  id: string;
  text: string;
}

export interface RecipeFormErrors {
  title?: string;
  servingSize?: string;
  cookingTime?: string;
  ingredients?: string;
  steps?: string;
  image?: string;
}

export type SubmitStatus = "idle" | "submitting" | "success" | "error";
