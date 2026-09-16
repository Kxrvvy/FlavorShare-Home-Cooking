import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { RecipeDetail } from "@/features/recipes/components/RecipeDetail";

export const metadata: Metadata = {
  title: "Recipe | FlavorShare",
};

/* The minimal version of this page: what the builder already collects,
 * rendered through the same RecipePreview it uses, plus Ratings & Reviews and
 * a Save button. Not the full redesign - that one needs Step.title,
 * Recipe.equipment, Recipe.body, User.bio and User.avatar_url, none of which
 * exist yet - but Ratings & Reviews had nowhere to attach to without this
 * much existing first.
 *
 * No sign-in gate: guests can read a published recipe, same as the homepage.
 * RecipeDetail hides the write actions itself for anyone who is not signed
 * in as a registered user.
 */
export default async function RecipeDetailPage({
  params,
}: PageProps<"/recipes/[id]">) {
  const { id } = await params;
  const recipeId = Number(id);

  if (!Number.isInteger(recipeId) || recipeId <= 0) notFound();

  return (
    <AppShell>
      <RecipeDetail recipeId={recipeId} />
    </AppShell>
  );
}
