"use client";

/* Every comment platform-wide, newest first. CommentViewSet's own filters
 * are numeric (?recipe=, ?user=) - there is no text search on comment
 * content - so this is the feed as-is rather than a search box with nothing
 * behind it. */

import Link from "next/link";
import { useEffect, useState } from "react";

import { listAllComments } from "@/features/dashboard/api";
import { PageButtons } from "@/features/dashboard/components/shared";
import { ApiError, deleteComment, type CommentRow } from "@/features/recipes/api";

export default function AdminCommentsPage() {
  const [page, setPage] = useState(1);
  const [comments, setComments] = useState<CommentRow[] | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [error, setError] = useState("");
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<Record<number, string>>({});
  const [removed, setRemoved] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await listAllComments({ page });
        if (cancelled) return;
        setComments(payload.results ?? []);
        setHasNext(!!payload.next);
        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load comments.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page]);

  async function remove(comment: CommentRow) {
    if (!window.confirm("Remove this comment?")) return;

    setRowBusy(comment.comment_id);
    setRowError((current) => ({ ...current, [comment.comment_id]: "" }));
    try {
      await deleteComment(comment.comment_id);
      setRemoved((current) => new Set(current).add(comment.comment_id));
    } catch (err) {
      setRowError((current) => ({
        ...current,
        [comment.comment_id]:
          err instanceof ApiError ? err.message : "Could not remove that comment.",
      }));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <p className="mb-6 text-sm text-muted">
        Every review left on any recipe. There is no soft delete here - removing a comment
        deletes the row, the same as an author deleting their own.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {comments === null ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted">No comments yet.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {comments.map((c) => {
            const busy = rowBusy === c.comment_id;
            const gone = removed.has(c.comment_id);

            return (
              <li key={c.comment_id} className="rounded-xl border border-rule bg-card p-4">
                {gone ? (
                  <p className="text-sm italic text-muted">[Comment removed by administrator]</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-sm font-semibold text-ink">
                          @{c.user.username}
                        </p>
                        <Link
                          href={`/admin/recipes/${c.recipe}`}
                          className="text-xs font-semibold text-maroon hover:underline"
                        >
                          on this recipe
                        </Link>
                      </div>
                      <span className="shrink-0 text-xs text-muted">
                        {new Date(c.created_at).toLocaleString()}
                      </span>
                    </div>

                    <p className="mt-2 text-sm leading-relaxed text-slate">{c.content}</p>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(c)}
                      className="mt-3 rounded-full border border-rule px-3 py-1.5 font-display text-xs font-semibold text-maroon disabled:opacity-50"
                    >
                      {busy ? "Removing..." : "Remove comment"}
                    </button>

                    {rowError[c.comment_id] && (
                      <p role="alert" className="mt-2 text-xs text-red-600">
                        {rowError[c.comment_id]}
                      </p>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <PageButtons page={page} hasNext={hasNext} onChange={setPage} />
    </div>
  );
}
