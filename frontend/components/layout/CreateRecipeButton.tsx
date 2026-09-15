"use client";

import Link from "next/link";

import { useSession } from "@/lib/useSession";

/* Create Recipe, as a page's own top-right action.
 *
 * A client component because where it goes depends on who you are: the builder
 * if you are signed in, the login page if you are not. It carries `next` so
 * signing in finishes the errand instead of landing you on the homepage to find
 * this button again - app/login/page.tsx reads it through safeNextPath.
 *
 * A Link rather than a button with onClick, so middle-click and open-in-new-tab
 * behave like any other link. Both states render the same label and styling, so
 * the href settling at hydration is invisible; the only cost is a click landing
 * in the few milliseconds before hydration, which sends a signed-in user to
 * /login, where they are simply already signed in.
 */

const TARGET = "/recipes/create";

/* One shape: a page's own top-right action. The sidebar variants went with the
 * rail when Create Recipe moved to the homepage, and "header" went with the
 * SiteHeader that AppShell replaced. A variant that still exists reads as a
 * variant somebody wants. */
const ACTION = [
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap",
  "rounded-full bg-maroon px-5 py-3 font-display text-sm font-semibold text-card",
  "transition-opacity hover:opacity-90 focus-visible:outline-2",
  "focus-visible:outline-offset-2 focus-visible:outline-maroon",
].join(" ");

type Props = {
  /** Lets a drawer close itself when the button is used. */
  onNavigate?: () => void;
};

export function CreateRecipeButton({ onNavigate }: Props) {
  const { user, ready } = useSession();

  // Not hydrated yet counts as signed out, the same as everywhere else.
  const href =
    ready && user ? TARGET : `/login?next=${encodeURIComponent(TARGET)}`;

  return (
    <Link href={href} onClick={onNavigate} className={ACTION}>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      >
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
      Create Recipe
    </Link>
  );
}
