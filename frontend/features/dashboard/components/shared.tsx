"use client";

/* Small pieces every admin list page repeats: the same field styling
 * RecipeBuilder already uses, and Previous/Next paged the same way the
 * activity feed on the old single-page dashboard was. */

const FIELD =
  "rounded-xl border border-rule bg-field px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon";

function PageButtons({
  page,
  hasNext,
  onChange,
}: {
  page: number;
  hasNext: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex justify-between">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-ink disabled:opacity-40"
      >
        Previous
      </button>
      <button
        type="button"
        disabled={!hasNext}
        onClick={() => onChange(page + 1)}
        className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-ink disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

export { FIELD, PageButtons };
