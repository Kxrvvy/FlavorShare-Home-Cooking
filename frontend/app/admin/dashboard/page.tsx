"use client";

/* "What is currently happening on the platform?" - stats, the two
 * leaderboards, the monthly chart, then recent activity and a few shortcuts
 * to the sections an admin reaches for most. Reports would lead this page
 * under the spec's own information hierarchy ("things requiring attention"
 * first) - deferred along with the rest of the Reports feature, so this
 * starts from platform totals instead.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  getDashboardSummary,
  listActivities,
  type ActivityRow,
  type DashboardSummary,
  type MonthlyActivityPoint,
} from "@/features/dashboard/api";
import { ApiError } from "@/features/recipes/api";

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-rule bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-ink">{value}</p>
    </div>
  );
}

/** A continuous trailing 12 months ending this month, zero-filled wherever
 * the API had no Activity rows to group.
 *
 * The API only ever returns a month that had at least one activity, so a
 * young or quiet platform comes back with one or two points - rendered as
 * bars in a row, that leaves a wide card with a single thin bar and a lot of
 * empty background rather than a chart. Always drawing the same 12 slots
 * makes a quiet month a real zero bar instead of an absence, and the chart's
 * width is never a function of how much history happens to exist.
 */
function lastTwelveMonths(points: MonthlyActivityPoint[]): MonthlyActivityPoint[] {
  const counts = new Map(points.map((p) => [p.month, p.count]));
  const now = new Date();

  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    return { month, count: counts.get(month) ?? 0 };
  });
}

const QUICK_ACTIONS = [
  { label: "Manage users", href: "/admin/users" },
  { label: "Manage recipes", href: "/admin/recipes" },
  { label: "Moderate comments", href: "/admin/comments" },
  { label: "Manage categories", href: "/admin/categories" },
] as const;

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [activities, setActivities] = useState<ActivityRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [summaryData, activityPage] = await Promise.all([
          getDashboardSummary(),
          listActivities({ page: 1 }),
        ]);
        if (cancelled) return;
        setSummary(summaryData);
        setActivities((activityPage.results ?? []).slice(0, 8));
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Could not load the dashboard."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!summary) {
    return <p className="text-sm text-muted">Loading...</p>;
  }

  const { totals, most_rated, most_saved, monthly_activity } = summary;
  const months = lastTwelveMonths(monthly_activity);
  const maxMonthly = Math.max(1, ...months.map((m) => m.count));

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-ink transition-colors hover:bg-panel"
          >
            {action.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9">
        <StatCard label="Users" value={totals.users} />
        <StatCard label="Published" value={totals.published_recipes} />
        <StatCard label="Drafts" value={totals.draft_recipes} />
        <StatCard label="Ratings" value={totals.ratings} />
        <StatCard label="Reviews" value={totals.comments} />
        <StatCard label="Saved" value={totals.saved_recipes} />
        <StatCard label="Tags" value={totals.tags} />
        <StatCard label="Meal plans" value={totals.meal_plans} />
        <StatCard label="Activities" value={totals.activities} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex h-full flex-col rounded-2xl border border-rule bg-card p-5">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted">
            Most rated
          </h2>
          {most_rated.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 py-8 text-center">
              <p className="text-sm font-medium text-ink">No ratings yet</p>
              <p className="text-xs text-muted">
                Recipes will show up here once someone rates one.
              </p>
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {most_rated.map((r) => (
                <li
                  key={r.recipe_id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-rule bg-panel/60 px-4 py-2.5"
                >
                  <Link
                    href={`/admin/recipes/${r.recipe_id}`}
                    className="truncate text-sm font-medium text-ink hover:underline"
                  >
                    {r.title}
                  </Link>
                  <span className="shrink-0 text-xs text-muted">
                    {r.average_score?.toFixed(1)} avg · {r.rating_count} ratings
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex h-full flex-col rounded-2xl border border-rule bg-card p-5">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted">
            Most saved
          </h2>
          {most_saved.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 py-8 text-center">
              <p className="text-sm font-medium text-ink">No saves yet</p>
              <p className="text-xs text-muted">
                Recipes will show up here once someone saves one.
              </p>
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {most_saved.map((r) => (
                <li
                  key={r.recipe_id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-rule bg-panel/60 px-4 py-2.5"
                >
                  <Link
                    href={`/admin/recipes/${r.recipe_id}`}
                    className="truncate text-sm font-medium text-ink hover:underline"
                  >
                    {r.title}
                  </Link>
                  <span className="shrink-0 text-xs text-muted">{r.save_count} saves</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section>
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted">
          Activity by month
        </h2>
        {/* Always the trailing 12 months, zero-filled - see lastTwelveMonths().
          * A quiet history is a row of short bars, not a mostly-empty card. */}
        <div className="mt-4 flex h-40 items-end gap-2 rounded-2xl border border-rule bg-card p-4">
          {months.map((point) => (
            <div key={point.month} className="flex flex-1 flex-col items-center gap-1.5">
              <div
                title={`${point.count} in ${point.month}`}
                style={{ height: `${Math.max(4, (point.count / maxMonthly) * 100)}px` }}
                className="w-full max-w-10 rounded-t bg-maroon"
              />
              <span className="text-[10px] text-muted">
                {new Date(`${point.month}T00:00:00`).toLocaleDateString(undefined, {
                  month: "short",
                })}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted">
            Recent activity
          </h2>
        </div>

        {activities === null ? (
          <p className="mt-3 text-sm text-muted">Loading...</p>
        ) : activities.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing logged yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {activities.map((a) => (
              <li key={a.activity_id} className="rounded-xl border border-rule bg-card px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="text-sm text-ink">
                    <span className="font-semibold">@{a.user.username}</span> — {a.description}
                  </p>
                  <span className="shrink-0 text-xs text-muted">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </div>
                {a.recipe != null && (
                  <Link
                    href={`/admin/recipes/${a.recipe}`}
                    className="mt-1 inline-block text-xs font-semibold text-maroon hover:underline"
                  >
                    View recipe
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
