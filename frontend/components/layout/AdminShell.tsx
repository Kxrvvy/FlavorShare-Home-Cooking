"use client";

/* The admin panel's own frame - deliberately not AppShell.
 *
 * AppShell's nav is Home/Explore/My recipes and its header carries a search
 * box for browsing recipes: the normal-user experience this panel exists to
 * manage, not to be another instance of. An admin reaches this shell through
 * one link in AccountMenu and everything inside it is a different app in
 * function, so it gets a different frame - its own header (page title, who
 * is signed in, a way back to the site) and its own sidebar (the sections
 * from CLAUDE.md's Admin role, nothing else).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { useSession } from "@/lib/useSession";

const NAV = [
  { label: "Dashboard", href: "/admin/dashboard" },
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
 * has loaded. */
function currentTitle(pathname: string) {
  return NAV.find((item) => isActive(pathname, item.href))?.label ?? "Admin";
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useSession();
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

        <div className="border-t border-rule p-4">
          <Link
            href="/"
            className="block rounded-xl px-3 py-2.5 font-display text-sm font-medium text-slate transition-colors hover:bg-panel/60 hover:text-ink"
          >
            Back to site
          </Link>
          <button
            type="button"
            onClick={() => signOut()}
            className="block w-full rounded-xl px-3 py-2.5 text-left font-display text-sm font-medium text-maroon transition-colors hover:bg-panel/60"
          >
            Logout
          </button>
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

          {user && (
            <div className="flex shrink-0 items-center gap-2 text-right">
              <div className="hidden sm:block">
                <p className="font-display text-sm font-semibold text-ink">
                  @{user.username}
                </p>
                <p className="text-xs uppercase tracking-wide text-muted">{user.role}</p>
              </div>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-maroon font-display text-sm font-semibold uppercase text-card">
                {user.username.slice(0, 1)}
              </span>
            </div>
          )}
        </header>

        {open && (
          <div
            id="admin-drawer"
            className="border-b border-rule bg-canvas px-5 pb-6 pt-2 shadow-lg lg:hidden"
          >
            <SidebarLinks onNavigate={() => setOpen(false)} />
            <div className="mt-4 border-t border-rule pt-4">
              <Link
                href="/"
                onClick={() => setOpen(false)}
                className="block rounded-xl px-3 py-2.5 font-display text-sm font-medium text-slate hover:bg-panel/60"
              >
                Back to site
              </Link>
              <button
                type="button"
                onClick={() => signOut()}
                className="block w-full rounded-xl px-3 py-2.5 text-left font-display text-sm font-medium text-maroon hover:bg-panel/60"
              >
                Logout
              </button>
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 px-5 py-8 lg:px-8 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
