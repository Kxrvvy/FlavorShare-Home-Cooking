"use client";

/* Everything on the Explore page that isn't a one-click tag chip: cuisine,
 * ingredient, minimum rating, and sort order. One form, submitted deliberately rather than
 * per keystroke/selection - the ingredient field would otherwise fire a
 * navigation on every character typed.
 *
 * There used to be difficulty, prep-time and cook-time filters here too. They
 * were removed because nothing in the catalogue populates those fields -
 * TheMealDB has no difficulty or prep/cook split, and a query against
 * production found none set on any of its 50 recipes - so every choice
 * returned an empty page. The backend filters still exist, and a recipe
 * written in the builder can still carry all three; only the controls are
 * gone. apply() still clears those params from the URL, so a stale bookmark
 * with ?difficulty=easy in it does not keep filtering with no control left
 * to undo it.
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

/* "& up" thresholds rather than exact stars: what someone wants is "nothing
 * below 4", and recipes average to fractions (4.33) that no exact-star option
 * would ever match. Unrated recipes have no average, so any choice here hides
 * them - which is the point of asking for a rating. */
const RATINGS = [
  { value: "4", label: "4 stars & up" },
  { value: "3", label: "3 stars & up" },
  { value: "2", label: "2 stars & up" },
] as const;

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
  const [ingredient, setIngredient] = useState(current.ingredient ?? "");
  const [minRating, setMinRating] = useState(current.min_rating ?? "");
  const [ordering, setOrdering] = useState(current.ordering ?? "");

  function apply(event: FormEvent) {
    event.preventDefault();
    const url = buildUrl(current, {
      cuisine_type: cuisineType,
      ingredient: ingredient.trim(),
      min_rating: minRating,
      ordering,
      // No longer offered as controls; cleared so an old URL cannot leave a
      // filter applied that nothing on the page can remove.
      difficulty: "",
      prep_time_min: "",
      prep_time_max: "",
      cook_time_min: "",
      cook_time_max: "",
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
        Ingredient
        <input
          value={ingredient}
          onChange={(e) => setIngredient(e.target.value)}
          placeholder="e.g. chicken"
          className={`${FIELD} w-36 font-normal normal-case tracking-normal`}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        Rating
        <select
          value={minRating}
          onChange={(e) => setMinRating(e.target.value)}
          className={`${FIELD} w-auto font-normal normal-case tracking-normal`}
        >
          <option value="">Any</option>
          {RATINGS.map((rating) => (
            <option key={rating.value} value={rating.value}>
              {rating.label}
            </option>
          ))}
        </select>
      </label>

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
