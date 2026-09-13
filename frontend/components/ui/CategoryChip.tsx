/* A category pill from the EXPLORE NEW RECIPES row.
 *
 * Rendered as a real <button> with aria-pressed rather than a styled div: these
 * will filter the grid once the API is wired in, and a control that looks
 * pressable should be reachable by keyboard from the start.
 */

type CategoryChipProps = {
  label: string;
  active: boolean;
  onSelect: () => void;
};

export function CategoryChip({ label, active, onSelect }: CategoryChipProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={[
        "rounded-full border px-6 py-2.5 font-display text-[11px] font-medium uppercase tracking-widest transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon",
        active
          ? "border-lime bg-lime text-ink"
          : "border-rule bg-canvas text-muted hover:border-ink/40 hover:text-ink",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
