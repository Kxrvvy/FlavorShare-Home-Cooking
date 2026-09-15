import type { Metadata } from "next";

import { AppShell } from "@/components/layout/AppShell";
import { ComingSoon } from "@/components/ui/ComingSoon";

export const metadata: Metadata = {
  title: "Cooking Tips | FlavorShare",
};

export default function CookingTipsPage() {
  return (
    <AppShell>
      <ComingSoon
        title="Cooking tips"
        blurb="Technique notes and kitchen advice from the FlavorShare community will be collected here."
      />
    </AppShell>
  );
}
