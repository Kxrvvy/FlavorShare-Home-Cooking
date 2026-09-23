"use client";

/* The full recipe, plus the numbers an admin needs before moderating it and
 * the two real actions available: Unpublish (soft - the author keeps the
 * recipe and can republish) and Feature/Unfeature. There is no approval
 * queue and no separate "removed" status - recipes only have draft and
 * published, so "Publish" is also how an admin restores one that was
 * previously unpublished.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { listAllComments } from "@/features/dashboard/api";
import {
  ApiError,
  getRecipe,
  latestImage,
  listIngredients,
  listRecipeTags,
  listSteps,
  publishRecipe,
  unpublishRecipe,
  updateRecipe,
  type IngredientRow,
  type RecipeRow,
  type StepRow,
} from "@/features/recipes/api";
import { RecipePreview } from "@/features/recipes/components/RecipePreview";
import { tagLabel } from "@/lib/categories";

type Loaded = {
  recipe: RecipeRow;
  steps: StepRow[];
  ingredients: IngredientRow[];
  tags: string[];
  commentCount: number;
};

export function AdminRecipeDetail({ recipeId }: { recipeId: number }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: Loaded }
  >({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [recipe, steps, ingredients, tagRows, commentPage] = await Promise.all([
          getRecipe(recipeId),
          listSteps(recipeId),
          listIngredients(recipeId),
          listRecipeTags(recipeId),
          listAllComments({ recipe: recipeId }),
        ]);
        if (cancelled) return;
        setState({
          status: "ready",
          data: {
            recipe,
            steps,
            ingredients,
            tags: tagRows.map((row) => tagLabel(row.tag.name)),
            commentCount: commentPage.count ?? 0,
          },
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            err instanceof ApiError && err.status === 404
              ? "This recipe does not exist."
              : "Could not load this recipe.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  async function toggleFeatured() {
    if (state.status !== "ready") return;
    const { recipe } = state.data;
    setBusy(true);
    setActionError("");
    try {
      const updated = await updateRecipe(recipe.recipe_id, { featured: !recipe.featured });
      setState({
        status: "ready",
        data: { ...state.data, recipe: { ...recipe, featured: updated.featured } },
      });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not change that.");
    } finally {
      setBusy(false);
    }
  }

  async function togglePublished() {
    if (state.status !== "ready") return;
    const { recipe } = state.data;
    const publishing = recipe.status === "draft";

    if (!publishing && !window.confirm(`Remove "${recipe.title}" from public view?`)) return;

    setBusy(true);
    setActionError("");
    try {
      if (publishing) {
        await publishRecipe(recipe.recipe_id);
        setState({
          status: "ready",
          data: { ...state.data, recipe: { ...recipe, status: "published" } },
        });
      } else {
        await unpublishRecipe(recipe.recipe_id);
        setState({
          status: "ready",
          data: { ...state.data, recipe: { ...recipe, status: "draft", featured: false } },
        });
      }
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : `Could not ${publishing ? "publish" : "unpublish"} that.`
      );
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading") {
    return <p className="text-sm text-muted">Loading...</p>;
  }

  if (state.status === "error") {
    return (
      <div>
        <p className="text-sm text-red-600">{state.message}</p>
        <Link
          href="/admin/recipes"
          className="mt-4 inline-block text-sm font-semibold text-maroon hover:underline"
        >
          Back to recipes
        </Link>
      </div>
    );
  }

  const { recipe, steps, ingredients, tags, commentCount } = state.data;
  const cover = latestImage(recipe.images, "final")?.url ?? null;

  return (
    <div>
      <Link
        href="/admin/recipes"
        className="text-sm font-semibold text-maroon hover:underline"
      >
        ← Back to recipes
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-rule bg-card p-4">
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
            recipe.status === "published" ? "bg-maroon/10 text-maroon" : "bg-ink/10 text-muted"
          }`}
        >
          {recipe.status}
        </span>
        {recipe.featured && (
          <span className="rounded-full bg-ember/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ember">
            Featured
          </span>
        )}
        <p className="text-sm text-muted">
          by{" "}
          {recipe.user ? (
            <Link href={`/admin/users/${recipe.user.user_id}`} className="font-semibold text-ink hover:underline">
              @{recipe.user.username}
            </Link>
          ) : (
            "unknown"
          )}
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {recipe.status === "published" && (
            <button
              type="button"
              disabled={busy}
              onClick={toggleFeatured}
              className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-ink disabled:opacity-50"
            >
              {busy ? "Working..." : recipe.featured ? "Unfeature" : "Feature"}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={togglePublished}
            className={`rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold disabled:opacity-50 ${
              recipe.status === "published" ? "text-maroon" : "text-ink"
            }`}
          >
            {busy ? "Working..." : recipe.status === "published" ? "Unpublish" : "Publish"}
          </button>
        </div>

        {actionError && (
          <p role="alert" className="w-full text-sm text-red-600">
            {actionError}
          </p>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-rule bg-card p-4 text-center">
          <p className="font-display text-xl font-semibold text-ink">
            {recipe.avg_score != null ? recipe.avg_score.toFixed(1) : "—"}
          </p>
          <p className="text-xs text-muted">Average rating</p>
        </div>
        <div className="rounded-2xl border border-rule bg-card p-4 text-center">
          <p className="font-display text-xl font-semibold text-ink">{recipe.save_count ?? 0}</p>
          <p className="text-xs text-muted">Saves</p>
        </div>
        <div className="rounded-2xl border border-rule bg-card p-4 text-center">
          <p className="font-display text-xl font-semibold text-ink">{commentCount}</p>
          <p className="text-xs text-muted">Reviews</p>
        </div>
        <div className="rounded-2xl border border-rule bg-card p-4 text-center">
          <p className="font-display text-xl font-semibold text-ink">{recipe.view_count ?? 0}</p>
          <p className="text-xs text-muted">Views</p>
        </div>
      </div>

      <div className="mt-8">
        <RecipePreview
          title={recipe.title}
          description={recipe.description ?? ""}
          servings={recipe.servings != null ? String(recipe.servings) : ""}
          prepTime={recipe.prep_time != null ? `${recipe.prep_time} min` : ""}
          cookTime={recipe.cook_time != null ? `${recipe.cook_time} min` : ""}
          cuisine={recipe.cuisine_type ?? ""}
          difficulty={recipe.difficulty ?? ""}
          cover={cover}
          tags={tags}
          ingredients={ingredients.map((row) => ({
            key: String(row.recipe_ingredient_id),
            quantity: row.quantity ?? "",
            unit: row.unit ?? "",
            name: row.ingredient.name,
          }))}
          steps={steps.map((row) => ({
            key: String(row.step_id),
            text: row.instruction,
            preview: row.images[0]?.url ?? null,
          }))}
          author={recipe.user?.username}
        />
      </div>
    </div>
  );
}
