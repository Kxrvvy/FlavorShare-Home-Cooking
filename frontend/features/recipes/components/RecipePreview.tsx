"use client";

/* What the recipe will look like once it is published.
 *
 * Modelled on the recipe page in the Figma export - the coral RECIPE pill, the
 * centred title over a wide photo, the cream ingredients panel, INSTRUCTIONS in
 * numbered steps - so the preview is a rehearsal of the real page rather than a
 * second design nobody else will ever see.
 *
 * It shows only what the builder actually holds. The design also has equipment,
 * nutrition, long-form prose and per-step headings, and none of those exist as
 * fields yet; inventing them here would preview a recipe the author cannot
 * write. Those sections are simply absent until the columns are.
 *
 * Fed from the builder's live state rather than the server, so it reflects what
 * has been typed this second, including a row that has not saved yet.
 */

type PreviewIngredient = {
  key: string;
  quantity: string;
  unit: string;
  name: string;
};

type PreviewStep = {
  key: string;
  text: string;
  preview: string | null;
};

type Props = {
  title: string;
  description: string;
  servings: string;
  prepTime: string;
  cookTime: string;
  cuisine: string;
  difficulty: string;
  cover: string | null;
  tags: string[];
  ingredients: PreviewIngredient[];
  steps: PreviewStep[];
  author?: string;
};

function Meta({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 font-display text-xs font-semibold uppercase tracking-widest text-ink">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-4 w-4 text-maroon"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={icon} />
      </svg>
      {children}
    </span>
  );
}

const CLOCK = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4.5V12l3 2";
const KNIFE = "M4 4l9 9m-3 3l-4 4-2-2 4-4m6-3l4-4V3l-6 6";
const PLATE = "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z";

export function RecipePreview({
  title,
  description,
  servings,
  prepTime,
  cookTime,
  cuisine,
  difficulty,
  cover,
  tags,
  ingredients,
  steps,
  author,
}: Props) {
  const written = ingredients.filter((row) => row.name.trim());
  const instructions = steps.filter((row) => row.text.trim());

  return (
    <article className="pb-16">
      <header className="mx-auto max-w-[620px] text-center">
        <span className="inline-block rounded-full bg-coral px-4 py-1 font-display text-[11px] font-semibold uppercase tracking-widest text-card">
          Recipe
        </span>

        <h1 className="mt-5 text-balance font-display text-3xl font-bold uppercase leading-tight text-ink lg:text-4xl">
          {title.trim() || "Untitled recipe"}
        </h1>

        {description.trim() && (
          <p className="mt-4 text-sm leading-relaxed text-slate">{description.trim()}</p>
        )}

        {(cookTime.trim() || difficulty || servings.trim() || cuisine.trim()) && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            {cookTime.trim() && <Meta icon={CLOCK}>{cookTime.trim()}</Meta>}
            {difficulty && <Meta icon={KNIFE}>{difficulty} prep</Meta>}
            {servings.trim() && (
              <Meta icon={PLATE}>
                {servings.trim()} {Number(servings) === 1 ? "serve" : "serves"}
              </Meta>
            )}
            {cuisine.trim() && <Meta icon={PLATE}>{cuisine.trim()}</Meta>}
          </div>
        )}

        {tags.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-panel px-3 py-1 font-display text-[11px] font-semibold uppercase tracking-wide text-maroon"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="mt-8 overflow-hidden rounded-3xl border border-rule bg-panel">
        <div className="aspect-[16/7] w-full">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              No photo yet
            </div>
          )}
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_19rem]">
        <section className="min-w-0 lg:order-1">
          <h2 className="font-display text-2xl font-bold uppercase tracking-tight text-ink">
            Instructions
          </h2>

          {instructions.length === 0 ? (
            <p className="mt-4 text-sm text-muted">
              Steps you write will appear here, in order.
            </p>
          ) : (
            <ol className="mt-6 flex flex-col gap-8">
              {instructions.map((step, index) => (
                <li key={step.key}>
                  <p className="font-display text-xs font-semibold uppercase tracking-widest text-ember">
                    Step {index + 1}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-slate">{step.text.trim()}</p>

                  {step.preview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={step.preview}
                      alt=""
                      className="mt-4 aspect-[4/3] w-full max-w-sm rounded-2xl border border-rule object-cover"
                    />
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* The cream panel from the design, sticky beside the steps so the list
          * stays readable while you scroll the method. */}
        <aside className="lg:order-2">
          <div className="rounded-2xl bg-panel p-6 lg:sticky lg:top-6">
            <h2 className="font-display text-xs font-semibold uppercase tracking-widest text-maroon">
              Ingredients
            </h2>

            {written.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Nothing listed yet.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-2.5">
                {written.map((row) => (
                  <li key={row.key} className="flex gap-2 text-sm text-ink">
                    <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-maroon" />
                    <span>
                      {[row.quantity.trim(), row.unit.trim()].filter(Boolean).join(" ")}{" "}
                      {row.name.trim()}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {prepTime.trim() && (
              <p className="mt-5 border-t border-rule pt-4 text-xs text-muted">
                Prep takes about {prepTime.trim()}.
              </p>
            )}
          </div>
        </aside>
      </div>

      {author && (
        <footer className="mt-12 flex items-center gap-3 border-t border-rule pt-6">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-maroon font-display text-sm font-semibold uppercase text-card">
            {author.slice(0, 1)}
          </span>
          <div>
            <p className="font-display text-sm font-semibold text-ink">@{author}</p>
            <p className="text-xs text-muted">Shared on FlavorShare</p>
          </div>
        </footer>
      )}
    </article>
  );
}
