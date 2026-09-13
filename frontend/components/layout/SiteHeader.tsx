import Link from "next/link";

import { MobileMenu, SearchField } from "@/components/layout/MobileMenu";
import { Logo } from "@/components/ui/Logo";

/* The header is two different headers, which is why this is not one layout
 * stacked responsively:
 *
 *   desktop - hamburger, search, nav links, profile. No logo at all.
 *   mobile  - logo and hamburger. No search, no nav, no profile.
 *
 * Both are in the Figma export. Rendering the desktop one and letting it wrap
 * would put a search field and three nav links on a 375px screen that the
 * design deliberately moves into the menu.
 *
 * A Server Component. Only the menu toggle needs to be interactive.
 */

const NAV = [
  { label: "Home", href: "/", active: true },
  { label: "Explore", href: "/recipes", active: false },
  { label: "Help", href: "/help", active: false },
];

export function SiteHeader() {
  return (
    <header className="relative bg-canvas">
      <div className="mx-auto flex w-full max-w-[1320px] items-center gap-6 px-5 py-4 lg:px-6 lg:py-6">
        {/* Mobile: logo left, hamburger right. */}
        <div className="flex flex-1 items-center justify-between lg:hidden">
          <Link href="/" aria-label="FlavorShare home">
            <Logo />
          </Link>
          <MobileMenu />
        </div>

        {/* Desktop. */}
        <button
          type="button"
          aria-label="Open menu"
          className="hidden h-10 w-10 shrink-0 place-items-center text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon lg:grid"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 7h16" />
            <path d="M4 12h16" />
            <path d="M4 17h16" />
          </svg>
        </button>

        <div className="hidden min-w-0 flex-1 justify-center lg:flex">
          <div className="w-full max-w-[470px]">
            <SearchField />
          </div>
        </div>

        <nav className="hidden lg:block">
          <ul className="flex items-center gap-9">
            {NAV.map((item) => (
              <li key={item.label}>
                <Link
                  href={item.href}
                  aria-current={item.active ? "page" : undefined}
                  className={`font-display text-sm transition-colors ${
                    item.active
                      ? "font-semibold text-maroon"
                      : "font-medium text-slate hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Auth is a separate task - this links to the login route so the
         * control is not a dead element, but nothing here knows who you are. */}
        <Link
          href="/login"
          aria-label="Account"
          className="hidden h-11 w-11 shrink-0 place-items-center rounded-full border border-rule text-slate transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon lg:grid"
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
      </div>
    </header>
  );
}
