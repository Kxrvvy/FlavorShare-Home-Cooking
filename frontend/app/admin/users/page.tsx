"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  deactivateUser,
  listUsers,
  updateUser,
  type AdminUserRow,
} from "@/features/dashboard/api";
import { PageButtons } from "@/components/ui/PageButtons";
import { FIELD } from "@/features/dashboard/components/shared";
import { ApiError } from "@/features/recipes/api";
import { useSession } from "@/lib/useSession";

const ROLE_LABELS: Record<AdminUserRow["role"], string> = {
  guest: "Guest",
  registered: "Registered",
  admin: "Admin",
};

export default function AdminUsersPage() {
  const { user: me } = useSession();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [role, setRole] = useState<AdminUserRow["role"] | "">("");
  const [status, setStatus] = useState<"" | "active" | "suspended">("");
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
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
        const payload = await listUsers({
          search: debouncedSearch || undefined,
          role: role || undefined,
          is_active: status ? status === "active" : undefined,
          page,
        });
        if (cancelled) return;
        setUsers(payload.results ?? []);
        setHasNext(!!payload.next);
        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load accounts.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, role, status, page]);

  async function toggleActive(target: AdminUserRow) {
    const verb = target.is_active ? "Suspend" : "Restore";
    if (target.is_active && !window.confirm(`Suspend @${target.username}?`)) return;

    setRowBusy(target.user_id);
    setRowError((current) => ({ ...current, [target.user_id]: "" }));
    try {
      if (target.is_active) {
        await deactivateUser(target.user_id);
        setUsers(
          (current) =>
            current?.map((row) =>
              row.user_id === target.user_id ? { ...row, is_active: false } : row
            ) ?? current
        );
      } else {
        const updated = await updateUser(target.user_id, { is_active: true });
        setUsers(
          (current) =>
            current?.map((row) => (row.user_id === target.user_id ? updated : row)) ?? current
        );
      }
    } catch (err) {
      setRowError((current) => ({
        ...current,
        [target.user_id]:
          err instanceof ApiError ? err.message : `Could not ${verb.toLowerCase()} that account.`,
      }));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <p className="mb-6 text-sm text-muted">
        Every registered account. Suspending revokes access without deleting anything -
        their recipes, ratings and reviews stay exactly as they are.
      </p>

      <div className="flex flex-wrap gap-3">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search username or email..."
          className={`${FIELD} max-w-xs`}
        />
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value as AdminUserRow["role"] | "");
            setPage(1);
          }}
          className={`${FIELD} w-auto`}
        >
          <option value="">All roles</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as "" | "active" | "suspended");
            setPage(1);
          }}
          className={`${FIELD} w-auto`}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {users === null ? (
        <p className="mt-4 text-sm text-muted">Loading...</p>
      ) : users.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No accounts match.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-rule bg-card">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-rule text-xs font-semibold uppercase tracking-wide text-muted">
                <th scope="col" className="px-4 py-3">Username</th>
                <th scope="col" className="px-4 py-3">Email</th>
                <th scope="col" className="px-4 py-3">Role</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Joined</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const busy = rowBusy === u.user_id;
                const isSelf = me?.user_id === u.user_id;

                return (
                  <tr key={u.user_id} className="border-b border-rule last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/users/${u.user_id}`}
                        className="font-display font-semibold text-ink hover:underline"
                      >
                        @{u.username}
                      </Link>
                      {isSelf && <span className="ml-2 text-xs text-muted">(you)</span>}
                      {rowError[u.user_id] && (
                        <p role="alert" className="mt-1 text-xs text-red-600">
                          {rowError[u.user_id]}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{u.email}</td>
                    <td className="px-4 py-3 text-muted">{ROLE_LABELS[u.role]}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                          u.is_active ? "bg-maroon/10 text-maroon" : "bg-ink/10 text-muted"
                        }`}
                      >
                        {u.is_active ? "Active" : "Suspended"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggleActive(u)}
                        className="rounded-full border border-rule px-3 py-1.5 font-display text-xs font-semibold text-ink disabled:opacity-50"
                      >
                        {busy ? "Working..." : u.is_active ? "Suspend" : "Restore"}
                      </button>
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
