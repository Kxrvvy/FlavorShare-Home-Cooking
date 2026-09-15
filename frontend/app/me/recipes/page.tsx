"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { RequireSignIn } from "@/components/auth/RequireSignIn";
import { AppShell } from "@/components/layout/AppShell";
import {
  ApiError,
  deleteRecipe,
  listMyRecipes,
  listSavedRecipes,
  publishRecipe,
  unpublishRecipe,
  type RecipeRow,
} from "@/features/recipes/api";
import { getAccessToken } from "@/lib/auth";
import { refreshCollectionCounts } from "@/lib/collectionCounts";
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

/* The four views of this page.
 *
 * "all" is your own recipes plus the ones you saved, which is the only reason
 * it differs from "mine" - without a saved collection the two would be the same
 * list under two names.
 */
const VIEWS = {
  all: { label: "All", blurb: "Everything you have written or saved." },
  saved: { label: "Saved", blurb: "Recipes you saved from other cooks." },
  mine: { label: "Your recipes", blurb: "Everything you have written. Drafts are only visible to you." },
  published: { label: "Published", blurb: "Live on FlavorShare for anyone to cook." },
} as const;

const VIEW_ORDER: View[] = ["all", "saved", "mine", "published"];

type View = keyof typeof VIEWS;

function asView(value: string | null): View {
  return value && value in VIEWS ? (value as View) : "all";
}

/** A recipe plus whether it is yours - a saved recipe is somebody else's, so it
 * offers no Edit, Publish or Delete. */
type Entry = { recipe: RecipeRow; owned: boolean };

function statusChip(status: RecipeRow["status"]) {
  return status === "published"
    ? "bg-maroon/10 text-maroon"
    : "bg-ink/10 text-muted";
}

function MyRecipesList() {
  const { user } = useSession();
  const params = useSearchParams();
  const view = asView(params.get("show"));
  const query = (params.get("q") ?? "").trim().toLowerCase();
  const [recipes, setRecipes] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [rowError, setRowError] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const token = getAccessToken();
    if (!user || !token) return;

    try {
      /* Only what the view needs. "saved" never asks for your own recipes and
       * "mine" never asks for the collection. */
      const [mine, saved] = await Promise.all([
        view === "saved" ? Promise.resolve([]) : listMyRecipes(user.user_id),
        view === "all" || view === "saved" ? listSavedRecipes() : Promise.resolve([]),
      ]);

      const own: Entry[] = mine
        .filter((r) => (view === "published" ? r.status === "published" : true))
        .map((recipe) => ({ recipe, owned: true }));

      // A recipe you wrote and also saved should appear once, as yours.
      const ownIds = new Set(own.map((e) => e.recipe.recipe_id));
      const collected: Entry[] = saved
        .filter((row) => !ownIds.has(row.recipe_detail.recipe_id))
        .map((row) => ({ recipe: row.recipe_detail, owned: false }));

      const entries = view === "saved" ? collected : [...own, ...collected];

      /* Filtered here rather than by the API: the recipes endpoint has a
       * ?search= of its own, but it cannot search the saved collection, and a
       * page that searches half of what it shows is worse than one that
       * searches all of it in the browser. These lists are a page long. */
      setRecipes(
        query
          ? entries.filter(({ recipe }) =>
              [recipe.title, recipe.cuisine_type, recipe.user?.username]
                .filter(Boolean)
                .some((field) => field!.toLowerCase().includes(query))
            )
          : entries
      );
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your recipes.");
    }
  }, [user, view, query]);

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
      if (action === "publish") await publishRecipe(recipe.recipe_id);
      if (action === "unpublish") await unpublishRecipe(recipe.recipe_id);
      if (action === "delete") await deleteRecipe(recipe.recipe_id);
      if (user) refreshCollectionCounts(user.user_id);
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

  if (recipes.length === 0 && query) {
    return (
      <div className="rounded-2xl border border-rule bg-card p-10 text-center">
        <p className="font-display text-lg font-semibold text-ink">
          Nothing matches &ldquo;{params.get("q")}&rdquo;
        </p>
        <p className="mt-2 text-sm text-muted">
          Searching titles, cuisines and authors in this view.
        </p>
        <Link
          href={`/me/recipes?show=${view}`}
          className="mt-6 inline-block rounded-full border border-rule px-6 py-3 font-display text-sm font-semibold text-ink hover:bg-panel"
        >
          Clear search
        </Link>
      </div>
    );
  }

  if (recipes.length === 0) {
    return (
      <div className="rounded-2xl border border-rule bg-card p-10 text-center">
        <p className="font-display text-lg font-semibold text-ink">
          {view === "saved"
            ? "You have not saved a recipe yet"
            : view === "published"
              ? "You have not published anything yet"
              : "You have not written a recipe yet"}
        </p>
        <p className="mt-2 text-sm text-muted">
          {view === "saved"
            ? "Recipes you save from other cooks are kept here."
            : "Anything you start will appear here, published or not."}
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
    <>
      {query && (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
          {recipes.length} {recipes.length === 1 ? "result" : "results"} for
          <span className="font-semibold text-ink">&ldquo;{params.get("q")}&rdquo;</span>
          <Link
            href={`/me/recipes?show=${view}`}
            className="font-display text-xs font-semibold text-maroon hover:underline"
          >
            Clear
          </Link>
        </p>
      )}

      <ul className="flex flex-col gap-3">
      {recipes.map(({ recipe, owned }) => {
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
                    className={`rounded-full px-2.5 py-0.5 font-display text-[11px] font-semibold uppercase tracking-wide ${
                      owned ? statusChip(recipe.status) : "bg-panel text-slate"
                    }`}
                  >
                    {owned ? recipe.status : "saved"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {recipe.cuisine_type ? `${recipe.cuisine_type} · ` : ""}
                  {owned
                    ? new Date(recipe.created_at).toLocaleDateString()
                    : `by ${recipe.user?.username ?? "another cook"}`}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {/* Edit is offered for published recipes too - a typo in a
                  * published recipe is exactly the thing an author wants to
                  * fix, and the builder patches either status. Not offered at
                  * all for a saved recipe: it belongs to somebody else, and the
                  * API would refuse every write. */}
                {owned && (
                <Link
                  href={`/recipes/${recipe.recipe_id}/edit`}
                  className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-ink hover:bg-panel"
                >
                  Edit
                </Link>
                )}

                {!owned ? (
                  <Link
                    href={`/recipes/${recipe.recipe_id}`}
                    className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-ink hover:bg-panel"
                  >
                    View
                  </Link>
                ) : recipe.status === "published" ? (
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

                {owned && (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => act(recipe, "delete")}
                    className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-maroon hover:bg-panel disabled:opacity-60"
                  >
                    {working && busy?.action === "delete" ? "Deleting..." : "Delete"}
                  </button>
                )}
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
    </>
  );
}

/* Tabs here rather than links in the sidebar.
 *
 * The rail already has a My recipes item, and a collection group beside it
 * repeated the same destination - "Your Recipes" in the group and "My recipes"
 * in the nav were one page under two names. Filtering belongs to the page it
 * filters, and here the active tab can be shown honestly: this page already
 * reads the query string, which the shell cannot do without forcing a Suspense
 * boundary onto every page that renders it.
 */
function Tabs() {
  const params = useSearchParams();
  const view = asView(params.get("show"));
  const query = params.get("q");

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-rule">
        {VIEW_ORDER.map((key) => {
          const current = key === view;

          return (
            <Link
              key={key}
              href={`/me/recipes?show=${key}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
              aria-current={current ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 font-display text-sm transition-colors ${
                current
                  ? "border-maroon font-semibold text-maroon"
                  : "border-transparent font-medium text-slate hover:text-ink"
              }`}
            >
              {VIEWS[key].label}
            </Link>
          );
        })}
      </div>

      <p className="mt-3 text-sm text-muted">{VIEWS[view].blurb}</p>
    </div>
  );
}

export default function MyRecipesPage() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[900px] px-5 py-10 lg:px-6 lg:py-14">
        <RequireSignIn next="/me/recipes" action="see your recipes">
          <header className="mb-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h1 className="font-display text-2xl font-semibold text-ink lg:text-3xl">
                My recipes
              </h1>
            <Link
              href="/recipes/create"
              className="rounded-full bg-maroon px-5 py-2.5 font-display text-sm font-semibold text-card transition-opacity hover:opacity-90"
            >
              New recipe
            </Link>
            </div>

            {/* useSearchParams cannot prerender without a boundary, and this
              * page is static. Around the tabs only, so the title and the New
              * recipe button are never inside a fallback. */}
            <div className="mt-5">
              <Suspense fallback={<div className="h-16" />}>
                <Tabs />
              </Suspense>
            </div>
          </header>

          <Suspense fallback={<p className="text-sm text-muted">Loading your recipes...</p>}>
            <MyRecipesList />
          </Suspense>
        </RequireSignIn>
      </div>
    </AppShell>
  );
}
