"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  ApiError,
  listAllRecipes,
  unpublishRecipe,
  updateRecipe,
  type RecipeRow,
} from "@/features/recipes/api";
import { PageButtons } from "@/components/ui/PageButtons";
import { FIELD } from "@/features/dashboard/components/shared";

export default function AdminRecipesPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<"" | "draft" | "published">("");
  const [page, setPage] = useState(1);
  const [recipes, setRecipes] = useState<RecipeRow[] | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [error, setError] = useState("");
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<Record<number, string>>({});

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await listAllRecipes({
          search: debouncedSearch || undefined,
          status: status || undefined,
          page,
        });
        if (cancelled) return;
        setRecipes(payload.results ?? []);
        setHasNext(!!payload.next);
        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load recipes.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, status, page]);

  async function toggleFeatured(target: RecipeRow) {
    setRowBusy(target.recipe_id);
    setRowError((current) => ({ ...current, [target.recipe_id]: "" }));
    try {
      const updated = await updateRecipe(target.recipe_id, { featured: !target.featured });
      setRecipes(
        (current) =>
          current?.map((row) =>
            row.recipe_id === target.recipe_id ? { ...row, featured: updated.featured } : row
          ) ?? current
      );
    } catch (err) {
      setRowError((current) => ({
        ...current,
        [target.recipe_id]: err instanceof ApiError ? err.message : "Could not change that.",
      }));
    } finally {
      setRowBusy(null);
    }
  }

  async function unpublish(target: RecipeRow) {
    if (!window.confirm(`Remove "${target.title}" from public view?`)) return;

    setRowBusy(target.recipe_id);
    setRowError((current) => ({ ...current, [target.recipe_id]: "" }));
    try {
      await unpublishRecipe(target.recipe_id);
      setRecipes(
        (current) =>
          current?.map((row) =>
            row.recipe_id === target.recipe_id
              ? { ...row, status: "draft" as const, featured: false }
              : row
          ) ?? current
      );
    } catch (err) {
      setRowError((current) => ({
        ...current,
        [target.recipe_id]: err instanceof ApiError ? err.message : "Could not unpublish that.",
      }));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <p className="mb-6 text-sm text-muted">
        Every recipe, drafts included. Unpublishing hides a recipe from normal users without
        deleting it - the author keeps it and can republish.
      </p>

      <div className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search title, cuisine, ingredient..."
          className={`${FIELD} max-w-xs`}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as "" | "draft" | "published");
            setPage(1);
          }}
          className={`${FIELD} w-auto`}
        >
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {recipes === null ? (
        <p className="mt-4 text-sm text-muted">Loading...</p>
      ) : recipes.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No recipes match.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-rule bg-card">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-rule text-xs font-semibold uppercase tracking-wide text-muted">
                <th scope="col" className="px-4 py-3">Recipe</th>
                <th scope="col" className="px-4 py-3">Author</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Views</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recipes.map((r) => {
                const busy = rowBusy === r.recipe_id;

                return (
                  <tr key={r.recipe_id} className="border-b border-rule last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/recipes/${r.recipe_id}`}
                        className="font-display font-semibold text-ink hover:underline"
                      >
                        {r.title}
                      </Link>
                      {rowError[r.recipe_id] && (
                        <p role="alert" className="mt-1 text-xs text-red-600">
                          {rowError[r.recipe_id]}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{r.user?.username ?? "unknown"}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                            r.status === "published"
                              ? "bg-maroon/10 text-maroon"
                              : "bg-ink/10 text-muted"
                          }`}
                        >
                          {r.status}
                        </span>
                        {r.featured && (
                          <span className="rounded-full bg-ember/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ember">
                            Featured
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{r.view_count ?? 0}</td>
                    <td className="px-4 py-3 text-right">
                      {r.status === "published" && (
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => toggleFeatured(r)}
                            className="rounded-full border border-rule px-3 py-1.5 font-display text-xs font-semibold text-ink disabled:opacity-50"
                          >
                            {busy ? "Working..." : r.featured ? "Unfeature" : "Feature"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => unpublish(r)}
                            className="rounded-full border border-rule px-3 py-1.5 font-display text-xs font-semibold text-maroon disabled:opacity-50"
                          >
                            {busy ? "Working..." : "Unpublish"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <PageButtons page={page} hasNext={hasNext} onChange={setPage} />
    </div>
  );
}
