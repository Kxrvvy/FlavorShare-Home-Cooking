import Link from "next/link";

/* The body of a route that is linked but not built yet.
 *
 * The header, the mobile menu, the footer and the Hero's only mobile button all
 * pointed at routes that did not exist, so the most prominent control on a phone
 * led to a 404. These pages exist so navigation behaves while the real sections
 * are built.
 *
 * It says the section is not finished rather than describing what it will do -
 * a page that promises features nobody has built is worse than a 404, because
 * the visitor cannot tell it is empty until they have read it.
 */

type Props = {
  title: string;
  /** One line on what will live here, in the present tense. */
  blurb: string;
};

export function ComingSoon({ title, blurb }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col items-center px-5 py-20 text-center lg:px-6 lg:py-28">
      <p className="font-display text-xs font-semibold uppercase tracking-widest text-maroon">
        Still being built
      </p>

      <h1 className="mt-3 font-display text-3xl font-semibold text-ink lg:text-4xl">
        {title}
      </h1>

      <p className="mt-4 max-w-prose text-sm text-muted lg:text-base">{blurb}</p>

      <Link
        href="/"
        className="mt-8 rounded-full bg-maroon px-6 py-3 font-display text-sm font-semibold text-card transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon"
      >
        Back to home
      </Link>
    </div>
  );
}
