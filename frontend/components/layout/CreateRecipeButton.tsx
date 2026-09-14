"use client";

import Link from "next/link";

import { useSession } from "@/lib/useSession";

/* The header's Create Recipe control.
 *
 * A client component because where it goes depends on who you are: the builder
 * if you are signed in, the login page if you are not. It carries `next` so
 * signing in finishes the errand instead of returning you to the homepage to
 * find this button again - app/login/page.tsx reads it through safeNextPath.
 *
 * A Link rather than a button with onClick, so middle-click and open-in-new-tab
 * behave like every other link in the header. Both states render the same label
 * and the same styling, so the href settling at hydration is invisible; the only
 * cost is that a click landing in the few milliseconds before hydration sends a
 * signed-in user to /login, where they are simply already signed in.
 *
 * Two shapes, one component. The desktop and mobile headers are separate layouts
 * rather than one responsive row - see SiteHeader's comment - so this is shared
 * between them the way SearchField already is.
 */

const TARGET = "/recipes/create";

const BASE = [
  "items-center justify-center gap-2 rounded-full bg-maroon",
  "font-display text-sm font-semibold text-card transition-opacity",
  "hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2",
  "focus-visible:outline-maroon",
].join(" ");

const VARIANT = {
  /* Desktop: a pill beside the profile. Hidden below lg, where the mobile
   * header has no room for it and the panel carries it instead. */
  header: `hidden shrink-0 whitespace-nowrap px-5 py-2.5 lg:inline-flex ${BASE}`,
  /* Mobile: full width at the top of the open menu, as its primary action. */
  panel: `flex w-full px-5 py-3 ${BASE}`,
};

type Props = {
  variant?: keyof typeof VARIANT;
  /** Lets the mobile panel close itself when the button is used. */
  onNavigate?: () => void;
};

export function CreateRecipeButton({ variant = "header", onNavigate }: Props) {
  const { user, ready } = useSession();

  // Not hydrated yet counts as signed out, the same as everywhere else.
  const href =
    ready && user ? TARGET : `/login?next=${encodeURIComponent(TARGET)}`;

  return (
    <Link href={href} onClick={onNavigate} className={VARIANT[variant]}>
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
