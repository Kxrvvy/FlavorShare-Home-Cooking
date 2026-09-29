import type { Metadata } from "next";

import { AppShell } from "@/components/layout/AppShell";
import { HelpCenter } from "@/components/help/HelpCenter";

export const metadata: Metadata = {
  title: "Help | FlavorShare",
};

/* hideSearch: Help has its own in-page keyword search over its own guides
 * and FAQ, so the global recipe-search box in the chrome would be a second,
 * unrelated search on the same page - the same reasoning
 * app/recipes/[id]/page.tsx gives for hiding it on a recipe's own page. */
export default function HelpPage() {
  return (
    <AppShell hideSearch>
      <HelpCenter />
    </AppShell>
  );
}
