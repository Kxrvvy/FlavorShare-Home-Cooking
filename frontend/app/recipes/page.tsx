import type { Metadata } from "next";

import { AppShell } from "@/components/layout/AppShell";
import { ComingSoon } from "@/components/ui/ComingSoon";

export const metadata: Metadata = {
  title: "Explore | FlavorShare",
};

export default function ExploreRecipesPage() {
  return (
    <AppShell>
      <ComingSoon
        title="Explore recipes"
        blurb="Browsing, searching and filtering every published recipe will live here. For now the homepage is the place to look around."
      />
    </AppShell>
  );
}
