import type { Metadata } from "next";

import { ComingSoon } from "@/components/ui/ComingSoon";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";

export const metadata: Metadata = {
  title: "Help | FlavorShare",
};

/* Brings its own header and footer: the root layout renders only {children},
 * so a page without them would strand the visitor with no navigation. */
export default function HelpPage() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        <ComingSoon
          title="Help"
          blurb="Guides for publishing a recipe, saving one, and building a meal plan are on the way."
        />
      </main>

      <SiteFooter />
    </>
  );
}
