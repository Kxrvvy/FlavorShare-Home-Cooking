"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CreateRecipeButton } from "@/components/layout/CreateRecipeButton";
import { Logo } from "@/components/ui/Logo";
import { useSession } from "@/lib/useSession";

/* The hamburger and the panel it opens.
 *
 * This is the only interactive part of the header, which is why it is the only
 * part marked 'use client' - everything a client component imports lands in the
 * client bundle, so the boundary is drawn as tightly as it will go.
 *
 * The mobile export shows no search field and no nav links in the header at
 * all, only the logo and this button. Both live in here instead.
 */

const NAV = [
  { label: "Home", href: "/" },
  { label: "Explore", href: "/recipes" },
  { label: "Help", href: "/help" },
];

export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  /* The mobile header has no profile control of its own - the design puts
   * nothing but the logo and this button up there - so the account lives at the
   * foot of the panel, where "Sign in" already was. */
  const { user, ready, signOut } = useSession();
  const router = useRouter();

  async function handleSignOut() {
    setLeaving(true);
    await signOut();
    setOpen(false);
    router.push("/");
  }

  // A menu that stays open behind you when the page scrolls away is a menu you
  // have to dismiss twice. Escape closes it, as it does for any dialog.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        className="grid h-11 w-11 place-items-center rounded-full border border-rule text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon lg:hidden"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          {open ? (
            <>
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </>
          ) : (
            <>
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h16" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <div
          id="mobile-menu"
          className="absolute left-0 right-0 top-full z-40 border-t border-rule bg-canvas px-5 pb-6 pt-5 shadow-lg lg:hidden"
        >
          <SearchField />

          {/* The primary action, so it sits above the nav. Closing the panel on
            * use matters here and not on desktop: the panel overlays the page it
            * would otherwise navigate behind. */}
          <div className="mt-4">
            <CreateRecipeButton variant="panel" onNavigate={() => setOpen(false)} />
          </div>

          <nav className="mt-5">
            <ul className="flex flex-col">
              {NAV.map((item) => (
                <li key={item.label} className="border-b border-rule last:border-0">
                  <Link
                    href={item.href}
                    className="block py-3.5 font-display text-sm font-medium text-slate"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mt-5 flex items-center justify-between gap-3">
            <Logo />

            {/* Not hydrated yet counts as signed out - see useSession. */}
            {!ready || !user ? (
              <Link
                href="/login"
                className="font-display text-xs font-medium uppercase tracking-widest text-maroon"
              >
                Sign in
              </Link>
            ) : (
              <div className="min-w-0 text-right">
                <p className="truncate font-display text-xs font-semibold text-ink">
                  {user.username}
                </p>
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={leaving}
                  className="font-display text-xs font-medium uppercase tracking-widest text-maroon disabled:opacity-60"
                >
                  {leaving ? "Signing out..." : "Sign out"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* Shared between the mobile panel and the desktop header. Non-functional for
 * this pass - it submits nowhere until /recipes exists to receive a query. */
export function SearchField() {
  return (
    <form
      role="search"
      onSubmit={(event) => event.preventDefault()}
      className="flex w-full items-center rounded-full bg-field pl-4 pr-1 py-1"
    >
      <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
        <span className="sr-only">Filter by category</span>
        <select
          className="cursor-pointer appearance-none bg-transparent py-2 pr-4 text-xs text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon"
          defaultValue=""
        >
          <option value="">All Categories</option>
          <option value="vegan">Vegan</option>
          <option value="breakfast">Breakfast</option>
          <option value="lunch">Lunch</option>
          <option value="dinner">Dinner</option>
          <option value="dessert">Dessert</option>
        </select>
      </label>

      <span aria-hidden="true" className="mx-2 h-5 w-px bg-rule" />

      <input
        type="search"
        name="search"
        placeholder="Search for recipes..."
        aria-label="Search for recipes"
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
