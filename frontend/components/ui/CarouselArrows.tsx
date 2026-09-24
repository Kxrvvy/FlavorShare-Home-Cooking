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
  /** "small" (32.5px, against the default 36px) is for a pair that sits
   * under a card rather than beside a heading. */
  size?: "default" | "small";
  /** Announced to screen readers, e.g. "featured recipes". */
  label: string;
};

export function CarouselArrows({
  onPrevious,
  onNext,
  canGoPrevious,
  canGoNext,
  tone = "ink",
  size = "default",
  label,
}: CarouselArrowsProps) {
  const small = size === "small";
  const base = `grid ${
    small ? "h-[32.5px] w-[32.5px]" : "h-9 w-9"
  } place-items-center rounded-full border transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon ${
    // The small pair is easy to lose against a cream panel: a disabled
    // Previous on the first card, at the default 35% over a 40% border,
    // all but vanishes. Stronger border and a milder fade keep both buttons
    // findable without changing their size.
    small ? "disabled:opacity-60" : "disabled:opacity-35"
  }`;
  const colour =
    tone === "light"
      ? "border-white/80 text-white"
      : `${small ? "border-ink/70" : "border-ink/40"} text-ink hover:border-ink`;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onPrevious}
        disabled={!canGoPrevious}
        aria-label={`Previous ${label}`}
        className={`${base} ${colour}`}
      >
        <Chevron direction="left" small={small} />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!canGoNext}
        aria-label={`Next ${label}`}
        className={`${base} ${colour}`}
      >
        <Chevron direction="right" small={small} />
      </button>
    </div>
  );
}

function Chevron({
  direction,
  small,
}: {
  direction: "left" | "right";
  small: boolean;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`${small ? "h-[14px] w-[14px]" : "h-4 w-4"} ${
        direction === "left" ? "" : "rotate-180"
      }`}
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
