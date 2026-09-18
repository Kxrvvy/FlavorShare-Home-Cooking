"use client";

/* A small "Report" disclosure, shared by RecipeDetail's per-recipe control
 * and its per-review control. Inline rather than a modal - the whole form is
 * three fields, and this keeps it in the page's own flow instead of a second
 * layer on top of it.
 */

import { useState } from "react";

import { ApiError, createReport, type ReportReason } from "@/features/recipes/api";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Spam or advertising" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "misinformation", label: "Misinformation" },
  { value: "other", label: "Other" },
];

const FIELD =
  "w-full rounded-lg border border-rule bg-field px-2.5 py-1.5 text-xs text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon";

export function ReportButton({
  target,
  label = "Report",
}: {
  target: { recipe: number } | { comment: number };
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await createReport({ ...target, reason, details: details.trim() || undefined });
      setDone(true);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send that report.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <p className="text-xs text-muted">Reported - an admin will take a look.</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-muted hover:text-maroon hover:underline"
      >
        {label}
      </button>
    );
  }

  return (
    <div className="mt-2 flex w-full max-w-xs flex-col gap-2 rounded-xl border border-rule bg-panel/60 p-3 text-left">
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value as ReportReason)}
        className={FIELD}
      >
        {REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <textarea
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        placeholder="Anything else? (optional)"
        rows={2}
        className={FIELD}
      />
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="rounded-full bg-maroon px-3 py-1.5 font-display text-xs font-semibold text-card disabled:opacity-50"
        >
          {busy ? "Sending..." : "Send report"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full border border-rule px-3 py-1.5 font-display text-xs font-semibold text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
