"use client";

/* Everything on the Explore page that isn't a one-click tag chip: cuisine,
 * difficulty, ingredient and time bounds, plus sort order. One form,
 * submitted deliberately rather than per keystroke/selection - the ingredient
 * and time fields would otherwise fire a navigation on every character typed.
 *
 * Seeded from `current` (the page's parsed searchParams) rather than starting
 * blank, so reloading a filtered URL shows the filters that produced it
 * instead of an empty-looking form sitting above a filtered result.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { buildUrl } from "@/features/recipes/browseParams";

const FIELD =
  "rounded-xl border border-rule bg-field px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon";

const DIFFICULTIES = ["easy", "medium", "hard"] as const;

const SORTS = [
  { value: "", label: "Newest" },
  { value: "-view_count", label: "Most viewed" },
  { value: "-avg_score", label: "Highest rated" },
  { value: "-save_count", label: "Most saved" },
] as const;

export function FiltersPanel({
  current,
  cuisines,
}: {
  current: Record<string, string>;
  cuisines: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [cuisineType, setCuisineType] = useState(current.cuisine_type ?? "");
  const [difficulty, setDifficulty] = useState(current.difficulty ?? "");
  const [ingredient, setIngredient] = useState(current.ingredient ?? "");
  const [prepMin, setPrepMin] = useState(current.prep_time_min ?? "");
  const [prepMax, setPrepMax] = useState(current.prep_time_max ?? "");
  const [cookMin, setCookMin] = useState(current.cook_time_min ?? "");
  const [cookMax, setCookMax] = useState(current.cook_time_max ?? "");
  const [ordering, setOrdering] = useState(current.ordering ?? "");

  function apply(event: FormEvent) {
    event.preventDefault();
    const url = buildUrl(current, {
      cuisine_type: cuisineType,
      difficulty,
      ingredient: ingredient.trim(),
      prep_time_min: prepMin,
      prep_time_max: prepMax,
      cook_time_min: cookMin,
      cook_time_max: cookMax,
      ordering,
    });
    startTransition(() => router.push(url));
  }

  return (
    <form
      onSubmit={apply}
      className="mt-6 flex flex-wrap items-end justify-center gap-3 rounded-2xl border border-rule bg-card p-4"
    >
      <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        Cuisine
        <select
          value={cuisineType}
          onChange={(e) => setCuisineType(e.target.value)}
          className={`${FIELD} w-auto font-normal normal-case tracking-normal`}
        >
          <option value="">Any</option>
          {cuisines.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        Difficulty
        <select
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
          className={`${FIELD} w-auto font-normal normal-case capitalize tracking-normal`}
        >
          <option value="">Any</option>
          {DIFFICULTIES.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        Ingredient
        <input
          value={ingredient}
          onChange={(e) => setIngredient(e.target.value)}
          placeholder="e.g. chicken"
          className={`${FIELD} w-36 font-normal normal-case tracking-normal`}
        />
      </label>

      <div className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        Prep time (min)
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            value={prepMin}
            onChange={(e) => setPrepMin(e.target.value)}
            placeholder="Min"
            className={`${FIELD} w-20 font-normal normal-case tracking-normal`}
          />
          <span className="text-muted">–</span>
          <input
            type="number"
            min={0}
            value={prepMax}
            onChange={(e) => setPrepMax(e.target.value)}
            placeholder="Max"
            className={`${FIELD} w-20 font-normal normal-case tracking-normal`}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        Cook time (min)
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={0}
            value={cookMin}
            onChange={(e) => setCookMin(e.target.value)}
            placeholder="Min"
            className={`${FIELD} w-20 font-normal normal-case tracking-normal`}
          />
          <span className="text-muted">–</span>
          <input
            type="number"
            min={0}
            value={cookMax}
            onChange={(e) => setCookMax(e.target.value)}
            placeholder="Max"
            className={`${FIELD} w-20 font-normal normal-case tracking-normal`}
          />
        </div>
      </div>

      <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        Sort by
        <select
          value={ordering}
          onChange={(e) => setOrdering(e.target.value)}
          className={`${FIELD} w-auto font-normal normal-case tracking-normal`}
        >
          {SORTS.map((sort) => (
            <option key={sort.value} value={sort.value}>
              {sort.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-maroon px-5 py-2.5 font-display text-xs font-semibold text-card disabled:opacity-50"
      >
        {isPending ? "Applying..." : "Apply filters"}
      </button>
    </form>
  );
}
