import type { Metadata } from "next";

import { ComingSoon } from "@/components/ui/ComingSoon";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";

export const metadata: Metadata = {
  title: "Explore | FlavorShare",
};

/* Brings its own header and footer: the root layout renders only {children},
 * so a page without them would strand the visitor with no navigation. */
export default function ExploreRecipesPage() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        <ComingSoon
          title="Explore recipes"
          blurb="Browsing, searching and filtering every published recipe will live here. For now the homepage is the place to look around."
        />
      </main>

      <SiteFooter />
    </>
  );
}
