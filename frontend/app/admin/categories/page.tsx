"use client";

/* "Categories" here manages the existing Tag lookup table - there is no
 * separate Category entity in this app, only free-text cuisine_type and
 * this open tag list (plus the fixed six-tag chip row on the homepage,
 * which is a frontend-only allow-list layered on top of it - see
 * lib/categories.ts). Renaming or deleting a tag reaches every recipe that
 * carries it, which is exactly why TagViewSet gates writes to admins only.
 */

import { useEffect, useState } from "react";

import { createTag, deleteTag, listTags, updateTag, type TagRow } from "@/features/dashboard/api";
import { FIELD } from "@/features/dashboard/components/shared";
import { ApiError, listAllRecipes } from "@/features/recipes/api";

export default function AdminCategoriesPage() {
  const [tags, setTags] = useState<TagRow[] | null>(null);
  const [error, setError] = useState("");

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<Record<number, string>>({});

  async function load() {
    try {
      const payload = await listTags();
      setTags(payload.results ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load categories.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    const name = newName.trim();
    if (!name || creating) return;

    setCreating(true);
    setCreateError("");
    try {
      const created = await createTag(name);
      setTags((current) => (current ? [...current, created] : [created]));
      setNewName("");
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create that category.");
    } finally {
      setCreating(false);
    }
  }

  function startEditing(tag: TagRow) {
    setEditingId(tag.tag_id);
    setEditingName(tag.name);
    setRowError((current) => ({ ...current, [tag.tag_id]: "" }));
  }

  async function saveEdit(tag: TagRow) {
    const name = editingName.trim();
    if (!name) return;

    setRowBusy(tag.tag_id);
    try {
      const updated = await updateTag(tag.tag_id, name);
      setTags((current) => current?.map((t) => (t.tag_id === tag.tag_id ? updated : t)) ?? current);
      setEditingId(null);
    } catch (err) {
      setRowError((current) => ({
        ...current,
        [tag.tag_id]: err instanceof ApiError ? err.message : "Could not rename that category.",
      }));
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(tag: TagRow) {
    setRowBusy(tag.tag_id);
    setRowError((current) => ({ ...current, [tag.tag_id]: "" }));
    try {
      // How many recipes carry this tag, so the confirmation is honest about
      // what deleting it would refuse - the API itself blocks the delete
      // outright if the count is not zero, rather than reassigning anything.
      const usage = await listAllRecipes({ tag: tag.name, page: 1 });
      const count = usage.count ?? 0;

      const proceed =
        count === 0
          ? window.confirm(`Delete "${tag.name}"? This cannot be undone.`)
          : window.confirm(
              `"${tag.name}" is used by ${count} recipe${count === 1 ? "" : "s"} and cannot ` +
                `be deleted until none of them carry it any more. Try anyway?`
            );
      if (!proceed) return;

      await deleteTag(tag.tag_id);
      setTags((current) => current?.filter((t) => t.tag_id !== tag.tag_id) ?? current);
    } catch (err) {
      setRowError((current) => ({
        ...current,
        [tag.tag_id]: err instanceof ApiError ? err.message : "Could not delete that category.",
      }));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <p className="mb-6 max-w-[600px] text-sm text-muted">
        The tags recipes can carry. A tag still used by a recipe cannot be deleted - untag
        every recipe that carries it first.
      </p>

      <div className="flex max-w-lg gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="New category name..."
          className={`${FIELD} flex-1`}
        />
        <button
          type="button"
          disabled={creating || !newName.trim()}
          onClick={create}
          className="rounded-full bg-maroon px-5 py-2.5 font-display text-sm font-semibold text-card disabled:opacity-50"
        >
          {creating ? "Adding..." : "Add"}
        </button>
      </div>
      {createError && <p className="mt-2 max-w-lg text-sm text-red-600">{createError}</p>}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {tags === null ? (
        <p className="mt-6 text-sm text-muted">Loading...</p>
      ) : tags.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No categories yet.</p>
      ) : (
        <ul className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tags.map((tag) => {
            const busy = rowBusy === tag.tag_id;
            const editing = editingId === tag.tag_id;

            return (
              <li key={tag.tag_id} className="rounded-xl border border-rule bg-card p-3">
                <div className="flex items-center gap-2">
                  {editing ? (
                    <>
                      <input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveEdit(tag)}
                        autoFocus
                        className={`${FIELD} flex-1 py-1.5`}
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => saveEdit(tag)}
                        className="rounded-full bg-maroon px-3 py-1.5 font-display text-xs font-semibold text-card disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-full border border-rule px-3 py-1.5 font-display text-xs font-semibold text-ink"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 truncate text-sm font-medium text-ink">
                        {tag.name}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => startEditing(tag)}
                        className="rounded-full border border-rule px-3 py-1.5 font-display text-xs font-semibold text-ink disabled:opacity-50"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(tag)}
                        className="rounded-full border border-rule px-3 py-1.5 font-display text-xs font-semibold text-maroon disabled:opacity-50"
                      >
                        {busy ? "Working..." : "Delete"}
                      </button>
                    </>
                  )}
                </div>

                {rowError[tag.tag_id] && (
                  <p role="alert" className="mt-2 text-xs text-red-600">
                    {rowError[tag.tag_id]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
