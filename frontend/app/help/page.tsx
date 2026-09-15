import type { Metadata } from "next";

import { AppShell } from "@/components/layout/AppShell";
import { ComingSoon } from "@/components/ui/ComingSoon";

export const metadata: Metadata = {
  title: "Help | FlavorShare",
};

export default function HelpPage() {
  return (
    <AppShell>
      <ComingSoon
        title="Help"
        blurb="Guides for publishing a recipe, saving one, and building a meal plan are on the way."
      />
    </AppShell>
  );
}
