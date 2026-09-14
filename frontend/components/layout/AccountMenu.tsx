"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useSession } from "@/lib/useSession";

/* The desktop header's account control - the only part of the header that knows
 * who you are.
 *
 * A client component because the session lives in localStorage. It is kept this
 * small on purpose: SiteHeader stays a Server Component, so Logo and SearchField
 * do not follow it into the client bundle. MobileMenu is drawn the same way, and
 * the comment at the top of that file explains the same reasoning.
 *
 * Signed out, this renders exactly what the header rendered before it existed: a
 * link to /login in a bordered circle. Signed in, the circle becomes a button
 * that opens a panel with the account and a way out. `ready` is what keeps a
 * signed-in user from seeing the link for one frame on every page load.
 */

const AVATAR = [
  "grid h-11 w-11 shrink-0 place-items-center rounded-full border border-rule",
  "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
  "focus-visible:outline-maroon",
].join(" ");

export function AccountMenu() {
  const { user, ready, signOut } = useSession();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  /* Escape closes it, as MobileMenu does for its panel. A click anywhere else
   * closes it too - a dropdown that survives a click on the page behind it is a
   * dropdown you have to dismiss twice. */
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    function onPointerDown(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  async function handleSignOut() {
    setLeaving(true);
    await signOut();
    setOpen(false);

    /* Home, not /login. Signing out is not a request to sign back in, and every
     * page is readable as a guest. */
    router.push("/");
  }

  // Not hydrated yet, or genuinely nobody: the same link either way.
  if (!ready || !user) {
    return (
      <Link
        href="/login"
        aria-label="Sign in"
        className={`hidden ${AVATAR} text-slate hover:text-ink lg:grid`}
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="12" cy="9" r="3.4" />
          <path d="M5.5 19.5a6.8 6.8 0 0113 0" strokeLinecap="round" />
        </svg>
      </Link>
    );
  }

  return (
    <div ref={wrapper} className="relative hidden shrink-0 lg:block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="account-menu"
        aria-label={`Account: ${user.username}`}
        className={`${AVATAR} bg-maroon font-display text-sm font-semibold uppercase text-card`}
      >
        {user.username.slice(0, 1)}
      </button>

      {open && (
        <div
          id="account-menu"
          className="absolute right-0 top-full z-40 mt-2 w-60 rounded-2xl border border-rule bg-card p-4 shadow-lg"
        >
          <p className="truncate font-display text-sm font-semibold text-ink">
            {user.username}
          </p>
          <p className="truncate text-xs text-muted">{user.email}</p>

          <Link
            href="/me/recipes"
            onClick={() => setOpen(false)}
            className="mt-4 block rounded-full border border-rule py-2 text-center font-display text-xs font-medium uppercase tracking-widest text-ink transition-colors hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon"
          >
            My recipes
          </Link>

          {/* Admins reach moderation and reporting through Django admin for now;
            * saying so beats a link to a route that does not exist yet. */}
          {user.role === "admin" && (
            <p className="mt-2 font-display text-xs font-medium uppercase tracking-widest text-maroon">
              Admin
            </p>
          )}

          <button
            type="button"
            onClick={handleSignOut}
            disabled={leaving}
            className="mt-2 w-full rounded-full border border-rule py-2 font-display text-xs font-medium uppercase tracking-widest text-maroon transition-colors hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon disabled:opacity-60"
          >
            {leaving ? "Signing out..." : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
