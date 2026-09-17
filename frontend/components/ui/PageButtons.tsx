"use client";

/* A generic Previous/Next pager. Started under the admin panel's own
 * components when it only had one caller; moved here once the /recipes
 * Explore page needed the exact same thing and there was nothing
 * admin-specific about it to begin with - plain design-token classes, no
 * dashboard-only styling.
 */

export function PageButtons({
  page,
  hasNext,
  onChange,
  disabled = false,
}: {
  page: number;
  hasNext: boolean;
  onChange: (page: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mt-4 flex justify-between">
      <button
        type="button"
        disabled={disabled || page <= 1}
        onClick={() => onChange(page - 1)}
        className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-ink disabled:opacity-40"
      >
        Previous
      </button>
      <button
        type="button"
        disabled={disabled || !hasNext}
        onClick={() => onChange(page + 1)}
        className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-ink disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
