import type { Metadata } from "next";

import { AppShell } from "@/components/layout/AppShell";
import { ComingSoon } from "@/components/ui/ComingSoon";

export const metadata: Metadata = {
  title: "About Us | FlavorShare",
};

export default function AboutPage() {
  return (
    <AppShell>
      <ComingSoon
        title="About FlavorShare"
        blurb="Who built this and why it exists. Still being written."
      />
    </AppShell>
  );
}
