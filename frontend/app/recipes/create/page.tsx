import type { Metadata } from "next";
import { RequireSignIn } from "@/components/auth/RequireSignIn";
import CreateRecipeForm from "@/features/recipes/components/CreateRecipeForm";

export const metadata: Metadata = {
  title: "Create Recipe | FlavorShare",
};

/* Stays a Server Component so the title above is still static metadata; only the
 * gate needs to know who you are. */
export default function CreateRecipePage() {
  return (
    <main className="min-h-screen bg-white">
      <RequireSignIn next="/recipes/create" action="create a recipe">
        <CreateRecipeForm />
      </RequireSignIn>
    </main>
  );
}
