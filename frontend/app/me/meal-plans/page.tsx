"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { RequireSignIn } from "@/components/auth/RequireSignIn";
import { AppShell } from "@/components/layout/AppShell";
import {
  createMealPlan,
  deleteMealPlan,
  listMealPlans,
  type MealPlanRow,
} from "@/features/mealplans/api";
import { ApiError } from "@/features/recipes/api";

function dateRange(plan: MealPlanRow) {
  if (!plan.start_date || !plan.end_date) return "No dates set yet";
  return `${plan.start_date} to ${plan.end_date}`;
}

function MealPlansList() {
  const router = useRouter();
  const [plans, setPlans] = useState<MealPlanRow[] | null>(null);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listMealPlans();
        if (cancelled) return;
        setPlans(data);
        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load your meal plans.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;

    setCreating(true);
    setCreateError("");
    try {
      const created = await createMealPlan({ name: trimmed });
      // Straight to the new plan rather than back to this list - naming a
      // plan is the first step of building it, not the whole task, and
      // its dates/schedule live on the detail page, not here.
      router.push(`/me/meal-plans/${created.meal_plan_id}`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create that plan.");
      setCreating(false);
    }
  }

  async function remove(plan: MealPlanRow) {
    if (!window.confirm(`Delete "${plan.name}"? This removes its whole schedule too.`)) return;

    setBusyId(plan.meal_plan_id);
    try {
      await deleteMealPlan(plan.meal_plan_id);
      setPlans((current) => current?.filter((p) => p.meal_plan_id !== plan.meal_plan_id) ?? current);
    } catch {
      // Left in the list; the delete button stays clickable to try again.
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[900px] px-5 py-10 lg:px-6 lg:py-14">
      <h1 className="font-display text-2xl font-semibold text-ink lg:text-3xl">Meal plans</h1>
      <p className="mt-2 text-sm text-muted">
        Schedule breakfast, lunch and dinner from the recipes you have saved or published.
      </p>

      <div className="mt-6 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder='Name your plan, e.g. "Next week"...'
          className="flex-1 rounded-xl border border-rule bg-field px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon"
        />
        <button
          type="button"
          disabled={creating || !name.trim()}
          onClick={create}
          className="rounded-full bg-maroon px-5 py-2.5 font-display text-sm font-semibold text-card disabled:opacity-50"
        >
          {creating ? "Creating..." : "New plan"}
        </button>
      </div>
      {createError && <p className="mt-2 text-sm text-red-600">{createError}</p>}

      {error && <p className="mt-6 text-sm text-red-600">{error}</p>}

      {plans === null ? (
        <p className="mt-6 text-sm text-muted">Loading...</p>
      ) : plans.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-rule bg-card p-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">No meal plans yet</p>
          <p className="mt-2 text-sm text-muted">Name one above to get started.</p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {plans.map((plan) => (
            <li
              key={plan.meal_plan_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rule bg-card p-4"
            >
              <Link href={`/me/meal-plans/${plan.meal_plan_id}`} className="min-w-0">
                <p className="truncate font-display text-base font-semibold text-ink hover:underline">
                  {plan.name}
                </p>
                <p className="mt-1 text-xs text-muted">{dateRange(plan)}</p>
              </Link>

              <button
                type="button"
                disabled={busyId === plan.meal_plan_id}
                onClick={() => remove(plan)}
                className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-maroon disabled:opacity-50"
              >
                {busyId === plan.meal_plan_id ? "Deleting..." : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MealPlansPage() {
  return (
    <AppShell>
      <RequireSignIn next="/me/meal-plans" action="see your meal plans">
        <MealPlansList />
      </RequireSignIn>
    </AppShell>
  );
}
