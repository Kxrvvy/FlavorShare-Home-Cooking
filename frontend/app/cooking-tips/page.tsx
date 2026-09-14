import type { Metadata } from "next";

import { ComingSoon } from "@/components/ui/ComingSoon";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";

export const metadata: Metadata = {
  title: "Cooking Tips | FlavorShare",
};

/* Brings its own header and footer: the root layout renders only {children},
 * so a page without them would strand the visitor with no navigation. */
export default function CookingTipsPage() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        <ComingSoon
          title="Cooking tips"
          blurb="Technique notes and kitchen advice from the FlavorShare community will be collected here."
        />
      </main>

      <SiteFooter />
    </>
  );
}
