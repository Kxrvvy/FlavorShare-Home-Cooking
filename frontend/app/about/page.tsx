import type { Metadata } from "next";

import { ComingSoon } from "@/components/ui/ComingSoon";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";

export const metadata: Metadata = {
  title: "About Us | FlavorShare",
};

/* Brings its own header and footer: the root layout renders only {children},
 * so a page without them would strand the visitor with no navigation. */
export default function AboutPage() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        <ComingSoon
          title="About FlavorShare"
          blurb="Who built this and why it exists. Still being written."
        />
      </main>

      <SiteFooter />
    </>
  );
}
