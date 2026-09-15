import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { RequireSignIn } from "@/components/auth/RequireSignIn";
import RecipeBuilder from "@/features/recipes/components/RecipeBuilder";

export const metadata: Metadata = {
  title: "Create Recipe | FlavorShare",
};

/* Stays a Server Component so the title above is still static metadata; only the
 * gate needs to know who you are. */
export default function CreateRecipePage() {
  return (
    <AppShell variant="editor">
      <RequireSignIn next="/recipes/create" action="create a recipe">
        <RecipeBuilder />
      </RequireSignIn>
    </AppShell>
  );
}
