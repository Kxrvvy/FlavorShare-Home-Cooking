"use client";

/* Account info, real stats, and the recipes this person has written - "Saved
 * Recipes" from the spec's user-stats list is deliberately absent.
 * SavedRecipeViewSet only ever returns the caller's own collection - "somebody
 * else's saved_recipe_id is a 404, not a 403" is the whole point of how it is
 * scoped - so there is no admin-reachable count to show here without loosening
 * that boundary, which nobody asked for. Reports Received is absent for the
 * plainer reason that Reports does not exist yet.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  getUser,
  listAllComments,
  listUserRatings,
  updateUser,
  deactivateUser,
  type AdminUserRow,
} from "@/features/dashboard/api";
import { FIELD } from "@/features/dashboard/components/shared";
import { ApiError, listAllRecipes, type RecipeRow } from "@/features/recipes/api";
import { useSession } from "@/lib/useSession";

const ROLE_LABELS: Record<AdminUserRow["role"], string> = {
  guest: "Guest",
  registered: "Registered",
  admin: "Admin",
};

type Stats = { recipes: number; comments: number; ratings: number };

export function AdminUserDetail({ userId }: { userId: number }) {
  const { user: me } = useSession();
  const [account, setAccount] = useState<AdminUserRow | null>(null);
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [user, recipePage, commentPage, ratingPage] = await Promise.all([
          getUser(userId),
          listAllRecipes({ user: userId }),
          listAllComments({ user: userId }),
          listUserRatings(userId),
        ]);
        if (cancelled) return;
        setAccount(user);
        setRecipes(recipePage.results ?? []);
        setStats({
          recipes: recipePage.count ?? recipePage.results?.length ?? 0,
          comments: commentPage.count ?? 0,
          ratings: ratingPage.count ?? 0,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load this account.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function changeRole(newRole: AdminUserRow["role"]) {
    if (!account) return;
    setBusy(true);
    setActionError("");
    try {
      setAccount(await updateUser(account.user_id, { role: newRole }));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not change that role.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!account) return;
    if (account.is_active && !window.confirm(`Suspend @${account.username}?`)) return;

    setBusy(true);
    setActionError("");
    try {
      if (account.is_active) {
        await deactivateUser(account.user_id);
        setAccount({ ...account, is_active: false });
      } else {
        setAccount(await updateUser(account.user_id, { is_active: true }));
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not update this account.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div>
        <p className="text-sm text-red-600">{error}</p>
        <Link href="/admin/users" className="mt-4 inline-block text-sm font-semibold text-maroon hover:underline">
          Back to users
        </Link>
      </div>
    );
  }

  if (!account || !stats) {
    return <p className="text-sm text-muted">Loading...</p>;
  }

  const isSelf = me?.user_id === account.user_id;

  return (
    <div>
      <Link href="/admin/users" className="text-sm font-semibold text-maroon hover:underline">
        ← Back to users
      </Link>

      <div className="mt-4 grid gap-6 xl:grid-cols-2 xl:items-start">
      <div>
      <div className="rounded-2xl border border-rule bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-ink">
              @{account.username}
              {isSelf && <span className="ml-2 text-sm font-normal text-muted">(you)</span>}
            </h2>
            <p className="mt-1 text-sm text-muted">{account.email}</p>
            <p className="mt-1 text-xs text-muted">
              Joined {new Date(account.created_at).toLocaleDateString()}
              {account.last_login &&
                ` · last signed in ${new Date(account.last_login).toLocaleDateString()}`}
            </p>
          </div>

          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
              account.is_active ? "bg-maroon/10 text-maroon" : "bg-ink/10 text-muted"
            }`}
          >
            {account.is_active ? "Active" : "Suspended"}
          </span>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink">
            Role
            <select
              value={account.role}
              disabled={busy}
              onChange={(e) => changeRole(e.target.value as AdminUserRow["role"])}
              className={`${FIELD} w-auto py-1.5 disabled:opacity-50`}
            >
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={toggleActive}
            className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-ink disabled:opacity-50"
          >
            {busy ? "Working..." : account.is_active ? "Suspend account" : "Restore account"}
          </button>
        </div>

        {actionError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {actionError}
          </p>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-rule bg-card p-4 text-center">
          <p className="font-display text-xl font-semibold text-ink">{stats.recipes}</p>
          <p className="text-xs text-muted">Recipes</p>
        </div>
        <div className="rounded-2xl border border-rule bg-card p-4 text-center">
          <p className="font-display text-xl font-semibold text-ink">{stats.comments}</p>
          <p className="text-xs text-muted">Reviews written</p>
        </div>
        <div className="rounded-2xl border border-rule bg-card p-4 text-center">
          <p className="font-display text-xl font-semibold text-ink">{stats.ratings}</p>
          <p className="text-xs text-muted">Ratings given</p>
        </div>
      </div>
      </div>

      <section>
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-muted">
          Recipes
        </h3>
        {recipes.length === 0 ? (
          <p className="mt-3 text-sm text-muted">This account has not written a recipe.</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {recipes.map((r) => (
              <li
                key={r.recipe_id}
                className="flex items-center justify-between gap-3 rounded-xl border border-rule bg-card px-4 py-2.5"
              >
                <Link
                  href={`/admin/recipes/${r.recipe_id}`}
                  className="truncate text-sm font-medium text-ink hover:underline"
                >
                  {r.title}
                </Link>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                    r.status === "published" ? "bg-maroon/10 text-maroon" : "bg-ink/10 text-muted"
                  }`}
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
    </div>
  );
}
