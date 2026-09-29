import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "About Us | FlavorShare",
};

/* What FlavorShare is and the problem it exists to solve - grounded in the
 * project's actual Problem Statement and Target Users (CLAUDE.md), written
 * in plain, user-facing terms rather than that document's own project-planning
 * language. No team/attribution section by design: nothing here is invented.
 *
 * A server component, unlike Help - there is no search box or accordion
 * state here, so there is no reason to split this into its own client
 * component the way HelpCenter was.
 */
export default function AboutPage() {
  return (
    // hideSearch: this is a page to read, not to browse recipes from - the
    // same reasoning the recipe detail and Help pages give for dropping the
    // global search box.
    <AppShell hideSearch>
      <div className="mx-auto w-full max-w-[760px] px-5 py-10 lg:px-6 lg:py-14">
        <p className="font-display text-xs font-semibold uppercase tracking-widest text-maroon">
          About
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold text-ink lg:text-4xl">
          About FlavorShare
        </h1>
        <p className="mt-4 max-w-prose text-sm text-muted lg:text-base">
          FlavorShare is a place to publish, find, and keep track of recipes that actually
          work - shared by people cooking them, not scraped from somewhere else.
        </p>

        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold text-ink">The problem</h2>
          <div className="mt-3 flex flex-col gap-3">
            <p className="max-w-prose text-sm text-muted lg:text-base">
              Most people&apos;s recipes end up scattered - a screenshot here, a bookmarked blog
              post there, a photo of a handwritten card, a video they half-remember. Finding
              one again later, or a reliable one someone you trust actually cooked, means
              digging back through all of that.
            </p>
            <p className="max-w-prose text-sm text-muted lg:text-base">
              Planning meals makes it worse: pulling a week&apos;s worth of dinners out of recipes
              spread across that many sources is its own separate mess, before you&apos;ve even
              started cooking.
            </p>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold text-ink">Who it&apos;s for</h2>
          <p className="mt-3 max-w-prose text-sm text-muted lg:text-base">
            Home cooks who want one place to keep what they cook. Food bloggers who want
            somewhere to actually publish a recipe, not just write a post about one. Anyone
            cooking around a dietary goal, trying to find and plan meals that fit it.
          </p>
        </section>

        <section className="mt-10 border-t border-rule pt-8">
          <h2 className="font-display text-xl font-semibold text-ink">What&apos;s here</h2>
          <ul className="mt-3 flex flex-col gap-2.5 text-sm text-muted lg:text-base">
            <li>
              Publish a recipe with real ingredients, steps, and photos - not one block of
              text.
            </li>
            <li>Save recipes you find into your own collection.</li>
            <li>Rate and review recipes you&apos;ve tried.</li>
            <li>Build a meal plan out of recipes you&apos;ve saved or published.</li>
            <li>Search and filter to find something specific.</li>
          </ul>
          <p className="mt-4 text-sm text-muted">
            For the how-to on any of this, see the{" "}
            <Link href="/help" className="text-maroon underline-offset-4 hover:underline">
              Help center
            </Link>
            .
          </p>
        </section>
      </div>
    </AppShell>
  );
}
