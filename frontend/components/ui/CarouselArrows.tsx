/* The circular previous/next pair used by the hero, the featured panel and the
 * mobile explore carousel.
 *
 * No 'use client' directive: this has no state of its own. It takes handlers
 * from whichever client component owns the index, which keeps the boundary at
 * the carousel rather than dragging an icon pair into the client bundle on its
 * own account.
 */

type CarouselArrowsProps = {
  onPrevious: () => void;
  onNext: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
  /** The hero sits on a photo and needs light arrows. */
  tone?: "ink" | "light";
  /** Announced to screen readers, e.g. "featured recipes". */
  label: string;
};

export function CarouselArrows({
  onPrevious,
  onNext,
  canGoPrevious,
  canGoNext,
  tone = "ink",
  label,
}: CarouselArrowsProps) {
  const base =
    "grid h-9 w-9 place-items-center rounded-full border transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon disabled:opacity-35";
  const colour =
    tone === "light"
      ? "border-white/80 text-white"
      : "border-ink/40 text-ink hover:border-ink";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onPrevious}
        disabled={!canGoPrevious}
        aria-label={`Previous ${label}`}
        className={`${base} ${colour}`}
      >
        <Chevron direction="left" />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!canGoNext}
        aria-label={`Next ${label}`}
        className={`${base} ${colour}`}
      >
        <Chevron direction="right" />
      </button>
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`h-4 w-4 ${direction === "left" ? "" : "rotate-180"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}
