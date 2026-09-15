import type { Metadata } from "next";

import { AppShell } from "@/components/layout/AppShell";
import { ComingSoon } from "@/components/ui/ComingSoon";

export const metadata: Metadata = {
  title: "Recipe | FlavorShare",
};

/* Every recipe card links here, so without this page the most-clicked element
 * on the homepage is a 404. The real detail page needs five model fields that
 * do not exist yet - Step.title, Recipe.equipment, Recipe.body, User.bio and
 * User.avatar_url - so it is a separate piece of work, not a stub to fill in.
 */
export default function RecipeDetailPage() {
  return (
    <AppShell>
      <ComingSoon
        title="Recipe pages are on the way"
        blurb="The full recipe - ingredients, steps, photos and nutrition - will open here. Until then the homepage shows what has been published."
      />
    </AppShell>
  );
}
