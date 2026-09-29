"use client";

import { useEffect, useState } from "react";

/* The Help page's body: guides, an FAQ, and a keyword search over both.
 *
 * Everything here describes a feature that actually exists - see the guide
 * and FAQ copy below for the specific behaviour each line is grounded in.
 * There is deliberately no "contact us" section: FlavorShare has no support
 * inbox, contact form, or forum to send anyone to, and a link that goes
 * nowhere is worse than no link (the same reasoning components/ui/ComingSoon
 * gives for not promising an unfinished feature).
 *
 * The search box looks like SearchField in the sidebar chrome, but unlike
 * that one it never navigates - it filters the guides and FAQ already on
 * this page, the way a real help center's search jumps to an article
 * instead of leaving the page.
 */

type Guide = {
  id: string;
  title: string;
  paragraphs: string[];
};

const GUIDES: Guide[] = [
  {
    id: "finding",
    title: "Finding recipes",
    paragraphs: [
      "Use the search box to look up a recipe by name. On Explore, the tag chips (Vegan, Breakfast, Lunch, Dinner, Dessert, Quick Bite!) narrow the list to recipes carrying that tag - picking more than one chip widens the results rather than narrowing them, since a recipe only needs to match one of the chips you've selected.",
      "The Filters panel adds cuisine and a minimum star rating on top of that, and those combine with the chips instead of replacing them - a cuisine plus a tag narrows the list to recipes matching both.",
      "You can also sort the results, for example by newest or by rating, from the same Explore page.",
    ],
  },
  {
    id: "saving",
    title: "Saving a recipe",
    paragraphs: [
      "The bookmark icon on a recipe card or on a recipe's own page saves it to your account. Saved recipes show up under My Collection, in the Saved tab.",
      "Saving needs an account - a guest can browse, search, and read any published recipe, but the bookmark icon only works once you're signed in.",
    ],
  },
  {
    id: "publishing",
    title: "Publishing a recipe",
    paragraphs: [
      "From My Collection, start a new recipe to open the builder. You'll fill in a title, a cover photo, your ingredients (an amount, a unit, and a name for each - the amount box takes a plain number like 2, or a fraction like 1/2 or 1 1/2), and your steps, each with an optional photo of its own.",
      "A recipe stays a Draft, visible only to you, until you publish it. Nobody else can see it - not in search, not in Explore, not through a direct link - until you do.",
    ],
  },
  {
    id: "ratings",
    title: "Ratings & reviews",
    paragraphs: [
      "On a published recipe's page, a signed-in user can leave a 1-5 star rating with a comment. You get one rating per recipe - posting again replaces your previous score and comment rather than adding a second one.",
    ],
  },
  {
    id: "meal-plans",
    title: "Meal plans",
    paragraphs: [
      "Meal plans need an account. Create a plan from Meal plans, then add any recipe you've saved or published to a day and a meal type - breakfast, lunch, dinner, or snack.",
      "One thing worth knowing: if a recipe you scheduled is later unpublished by whoever wrote it, it quietly stops appearing in your plan instead of showing an error. The entry isn't deleted - it just isn't shown while the recipe stays unpublished.",
    ],
  },
  {
    id: "account",
    title: "Your account",
    paragraphs: [
      "Signing up sends a code to your email, and your account is only created once that code is verified - there's nothing to log into before then.",
      "Forgot your password? The \"Forgot password\" link on the login page sends a reset code to your email the same way.",
    ],
  },
];

type FaqItem = {
  id: string;
  question: string;
  answer: string;
};

const FAQS: FaqItem[] = [
  {
    id: "fractions",
    question: "Why do some amounts show as fractions, like 1/2?",
    answer:
      "You can type an ingredient amount either way - as 0.5 or as 1/2 - and the recipe always displays whichever form reads more naturally, so a half cup shows as 1/2, not 0.50.",
  },
  {
    id: "missing-saved",
    question: "Why can't I find a recipe I saved?",
    answer:
      "Its author likely unpublished it. A recipe that isn't published stops appearing in your Saved list and anywhere else it was visible, even though you still saved it.",
  },
  {
    id: "missing-plan",
    question: "Why did a recipe disappear from my meal plan?",
    answer:
      "The same reason as a missing saved recipe: once its author unpublishes it, it stops showing up in any meal plan it was scheduled into.",
  },
  {
    id: "cuisine",
    question: "I can't find my cuisine in the dropdown.",
    answer: "Choose Other at the bottom of the list, and a box appears for you to type your own.",
  },
  {
    id: "guest",
    question: "Can I use FlavorShare without an account?",
    answer:
      "Yes - browsing, searching, filtering, sorting, and reading a recipe with its ratings are all open to guests. Saving a recipe, publishing one, rating one, and meal plans all need an account.",
  },
  {
    id: "chips",
    question: "Do the tag chips narrow or widen my results?",
    answer:
      "Widen. Selecting Vegan and Dessert together shows recipes matching either one, not only recipes that are both. Picking a different kind of filter, like a cuisine, narrows the results as usual.",
  },
];

function matches(query: string, ...text: string[]): boolean {
  return text.some((value) => value.toLowerCase().includes(query));
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function HelpCenter() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const q = debounced.trim().toLowerCase();
  const visibleGuides = q
    ? GUIDES.filter((guide) => matches(q, guide.title, ...guide.paragraphs))
    : GUIDES;
  const visibleFaqs = q
    ? FAQS.filter((item) => matches(q, item.question, item.answer))
    : FAQS;
  const noResults = q !== "" && visibleGuides.length === 0 && visibleFaqs.length === 0;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 lg:px-6 lg:py-14">
      <p className="font-display text-xs font-semibold uppercase tracking-widest text-maroon">
        Help center
      </p>
      <h1 className="mt-3 font-display text-3xl font-semibold text-ink lg:text-4xl">
        How can we help?
      </h1>
      <p className="mt-4 max-w-prose text-sm text-muted lg:text-base">
        Guides for finding, saving, and publishing recipes, plus answers to the questions
        that come up most.
      </p>

      <form
        role="search"
        onSubmit={(event) => event.preventDefault()}
        className="mt-6 flex w-full max-w-md items-center rounded-full bg-field pl-4 pr-1 py-1"
      >
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search help..."
          aria-label="Search help"
          className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink placeholder:text-muted focus:outline-none"
        />
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-maroon text-card">
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5" />
          </svg>
        </span>
      </form>

      {noResults ? (
        <p className="mt-10 text-sm text-muted">
          No results for &quot;{debounced.trim()}&quot;.
        </p>
      ) : (
        <>
          {visibleGuides.length > 0 && (
            <nav aria-label="Jump to a guide" className="mt-8 flex flex-wrap gap-2">
              {visibleGuides.map((guide) => (
                <a
                  key={guide.id}
                  href={`#${guide.id}`}
                  className="rounded-full border border-rule px-3.5 py-1.5 font-display text-xs font-medium text-slate transition-colors hover:bg-panel hover:text-ink"
                >
                  {guide.title}
                </a>
              ))}
            </nav>
          )}

          <div className="mt-8 flex flex-col gap-10">
            {visibleGuides.map((guide) => (
              <section key={guide.id} id={guide.id} className="scroll-mt-24">
                <h2 className="font-display text-xl font-semibold text-ink">{guide.title}</h2>
                <div className="mt-3 flex flex-col gap-3">
                  {guide.paragraphs.map((paragraph, index) => (
                    <p key={index} className="max-w-prose text-sm text-muted lg:text-base">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {visibleFaqs.length > 0 && (
            <section id="faq" className="mt-12 scroll-mt-24 border-t border-rule pt-10">
              <h2 className="font-display text-xl font-semibold text-ink">
                Frequently asked questions
              </h2>

              <ul className="mt-4 flex flex-col divide-y divide-rule">
                {visibleFaqs.map((item) => {
                  const open = openFaq === item.id;

                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setOpenFaq(open ? null : item.id)}
                        aria-expanded={open}
                        aria-controls={`faq-${item.id}`}
                        className="flex w-full items-center justify-between gap-4 py-4 text-left font-display text-sm font-medium text-ink"
                      >
                        {item.question}
                        <ChevronDown open={open} />
                      </button>
                      {open && (
                        <p id={`faq-${item.id}`} className="max-w-prose pb-4 text-sm text-muted">
                          {item.answer}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
