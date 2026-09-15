"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { AccountMenu } from "@/components/layout/AccountMenu";
import { SearchField } from "@/components/layout/SearchField";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { useCollectionCounts } from "@/features/recipes/useCollectionCounts";
import { Logo } from "@/components/ui/Logo";
import {
  isSidebarCollapsed,
  setSidebarCollapsed,
  sidebarServerSnapshot,
  subscribeToSidebar,
} from "@/lib/sidebar";

/* The frame every page inside the app sits in.
 *
 * A left sidebar rather than the top header this replaces. On a phone there is
 * no room for a rail, so the same nav becomes a drawer behind a hamburger - the
 * open/close and Escape handling came from MobileMenu, which this retires along
 * with SiteHeader.
 *
 * A component rather than a route-group layout, because app/layout.tsx renders
 * only {children} and every page already brings its own chrome. Keeping that
 * shape means no route folders move, and the auth pages - full-bleed background
 * designs that must not have a sidebar - simply do not use this.
 */

/* `active` is a predicate rather than a prefix test, because prefixes get this
 * wrong: /recipes/create starts with /recipes, so Explore lit up while you were
 * writing a recipe. Building and editing belong to My recipes; Explore covers
 * browsing and reading. */
const NAV = [
  {
    label: "Home",
    href: "/",
    active: (p: string) => p === "/",
    icon: "M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z",
  },
  {
    label: "Explore",
    href: "/recipes",
    active: (p: string) => p === "/recipes" || /^\/recipes\/\d+$/.test(p),
    icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm5.5 12.5L21 21",
  },
  {
    label: "My recipes",
    href: "/me/recipes",
    active: (p: string) =>
      p.startsWith("/me/recipes") ||
      p === "/recipes/create" ||
      /^\/recipes\/\d+\/edit$/.test(p),
    icon: "M6 4h11a1 1 0 0 1 1 1v15l-6-3-6 3V5a1 1 0 0 1 1-1z",
  },
];

/* Help sits at the foot of the rail rather than in the nav above. It is not
 * somewhere you go to do the thing you came for - it is where you go when
 * something else did not work, which is what the bottom of a sidebar is for. */
const HELP = {
  label: "Help",
  href: "/help",
  active: (p: string) => p.startsWith("/help"),
  icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 13.5v.01M12 14c0-2 2.2-2.2 2.2-4A2.2 2.2 0 0 0 9.8 10",
};

type NavItem = (typeof NAV)[number];

function NavLinks({
  onNavigate,
  collapsed = false,
  items = NAV,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  items?: NavItem[];
}) {
  const pathname = usePathname();

  return (
    <nav>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const current = item.active(pathname);

          return (
            <li key={item.label}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={current ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-xl py-2.5 font-display text-sm transition-colors ${
                  collapsed ? "justify-center px-0" : "px-3"
                } ${
                  current
                    ? "bg-panel font-semibold text-maroon"
                    : "font-medium text-slate hover:bg-panel/60 hover:text-ink"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-5 w-5 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={item.icon} />
                </svg>
                {/* The label is kept for screen readers when it is not drawn,
                  * so a collapsed rail is still navigable without sight. */}
                <span className={collapsed ? "sr-only" : undefined}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type ShellProps = {
  children: ReactNode;
  /* A page's own top-right control, rendered on the same line as the search.
   * A slot rather than something the shell decides, so Create Recipe belongs to
   * the homepage that shows it instead of to the chrome of every page. */
  action?: ReactNode;
  /* "editor" drops the search box and the footer. The builder is a workspace,
   * not a page to browse from: searching for another recipe mid-write is not
   * the job, and a footer of marketing links under a half-written recipe is
   * noise. The nav stays, so there is still a way out. */
  variant?: "app" | "editor";
};

/* The views of My recipes, shown beneath it rather than as a group of their
 * own. As a separate group one of them was "Your Recipes" while the nav above
 * already had "My recipes" - two names for one page. Nested, they read as what
 * they are: one destination and the ways of looking at it.
 */
const COLLECTION = [
  { label: "All", show: "all", icon: "M4 6h16M4 12h16M4 18h16" },
  { label: "Saved", show: "saved", icon: "M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1z" },
  { label: "Your recipes", show: "mine", icon: "M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0" },
  { label: "Published", show: "published", icon: "M12 4v12m0-12l-4 4m4-4l4 4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" },
] as const;

function countLabel(count: number) {
  return `${count} ${count === 1 ? "recipe" : "recipes"}`;
}

function CollectionLinks({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const show = useSearchParams().get("show") ?? "all";
  const counts = useCollectionCounts();
  const here = pathname.startsWith("/me/recipes");

  // Collapsed there is no room for a second level, and four more icons would
  // say less than the one they sit under.
  if (collapsed) return null;

  return (
    <ul className="mt-1 flex flex-col gap-1">
      {COLLECTION.map((item) => {
        const current = here && show === item.show;

        return (
          <li key={item.show}>
            <Link
              href={`/me/recipes?show=${item.show}`}
              onClick={onNavigate}
              aria-current={current ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 font-display text-sm transition-colors ${
                current
                  ? "bg-panel font-semibold text-maroon"
                  : "font-medium text-slate hover:bg-panel/60 hover:text-ink"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="h-5 w-5 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={item.icon} />
              </svg>

              <span className="min-w-0">
                <span className="block truncate">{item.label}</span>
                {/* Nothing rather than "0 recipes" while the two lists are still
                  * in flight - a count that corrects itself reads as a bug. */}
                {counts && (
                  <span className="block text-xs font-normal text-muted">
                    {countLabel(counts[item.show])}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AppShell({ children, action, variant = "app" }: ShellProps) {
  const editor = variant === "editor";
  /* A drawer left open behind a navigation is one you have to dismiss twice, so
   * every link inside it closes the drawer itself through onNavigate. Watching
   * the pathname in an effect would do the same job by setting state during a
   * render pass, which is the cascading-render the compiler warns about. */
  const [open, setOpen] = useState(false);

  /* Read through useSyncExternalStore so the first render matches the server's
   * - see lib/sidebar.ts. Collapsing is a desktop idea; the phone drawer is
   * either open or not. */
  const collapsed = useSyncExternalStore(
    subscribeToSidebar,
    isSidebarCollapsed,
    sidebarServerSnapshot
  );

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
      {/* Desktop rail. Sticky rather than fixed, so the footer below the content
        * column is still reachable without the sidebar overlapping it. */}
      <aside
        className={`hidden shrink-0 border-r border-rule bg-canvas lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col ${
          collapsed ? "w-[4.5rem]" : "w-64"
        }`}
      >
        {/* Collapsed, the toggle sits above the mark: it is the one control
          * that is always in the same place, and hunting for it below a stack
          * of icons is worse than seeing it first. */}
        <div
          className={`flex items-center gap-2 py-6 ${
            collapsed ? "flex-col-reverse px-3" : "justify-between px-5"
          }`}
        >
          <Link href="/" aria-label="FlavorShare home">
            {collapsed ? <Logo mark /> : <Logo />}
          </Link>

          <button
            type="button"
            onClick={() => setSidebarCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-panel hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {collapsed ? (
                <>
                  <path d="M7 6l6 6-6 6" />
                  <path d="M13 6l6 6-6 6" />
                </>
              ) : (
                <>
                  <path d="M17 6l-6 6 6 6" />
                  <path d="M11 6l-6 6 6 6" />
                </>
              )}
            </svg>
          </button>
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto ${collapsed ? "px-3" : "px-4"}`}>
          <NavLinks collapsed={collapsed} />
          {/* useSearchParams needs a boundary above it or a statically
            * prerendered page fails to build. Putting it here rather than in
            * every page means the shell keeps its own requirement to itself. */}
          <Suspense fallback={null}>
            <CollectionLinks collapsed={collapsed} />
          </Suspense>
        </div>

        <div className={collapsed ? "px-3 pb-1" : "px-4 pb-1"}>
          <NavLinks collapsed={collapsed} items={[HELP]} />
        </div>

        {/* Deliberately the quietest thing in the rail: it is a status and a
          * way out, not somewhere you navigate to, so it takes the smallest
          * row and the least padding of anything here. */}
        <div className={`border-t border-rule ${collapsed ? "p-1" : "p-1.5"}`}>
          <AccountMenu variant="sidebar" compact={collapsed} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone bar: the mark and the hamburger, nothing else - the rest is in
          * the drawer, as the old mobile header did it. */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-rule bg-canvas px-5 py-3 lg:hidden">
          <Link href="/" aria-label="FlavorShare home">
            <Logo />
          </Link>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="app-drawer"
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid h-11 w-11 place-items-center rounded-full border border-rule text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon"
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
        </header>

        {open && (
          <div
            id="app-drawer"
            className="border-b border-rule bg-canvas px-5 pb-6 pt-4 shadow-lg lg:hidden"
          >
            {!editor && <SearchField onSubmitted={() => setOpen(false)} />}

            <div className="mt-4">
              <NavLinks onNavigate={() => setOpen(false)} />
              <Suspense fallback={null}>
                <CollectionLinks onNavigate={() => setOpen(false)} />
              </Suspense>

              <div className="mt-6">
                <NavLinks onNavigate={() => setOpen(false)} items={[HELP]} />
              </div>
            </div>

            <div className="mt-4 border-t border-rule pt-2">
              <AccountMenu variant="sidebar" onNavigate={() => setOpen(false)} />
            </div>
          </div>
        )}

        {!editor && (
          <div
            className={`items-center gap-4 px-5 lg:flex lg:px-6 lg:py-6 ${
              action ? "flex py-5" : "hidden"
            }`}
          >
            <div className="hidden min-w-0 max-w-[470px] flex-1 lg:block">
              <SearchField />
            </div>

            {action && <div className="ml-auto">{action}</div>}
          </div>
        )}

        {/* pt on phones only: on a wide screen the search block above already
          * provides the gap, and the builder brings its own. */}
        <main className={`min-w-0 flex-1 lg:pt-0 ${action ? "" : "pt-5"}`}>{children}</main>

        {!editor && <SiteFooter />}
      </div>
    </div>
  );
}
