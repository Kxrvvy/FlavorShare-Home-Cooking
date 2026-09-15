/* The brand mark: a concentric swirl in a circle, with the name beside it. Drawn as SVG rather than shipped as an image so it stays crisp and can
 * take its colour from wherever it sits - dark ink in the mobile header, cream
 * in the footer. */

type LogoProps = {
  /** Footer sits on near-black, so the mark and name invert there. */
  tone?: "ink" | "cream";
  /** Just the swirl, for the collapsed sidebar where there is no room to read. */
  mark?: boolean;
  className?: string;
};

export function Logo({ tone = "ink", mark = false, className = "" }: LogoProps) {
  const text = tone === "cream" ? "text-card" : "text-ink";

  return (
    <span className={`inline-flex items-center gap-2 ${text} ${className}`}>
      <svg
        viewBox="0 0 40 40"
        aria-hidden="true"
        className="h-9 w-9 shrink-0"
        fill="none"
      >
        <circle cx="20" cy="20" r="19" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M20 31c-6 0-11-4.6-11-10.3C9 15.6 13 12 18 12c4.2 0 7.5 3 7.5 6.8 0 3.2-2.6 5.7-5.8 5.7-2.6 0-4.7-2-4.7-4.4 0-2 1.6-3.6 3.6-3.6 1.6 0 2.9 1.2 2.9 2.7"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
      {mark ? (
        <span className="sr-only">FlavorShare</span>
      ) : (
        <span className="font-display text-sm font-semibold whitespace-nowrap">
          FlavorShare
        </span>
      )}
    </span>
  );
}
