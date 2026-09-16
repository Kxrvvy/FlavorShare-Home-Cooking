"use client";

/* One plan's schedule: editable name/dates, a "Generate" action that fills
 * empty slots from the same recipes the backend's generator draws from
 * (saved + your own published recipes), and a day x meal-type grid for
 * adding or removing entries by hand.
 *
 * MealPlanEntrySerializer returns `recipe` as a bare id - resolving it to a
 * title is this component's job, from the candidate list below, not the
 * API's. An entry whose recipe no longer resolves (unpublished by its author
 * since being scheduled) shows as "Recipe no longer available" rather than
 * disappearing - CLAUDE.md records this as a known, deliberate gap in the
 * data model and suggests exactly this wording for the depth pass.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  addMealPlanEntry,
  deleteMealPlan,
  deleteMealPlanEntry,
  generateMealPlan,
  getMealPlan,
  updateMealPlan,
  type MealPlanDetailRow,
  type MealPlanEntryRow,
  type MealType,
} from "@/features/mealplans/api";
import {
  ApiError,
  listMyRecipes,
  listSavedRecipes,
  type RecipeRow,
} from "@/features/recipes/api";
import { useSession } from "@/lib/useSession";

const FIELD =
  "rounded-xl border border-rule bg-field px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon";

const MEAL_TYPES: { value: MealType; label: string }[] = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
];

function daysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  let cursor = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);

  while (cursor <= last) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }
  return days;
}

function formatDay(day: string) {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** One empty slot's "add a recipe" control - its own busy/error state so one
 * cell failing does not touch any other. */
function AddEntry({
  candidates,
  disabled,
  onAdd,
}: {
  candidates: RecipeRow[];
  disabled: boolean;
  onAdd: (recipeId: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const recipeId = Number(e.target.value);
    e.target.value = "";
    if (!recipeId) return;

    setBusy(true);
    setError("");
    try {
      await onAdd(recipeId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <select
        defaultValue=""
        disabled={disabled || busy || candidates.length === 0}
        onChange={handleChange}
        className={`${FIELD} w-full py-1.5 text-xs disabled:opacity-50`}
      >
        <option value="" disabled>
          {candidates.length === 0 ? "Nothing to add" : "+ Add a recipe"}
        </option>
        {candidates.map((r) => (
          <option key={r.recipe_id} value={r.recipe_id}>
            {r.title}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

export function MealPlanDetail({ planId }: { planId: number }) {
  const router = useRouter();
  const { user } = useSession();

  const [plan, setPlan] = useState<MealPlanDetailRow | null>(null);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<RecipeRow[]>([]);

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState("");

  const [mealTypes, setMealTypes] = useState<MealType[]>(["breakfast", "lunch", "dinner"]);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");

  const [deleting, setDeleting] = useState(false);
  const [entryBusy, setEntryBusy] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMealPlan(planId);
        if (cancelled) return;
        setPlan(data);
        setName(data.name);
        setStartDate(data.start_date ?? "");
        setEndDate(data.end_date ?? "");
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError && err.status === 404
              ? "This meal plan does not exist."
              : "Could not load this meal plan."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [saved, mine] = await Promise.all([
        listSavedRecipes(),
        listMyRecipes(user.user_id),
      ]);
      if (cancelled) return;

      // The same candidate set the backend's generator draws from: saved
      // recipes plus your own published ones. A Map so a recipe both saved
      // and authored by you counts once.
      const map = new Map<number, RecipeRow>();
      for (const row of saved) map.set(row.recipe_detail.recipe_id, row.recipe_detail);
      for (const r of mine) {
        if (r.status === "published") map.set(r.recipe_id, r);
      }
      setCandidates(Array.from(map.values()));
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function saveDetails() {
    const trimmed = name.trim();
    if (!trimmed) return;

    setSavingDetails(true);
    setDetailsError("");
    try {
      const updated = await updateMealPlan(planId, {
        name: trimmed,
        start_date: startDate || null,
        end_date: endDate || null,
      });
      setPlan((current) => (current ? { ...current, ...updated } : current));
    } catch (err) {
      setDetailsError(err instanceof ApiError ? err.message : "Could not save changes.");
    } finally {
      setSavingDetails(false);
    }
  }

  async function generate() {
    setGenerating(true);
    setGenerateError("");
    try {
      setPlan(await generateMealPlan(planId, mealTypes));
    } catch (err) {
      setGenerateError(
        err instanceof ApiError ? err.message : "Could not generate a schedule."
      );
    } finally {
      setGenerating(false);
    }
  }

  async function removeEntry(entry: MealPlanEntryRow) {
    setEntryBusy(entry.meal_plan_entry_id);
    try {
      await deleteMealPlanEntry(entry.meal_plan_entry_id);
      setPlan((current) =>
        current
          ? {
              ...current,
              entries: current.entries.filter(
                (e) => e.meal_plan_entry_id !== entry.meal_plan_entry_id
              ),
            }
          : current
      );
    } catch {
      // Left in place; the remove button stays clickable to try again.
    } finally {
      setEntryBusy(null);
    }
  }

  async function addEntry(day: string, mealType: MealType, recipeId: number) {
    const created = await addMealPlanEntry({
      meal_plan: planId,
      recipe: recipeId,
      day,
      meal_type: mealType,
    });
    setPlan((current) =>
      current ? { ...current, entries: [...current.entries, created] } : current
    );
  }

  async function removePlan() {
    if (!plan) return;
    if (!window.confirm(`Delete "${plan.name}"? This removes its whole schedule too.`)) return;

    setDeleting(true);
    try {
      await deleteMealPlan(planId);
      router.push("/me/meal-plans");
    } catch {
      setDeleting(false);
    }
  }

  if (error) {
    return (
      <div>
        <p className="text-sm text-red-600">{error}</p>
        <Link
          href="/me/meal-plans"
          className="mt-4 inline-block text-sm font-semibold text-maroon hover:underline"
        >
          Back to meal plans
        </Link>
      </div>
    );
  }

  if (!plan) {
    return <p className="text-sm text-muted">Loading...</p>;
  }

  const recipeById = new Map(candidates.map((r) => [r.recipe_id, r]));
  const hasDates = !!(plan.start_date && plan.end_date);
  const days = hasDates ? daysBetween(plan.start_date!, plan.end_date!) : [];

  return (
    <div>
      <Link
        href="/me/meal-plans"
        className="text-sm font-semibold text-maroon hover:underline"
      >
        ← Back to meal plans
      </Link>

      <div className="mt-4 rounded-2xl border border-rule bg-card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-1 flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`${FIELD} w-full font-normal normal-case tracking-normal`}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Start date
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={`${FIELD} font-normal normal-case tracking-normal`}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            End date
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={`${FIELD} font-normal normal-case tracking-normal`}
            />
          </label>
          <button
            type="button"
            disabled={savingDetails || !name.trim()}
            onClick={saveDetails}
            className="rounded-full bg-maroon px-5 py-2.5 font-display text-sm font-semibold text-card disabled:opacity-50"
          >
            {savingDetails ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={removePlan}
            className="rounded-full border border-rule px-5 py-2.5 font-display text-sm font-semibold text-maroon disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete plan"}
          </button>
        </div>
        {detailsError && <p className="mt-3 text-sm text-red-600">{detailsError}</p>}
      </div>

      {!hasDates ? (
        <div className="mt-6 rounded-2xl border border-rule bg-card p-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">Set the dates above</p>
          <p className="mt-2 text-sm text-muted">
            A schedule needs a start and end date before it can hold anything.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-rule bg-card p-4">
            <p className="font-display text-xs font-semibold uppercase tracking-wide text-muted">
              Generate
            </p>
            {MEAL_TYPES.map((mt) => (
              <label key={mt.value} className="flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={mealTypes.includes(mt.value)}
                  onChange={(e) =>
                    setMealTypes((current) =>
                      e.target.checked
                        ? [...current, mt.value]
                        : current.filter((v) => v !== mt.value)
                    )
                  }
                />
                {mt.label}
              </label>
            ))}
            <button
              type="button"
              disabled={generating || mealTypes.length === 0}
              onClick={generate}
              className="ml-auto rounded-full bg-maroon px-5 py-2 font-display text-xs font-semibold text-card disabled:opacity-50"
            >
              {generating ? "Generating..." : "Fill empty slots"}
            </button>
          </div>
          {generateError && <p className="mt-2 text-sm text-red-600">{generateError}</p>}

          <div className="mt-6 overflow-x-auto rounded-xl border border-rule bg-card">
            <table className="w-full min-w-[720px] table-fixed border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-rule text-xs font-semibold uppercase tracking-wide text-muted">
                  <th scope="col" className="w-32 px-3 py-3">Day</th>
                  {MEAL_TYPES.map((mt) => (
                    <th key={mt.value} scope="col" className="px-3 py-3">
                      {mt.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day} className="border-b border-rule align-top last:border-0">
                    <td className="px-3 py-3 text-xs font-semibold text-ink">{formatDay(day)}</td>
                    {MEAL_TYPES.map((mt) => {
                      const entries = plan.entries.filter(
                        (e) => e.day === day && e.meal_type === mt.value
                      );

                      return (
                        <td key={mt.value} className="px-3 py-3">
                          <div className="flex flex-col gap-1.5">
                            {entries.map((entry) => {
                              const recipe = recipeById.get(entry.recipe);
                              const busy = entryBusy === entry.meal_plan_entry_id;

                              return (
                                <div
                                  key={entry.meal_plan_entry_id}
                                  className="flex items-center justify-between gap-2 rounded-lg bg-panel/60 px-2 py-1.5"
                                >
                                  {recipe ? (
                                    <Link
                                      href={`/recipes/${recipe.recipe_id}`}
                                      className="truncate text-xs font-medium text-ink hover:underline"
                                    >
                                      {recipe.title}
                                    </Link>
                                  ) : (
                                    <span className="truncate text-xs italic text-muted">
                                      Recipe no longer available
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => removeEntry(entry)}
                                    aria-label="Remove"
                                    className="shrink-0 text-xs font-semibold text-maroon disabled:opacity-50"
                                  >
                                    {busy ? "…" : "×"}
                                  </button>
                                </div>
                              );
                            })}

                            <AddEntry
                              candidates={candidates}
                              disabled={false}
                              onAdd={(recipeId) => addEntry(day, mt.value, recipeId)}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
