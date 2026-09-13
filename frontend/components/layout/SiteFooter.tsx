import Link from "next/link";

import { Logo } from "@/components/ui/Logo";

/* The footer also differs between the two exports rather than simply wrapping:
 * desktop puts the links in one horizontal row beside the mark, mobile stacks
 * them as a divided list with the mark centred above.
 */

const LINKS = [
  { label: "Home", href: "/" },
  { label: "Recipes", href: "/recipes" },
  { label: "Cooking Tips", href: "/cooking-tips" },
  { label: "About Us", href: "/about" },
];

export function SiteFooter() {
  return (
    <footer className="mt-16 bg-ink text-card lg:mt-24">
      <div className="mx-auto w-full max-w-[1320px] px-5 py-10 lg:px-6 lg:py-8">
        {/* Mobile */}
        <div className="lg:hidden">
          <div className="flex justify-center">
            <Logo tone="cream" />
          </div>

          <nav className="mt-6">
            <ul className="flex flex-col">
              {LINKS.map((link) => (
                <li key={link.label} className="border-b border-card/15">
                  <Link
                    href={link.href}
                    className="block py-3.5 font-display text-[11px] font-medium uppercase tracking-widest text-card/90"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mt-7 flex justify-center">
            <SocialLinks />
          </div>
        </div>

        {/* Desktop */}
        <div className="hidden items-center justify-between gap-8 lg:flex">
          <Logo tone="cream" />

          <nav>
            <ul className="flex items-center gap-8">
              {LINKS.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="font-display text-[11px] font-medium uppercase tracking-widest text-card/90 transition-colors hover:text-card"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <SocialLinks />
        </div>
      </div>

      <div className="border-t border-card/15">
        <p className="mx-auto w-full max-w-[1320px] px-5 py-5 text-center text-[10px] uppercase tracking-widest text-card/60 lg:px-6">
          Copyright: © 2026 Flavor Share.
        </p>
      </div>
    </footer>
  );
}

function SocialLinks() {
  return (
    <ul className="flex items-center gap-3">
      <li>
        <a
          href="https://facebook.com"
          aria-label="FlavorShare on Facebook"
          className="grid h-8 w-8 place-items-center rounded-full bg-card text-ink transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-card"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="currentColor">
            <path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5h1.65V3.6A22 22 0 0014.3 3.5c-2.4 0-4 1.45-4 4.1v2.3H7.6V13h2.7v8z" />
          </svg>
        </a>
      </li>
      <li>
        <a
          href="https://instagram.com"
          aria-label="FlavorShare on Instagram"
          className="grid h-8 w-8 place-items-center rounded-full bg-card text-ink transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-card"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
          >
            <rect x="4" y="4" width="16" height="16" rx="4.5" />
            <circle cx="12" cy="12" r="3.4" />
            <circle cx="16.6" cy="7.4" r="1" fill="currentColor" stroke="none" />
          </svg>
        </a>
      </li>
    </ul>
  );
}
