import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RequireSignIn } from "@/components/auth/RequireSignIn";
import RecipeBuilder from "@/features/recipes/components/RecipeBuilder";

export const metadata: Metadata = {
  title: "Edit Recipe | FlavorShare",
};

/* The same builder as /recipes/create, opened on a recipe that already exists.
 *
 * One editor, two routes: creating is just editing a recipe whose first save
 * has not happened yet. RecipeBuilder loads the rows itself through
 * ?recipe=<id>, so there is nothing here but the id and the sign-in gate.
 *
 * Whether this recipe is *yours* is not decided here and cannot be. The session
 * lives in localStorage, so the id is checked by the API, which answers 404 for
 * somebody else's draft - visible_recipes() never returns it - and the builder
 * shows that as "Could not open this recipe." A server-side check would need
 * the token, which the server does not have.
 */
export default async function EditRecipePage({
  params,
}: PageProps<"/recipes/[id]/edit">) {
  const { id } = await params;
  const recipeId = Number(id);

  // "/recipes/banana/edit" is not a recipe, and asking the API about it would
  // only produce a confusing error further in.
  if (!Number.isInteger(recipeId) || recipeId <= 0) notFound();

  return (
    <main className="min-h-screen bg-white">
      <RequireSignIn next={`/recipes/${recipeId}/edit`} action="edit a recipe">
        <RecipeBuilder recipeId={recipeId} />
      </RequireSignIn>
    </main>
  );
}
