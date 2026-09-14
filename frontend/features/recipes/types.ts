/* One ingredient row in the builder.
 *
 * Three fields rather than one string, because that is how the database holds
 * them: `name` becomes the shared Ingredient row, while quantity and unit
 * belong to this recipe's use of it. Typing "200g plain flour" into a single
 * box filed an *ingredient named* "200g plain flour", so "2 cups flour" was an
 * unrelated ingredient and searching for "flour" found neither.
 *
 * quantity and unit are strings here because they come from inputs and may be
 * empty; both columns are nullable.
 */
export interface IngredientInput {
  id: string;
  quantity: string;
  unit: string;
  name: string;
}

/* One instruction, with the optional photo that belongs to it.
 *
 * Holding a single File per step is also what enforces one photo per step:
 * nothing in the database stops several images pointing at the same Step (see
 * the soft-limitation note in CLAUDE.md), and the design shows one slot.
 *
 * `preview` is an object URL for the chosen file, revoked when it is replaced.
 */
export interface StepInput {
  id: string;
  text: string;
  image: File | null;
  preview: string | null;
}

export interface RecipeFormErrors {
  title?: string;
  prepTime?: string;
  cuisine?: string;
  difficulty?: string;
  servingSize?: string;
  cookingTime?: string;
  ingredients?: string;
  steps?: string;
  image?: string;
}

export type SubmitStatus = "idle" | "submitting" | "success" | "error";
