"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { RequireSignIn } from "@/components/auth/RequireSignIn";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import {
  ApiError,
  deleteRecipe,
  listMyRecipes,
  publishRecipe,
  unpublishRecipe,
  type RecipeRow,
} from "@/features/recipes/api";
import { getAccessToken } from "@/lib/auth";
import { useSession } from "@/lib/useSession";

/* Everything you have written, published or not.
 *
 * This exists because a draft had nowhere to be seen from. A submit that failed
 * part way left a real recipe on the server, and the builder - the only page
 * that could reach it - had already moved on. Two separate bugs ended at the
 * same gap: no page listed your own work.
 *
 * Drafts are yours alone. visible_recipes() hides them from everyone else, so
 * ?user=<your id> returns them here and the same parameter on somebody else's
 * id returns only what they published.
 */

type Busy = { id: number; action: "publish" | "unpublish" | "delete" } | null;

function statusChip(status: RecipeRow["status"]) {
  return status === "published"
    ? "bg-maroon/10 text-maroon"
    : "bg-ink/10 text-muted";
}

function MyRecipesList() {
  const { user } = useSession();
  const [recipes, setRecipes] = useState<RecipeRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [rowError, setRowError] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!user || !token) return;

    try {
      setRecipes(await listMyRecipes(user.user_id, token));
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your recipes.");
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  /* One row's failure stays on that row. The list is reloaded after a change
   * rather than patched in place, so what is on screen is what the server
   * holds - worth a round trip on a page this size. */
  async function act(recipe: RecipeRow, action: NonNullable<Busy>["action"]) {
    const token = getAccessToken();
    if (!token) return;

    if (action === "delete") {
      const ok = window.confirm(
        `Delete "${recipe.title}"? This cannot be undone.`
      );
      if (!ok) return;
    }

    setBusy({ id: recipe.recipe_id, action });
    setRowError((current) => ({ ...current, [recipe.recipe_id]: "" }));

    try {
      if (action === "publish") await publishRecipe(recipe.recipe_id, token);
      if (action === "unpublish") await unpublishRecipe(recipe.recipe_id, token);
      if (action === "delete") await deleteRecipe(recipe.recipe_id, token);
      await load();
    } catch (err) {
      setRowError((current) => ({
        ...current,
        [recipe.recipe_id]:
          err instanceof ApiError ? err.message : "That did not work.",
      }));
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <p className="rounded-2xl border border-rule bg-card p-6 text-sm text-muted">
        {error}
      </p>
    );
  }

  if (recipes === null) {
    return <p className="text-sm text-muted">Loading your recipes...</p>;
  }

  if (recipes.length === 0) {
    return (
      <div className="rounded-2xl border border-rule bg-card p-10 text-center">
        <p className="font-display text-lg font-semibold text-ink">
          You have not written a recipe yet
        </p>
        <p className="mt-2 text-sm text-muted">
          Anything you start will appear here, published or not.
        </p>
        <Link
          href="/recipes/create"
          className="mt-6 inline-block rounded-full bg-maroon px-6 py-3 font-display text-sm font-semibold text-card transition-opacity hover:opacity-90"
        >
          Create a recipe
        </Link>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {recipes.map((recipe) => {
        const working = busy?.id === recipe.recipe_id;
        const message = rowError[recipe.recipe_id];

        return (
          <li
            key={recipe.recipe_id}
            className="rounded-2xl border border-rule bg-card p-4 sm:p-5"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate font-display text-base font-semibold text-ink">
                    {recipe.title}
                  </h2>
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-display text-[11px] font-semibold uppercase tracking-wide ${statusChip(recipe.status)}`}
                  >
                    {recipe.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {recipe.cuisine_type ? `${recipe.cuisine_type} · ` : ""}
                  {new Date(recipe.created_at).toLocaleDateString()}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {recipe.status === "published" ? (
                  <>
                    <Link
                      href={`/recipes/${recipe.recipe_id}`}
                      className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-ink hover:bg-panel"
                    >
                      View
                    </Link>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => act(recipe, "unpublish")}
                      className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-ink hover:bg-panel disabled:opacity-60"
                    >
                      {working && busy?.action === "unpublish" ? "Working..." : "Unpublish"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => act(recipe, "publish")}
                    className="rounded-full bg-maroon px-4 py-2 font-display text-xs font-semibold text-card transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {working && busy?.action === "publish" ? "Publishing..." : "Publish"}
                  </button>
                )}

                <button
                  type="button"
                  disabled={working}
                  onClick={() => act(recipe, "delete")}
                  className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-maroon hover:bg-panel disabled:opacity-60"
                >
                  {working && busy?.action === "delete" ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>

            {message && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {message}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function MyRecipesPage() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-[900px] px-5 py-10 lg:px-6 lg:py-14">
          <RequireSignIn next="/me/recipes" action="see your recipes">
            <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="font-display text-2xl font-semibold text-ink lg:text-3xl">
                  My recipes
                </h1>
                <p className="mt-1 text-sm text-muted">
                  Drafts are only visible to you.
                </p>
              </div>
              <Link
                href="/recipes/create"
                className="rounded-full bg-maroon px-5 py-2.5 font-display text-sm font-semibold text-card transition-opacity hover:opacity-90"
              >
                New recipe
              </Link>
            </header>

            <MyRecipesList />
          </RequireSignIn>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
