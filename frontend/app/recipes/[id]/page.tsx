import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/layout/AppShell";
import { RecipeDetail } from "@/features/recipes/components/RecipeDetail";

export const metadata: Metadata = {
  title: "Recipe | FlavorShare",
};

/* What the builder collects, rendered through the same RecipePreview it uses,
 * plus Ratings & Reviews and a Save button. Still not the full design - a
 * real author card needs User.bio and User.avatar_url, which do not exist
 * yet, and Nutrition stays deferred (no provider found yet with a free tier
 * that actually includes calories) - but everything else the original stub
 * deferred (Step.title, Recipe.equipment, Recipe.body) is real now.
 *
 * No sign-in gate: guests can read a published recipe, same as the homepage.
 * RecipeDetail hides the write actions itself for anyone who is not signed
 * in as a registered user.
 *
 * hideSearch: searching for another recipe makes little sense while reading
 * one, and RecipeDetail's own "Back to recipes" link is the way out instead.
 */
export default async function RecipeDetailPage({
  params,
}: PageProps<"/recipes/[id]">) {
  const { id } = await params;
  const recipeId = Number(id);

  if (!Number.isInteger(recipeId) || recipeId <= 0) notFound();

  return (
    <AppShell hideSearch>
      <div className="mx-auto w-full max-w-[1100px] px-5 py-10 lg:px-6 lg:py-14">
        <RecipeDetail recipeId={recipeId} />
      </div>
    </AppShell>
  );
}
