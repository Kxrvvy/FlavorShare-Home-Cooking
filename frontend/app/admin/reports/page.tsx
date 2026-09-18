"use client";

/* The moderation queue Feature 8 asks for. Pending by default - that is the
 * work an admin actually has to do here - with Resolved/Dismissed as history
 * tabs rather than a combined feed, since a closed report has nothing left
 * to act on.
 *
 * Resolving or dismissing a report does not itself unpublish a recipe or
 * delete a comment - each card links straight to the existing controls for
 * that (admin/recipes/[id], admin/comments) so the actual moderation action
 * stays in the one place that already knows how to do it. This page only
 * tracks whether the report itself has been looked at.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { PageButtons } from "@/components/ui/PageButtons";
import { listReports, resolveReport, type ReportRow } from "@/features/dashboard/api";
import { ApiError } from "@/features/recipes/api";

const STATUS_TABS = [
  { value: "pending", label: "Pending" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
] as const;

const REASON_LABEL: Record<ReportRow["reason"], string> = {
  spam: "Spam or advertising",
  inappropriate: "Inappropriate content",
  misinformation: "Misinformation",
  other: "Other",
};

export default function AdminReportsPage() {
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]["value"]>("pending");
  const [page, setPage] = useState(1);
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [error, setError] = useState("");
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [rowError, setRowError] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await listReports({ status: tab, page });
        if (cancelled) return;
        setReports(payload.results ?? []);
        setHasNext(!!payload.next);
        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load reports.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, page]);

  async function close(report: ReportRow, status: "resolved" | "dismissed") {
    setRowBusy(report.report_id);
    setRowError((current) => ({ ...current, [report.report_id]: "" }));
    try {
      await resolveReport(report.report_id, status);
      setReports(
        (current) => current?.filter((r) => r.report_id !== report.report_id) ?? current
      );
    } catch (err) {
      setRowError((current) => ({
        ...current,
        [report.report_id]:
          err instanceof ApiError ? err.message : "Could not update that report.",
      }));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <p className="mb-6 text-sm text-muted">
        Recipes and reviews flagged by users. Take the actual moderation action - unpublishing a
        recipe or removing a comment - from its own page first, then close the report here.
      </p>

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => {
              setTab(t.value);
              setPage(1);
            }}
            className={`rounded-full border px-4 py-2 font-display text-xs font-semibold transition-colors ${
              tab === t.value
                ? "border-maroon bg-maroon text-card"
                : "border-rule text-ink hover:bg-panel"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {reports === null ? (
        <p className="mt-4 text-sm text-muted">Loading...</p>
      ) : reports.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-rule bg-card p-10 text-center">
          <p className="font-display text-lg font-semibold text-ink">
            {tab === "pending" ? "Nothing waiting on you" : `No ${tab} reports`}
          </p>
          <p className="mt-2 text-sm text-muted">
            {tab === "pending" && "Reports filed by users will show up here."}
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {reports.map((r) => {
            const busy = rowBusy === r.report_id;
            const targetHref = r.recipe
              ? `/admin/recipes/${r.recipe}`
              : `/admin/recipes/${r.comment_recipe}`;

            return (
              <li key={r.report_id} className="rounded-xl border border-rule bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-sm font-semibold text-ink">
                      @{r.reporter.username}
                    </p>
                    <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-maroon">
                      {REASON_LABEL[r.reason]}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </div>

                {r.details && (
                  <p className="mt-2 text-sm leading-relaxed text-slate">{r.details}</p>
                )}

                <div className="mt-3 rounded-lg border border-rule bg-panel/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {r.recipe ? "Reported recipe" : "Reported review"}
                  </p>
                  {r.recipe ? (
                    <Link
                      href={targetHref}
                      className="mt-1 block truncate text-sm font-semibold text-ink hover:underline"
                    >
                      {r.recipe_title}
                    </Link>
                  ) : (
                    <>
                      <p className="mt-1 line-clamp-2 text-sm text-slate">{r.comment_content}</p>
                      <Link
                        href={targetHref}
                        className="mt-1 inline-block text-xs font-semibold text-maroon hover:underline"
                      >
                        View the recipe it&apos;s on
                      </Link>
                    </>
                  )}
                </div>

                {tab === "pending" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => close(r, "resolved")}
                      className="rounded-full bg-maroon px-3 py-1.5 font-display text-xs font-semibold text-card disabled:opacity-50"
                    >
                      {busy ? "Working..." : "Mark resolved"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => close(r, "dismissed")}
                      className="rounded-full border border-rule px-3 py-1.5 font-display text-xs font-semibold text-ink disabled:opacity-50"
                    >
                      {busy ? "Working..." : "Dismiss"}
                    </button>
                  </div>
                ) : (
                  r.resolved_by && (
                    <p className="mt-3 text-xs text-muted">
                      {tab === "resolved" ? "Resolved" : "Dismissed"} by @{r.resolved_by.username}
                      {r.resolved_at && ` on ${new Date(r.resolved_at).toLocaleDateString()}`}
                    </p>
                  )
                )}

                {rowError[r.report_id] && (
                  <p role="alert" className="mt-2 text-xs text-red-600">
                    {rowError[r.report_id]}
                  </p>
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
