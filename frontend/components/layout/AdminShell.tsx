"use client";

/* The admin panel's own frame - deliberately not AppShell.
 *
 * AppShell's nav is Home/Explore/My recipes and its header carries a search
 * box for browsing recipes: the normal-user experience this panel exists to
 * manage, not to be another instance of. An admin reaches this shell through
 * one link in AccountMenu and everything inside it is a different app in
 * function, so it gets a different frame - its own header and its own
 * sidebar (the sections from CLAUDE.md's Admin role, nothing else).
 *
 * The sidebar's NAV is content sections only - Settings is not one, the same
 * reason AppShell's own nav never lists it: it is about the signed-in admin's
 * account, not a thing to moderate. It lives in AdminAccountMenu below, next
 * to Back to site and Log out, all three reached the one way an account's own
 * settings and sign-out belong together instead of scattered across a header
 * chip, a sidebar link and a sidebar footer button - which is what this shell
 * used to do. AdminAccountMenu mirrors AccountMenu's own click-to-open,
 * click-outside-to-close popover on purpose: it is the same idea (an avatar
 * that opens onto the account), not a second one invented for this panel.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useSession } from "@/lib/useSession";

const NAV = [
  { label: "Dashboard", href: "/admin/dashboard" },
  { label: "Reports", href: "/admin/reports" },
  { label: "Users", href: "/admin/users" },
  { label: "Recipes", href: "/admin/recipes" },
  { label: "Comments", href: "/admin/comments" },
  { label: "Categories", href: "/admin/categories" },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav>
      <ul className="flex flex-col gap-1">
        {NAV.map((item) => {
          const current = isActive(pathname, item.href);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={current ? "page" : undefined}
                className={`block rounded-xl px-3 py-2.5 font-display text-sm transition-colors ${
                  current
                    ? "bg-panel font-semibold text-maroon"
                    : "font-medium text-slate hover:bg-panel/60 hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** "Dashboard" for /admin/dashboard, "Recipes" for /admin/recipes/42 - the
 * header's title tracks whichever section owns the current path, not the
 * exact page, since a detail page has no title of its own until its data
 * has loaded. Settings is checked on its own, not added to NAV, since NAV is
 * the sidebar's content-section list and Settings is not a content section -
 * see the module docstring. */
function currentTitle(pathname: string) {
  if (isActive(pathname, "/admin/settings")) return "Settings";
  return NAV.find((item) => isActive(pathname, item.href))?.label ?? "Admin";
}

/** The one account control: an avatar that opens onto Settings, a way back
 * to the site, and signing out - together, where AccountMenu's own users
 * already expect an avatar to lead. Used in the header on every breakpoint,
 * so unlike SidebarLinks there is no separate mobile-drawer copy to keep in
 * sync with this one. */
function AdminAccountMenu() {
  const pathname = usePathname();
  const { user, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

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

  if (!user) return null;

  return (
    <div ref={wrapper} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="admin-account-menu"
        aria-label={`Account: ${user.username}`}
        className="flex items-center gap-2.5 rounded-full py-1 pl-2 pr-1 transition-colors hover:bg-panel/60"
      >
        <span className="hidden text-right sm:block">
          <span className="block font-display text-sm font-semibold text-ink">
            @{user.username}
          </span>
          <span className="block text-xs uppercase tracking-wide text-muted">{user.role}</span>
        </span>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-maroon font-display text-sm font-semibold uppercase text-card">
          {user.username.slice(0, 1)}
        </span>
      </button>

      {open && (
        <div
          id="admin-account-menu"
          className="absolute right-0 top-full z-40 mt-2 w-60 rounded-2xl border border-rule bg-card p-2 shadow-lg"
        >
          <div className="px-3 py-2">
            <p className="truncate font-display text-sm font-semibold text-ink">
              @{user.username}
            </p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>

          <div className="my-1 border-t border-rule" />

          <Link
            href="/admin/settings"
            onClick={() => setOpen(false)}
            aria-current={isActive(pathname, "/admin/settings") ? "page" : undefined}
            className={`block rounded-xl px-3 py-2 font-display text-sm transition-colors ${
              isActive(pathname, "/admin/settings")
                ? "bg-panel font-semibold text-maroon"
                : "font-medium text-ink hover:bg-panel"
            }`}
          >
            Settings
          </Link>
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="block rounded-xl px-3 py-2 font-display text-sm font-medium text-slate transition-colors hover:bg-panel"
          >
            Back to site
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            className="block w-full rounded-xl px-3 py-2 text-left font-display text-sm font-medium text-maroon transition-colors hover:bg-panel"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="hidden w-64 shrink-0 border-r border-rule bg-canvas lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="px-5 py-6">
          <p className="font-display text-lg font-bold uppercase tracking-wide text-ink">
            Admin panel
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <SidebarLinks />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-rule bg-canvas px-5 py-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="admin-drawer"
              aria-label={open ? "Close menu" : "Open menu"}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-rule text-ink lg:hidden"
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

            <h1 className="truncate font-display text-lg font-semibold text-ink lg:text-xl">
              {currentTitle(pathname)}
            </h1>
          </div>

          <AdminAccountMenu />
        </header>

        {open && (
          <div
            id="admin-drawer"
            className="border-b border-rule bg-canvas px-5 pb-6 pt-2 shadow-lg lg:hidden"
          >
            <SidebarLinks onNavigate={() => setOpen(false)} />
          </div>
        )}

        <main className="min-w-0 flex-1 px-5 py-8 lg:px-8 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
