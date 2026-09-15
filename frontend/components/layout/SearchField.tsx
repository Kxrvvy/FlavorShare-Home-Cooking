"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/* The recipe search box in the sidebar chrome.
 *
 * It searches your recipes - your own plus the ones you saved - because that is
 * the only collection the app can actually search today: /recipes is still a
 * placeholder, so sending a query there would look like the search did nothing.
 * The placeholder text says so rather than promising a search of everything.
 *
 * The category dropdown that used to sit here is gone. Its options were diets -
 * vegan, breakfast, dessert - which come from tags, and the recipe list
 * endpoint does not return tags, so it could not have filtered anything. A
 * control that does nothing is worse than no control.
 */
export function SearchField({ onSubmitted }: { onSubmitted?: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  function search(event: FormEvent) {
    event.preventDefault();

    const term = query.trim();
    router.push(term ? `/me/recipes?q=${encodeURIComponent(term)}` : "/me/recipes");
    onSubmitted?.();
  }

  return (
    <form
      role="search"
      onSubmit={search}
      className="flex w-full items-center rounded-full bg-field pl-4 pr-1 py-1"
    >
      <input
        type="search"
        name="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search your recipes..."
        aria-label="Search your recipes"
        className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink placeholder:text-muted focus:outline-none"
      />

      <button
        type="submit"
        aria-label="Search"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-maroon text-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
      </button>
    </form>
  );
}
