/* Meal plans: private to the caller, so every read is scoped server-side by
 * IsRegisteredUser plus a queryset filtered to the owner - a plan that isn't
 * yours is a 404, never a 403, the same pattern recipes.views documents for
 * drafts.
 *
 * MealPlanEntrySerializer returns `recipe` as a bare id on purpose - see the
 * docstring in meal_plans/serializers.py, "what a schedule card shows is a
 * frontend decision nobody has made yet." This module does not resolve ids to
 * titles itself; components/MealPlanDetail.tsx does that from the same
 * saved+published recipe list the generator draws from, so nothing here
 * duplicates that.
 *
 * request/Paginated are imported rather than redefined - see the same note in
 * features/dashboard/api.ts.
 */

import { request, rows, type Paginated } from "@/features/recipes/api";

export interface MealPlanRow {
  meal_plan_id: number;
  user: number;
  name: string;
  start_date: string | null;
  end_date: string | null;
}

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface MealPlanEntryRow {
  meal_plan_entry_id: number;
  meal_plan: number;
  recipe: number;
  day: string;
  meal_type: MealType;
}

export interface MealPlanDetailRow extends MealPlanRow {
  entries: MealPlanEntryRow[];
}

export async function listMealPlans() {
  return rows(await request<Paginated<MealPlanRow>>("/meal-plans/"));
}

export async function getMealPlan(planId: number) {
  return request<MealPlanDetailRow>(`/meal-plans/${planId}/`);
}

export async function createMealPlan(data: {
  name: string;
  start_date?: string | null;
  end_date?: string | null;
}) {
  return request<MealPlanRow>("/meal-plans/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateMealPlan(
  planId: number,
  patch: Partial<Pick<MealPlanRow, "name" | "start_date" | "end_date">>
) {
  return request<MealPlanRow>(`/meal-plans/${planId}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteMealPlan(planId: number) {
  return request<void>(`/meal-plans/${planId}/`, { method: "DELETE" });
}

/** Fills empty slots from saved + own-published recipes, round-robin. Never
 * touches a slot that already holds something - see generate()'s docstring
 * in meal_plans/views.py. Requires the plan to already have both dates set. */
export async function generateMealPlan(planId: number, mealTypes?: MealType[]) {
  return request<MealPlanDetailRow>(`/meal-plans/${planId}/generate/`, {
    method: "POST",
    body: JSON.stringify(mealTypes ? { meal_types: mealTypes } : {}),
  });
}

export async function addMealPlanEntry(entry: {
  meal_plan: number;
  recipe: number;
  day: string;
  meal_type: MealType;
}) {
  return request<MealPlanEntryRow>("/meal-plans/entries/", {
    method: "POST",
    body: JSON.stringify(entry),
  });
}

export async function deleteMealPlanEntry(entryId: number) {
  return request<void>(`/meal-plans/entries/${entryId}/`, { method: "DELETE" });
}
