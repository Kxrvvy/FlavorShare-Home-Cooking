"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/* The recipe search box in the sidebar chrome.
 *
 * Context-aware rather than one fixed destination: everywhere except "My
 * recipes" this searches the public Explore catalogue (/recipes?search=,
 * real now - see app/recipes/page.tsx), because that is what a search box
 * visible on the homepage and every recipe page ought to search. On "My
 * recipes" it keeps searching your own collection (/me/recipes?q=) exactly
 * as it always has - that page's own Tabs already own its query string, and
 * a search launched from there is naturally about what you are looking at.
 *
 * The category dropdown that used to sit here is gone for good, independent
 * of the above: its options were diets - vegan, breakfast, dessert - which
 * belong to the Explore page's own tag chips now, not to global chrome.
 */
export function SearchField({ onSubmitted }: { onSubmitted?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const mine = pathname.startsWith("/me/recipes");

  function search(event: FormEvent) {
    event.preventDefault();

    const term = query.trim();
    const base = mine ? "/me/recipes" : "/recipes";
    const param = mine ? "q" : "search";
    router.push(term ? `${base}?${param}=${encodeURIComponent(term)}` : base);
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
        placeholder={mine ? "Search your recipes..." : "Search recipes..."}
        aria-label={mine ? "Search your recipes" : "Search recipes"}
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
