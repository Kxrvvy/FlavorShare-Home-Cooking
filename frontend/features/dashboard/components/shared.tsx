"use client";

/* The field styling every admin form page repeats - the same one
 * RecipeBuilder uses. PageButtons used to live here too; it moved to
 * components/ui/PageButtons.tsx once the /recipes Explore page needed the
 * same generic pager and there was nothing admin-specific about it. */

const FIELD =
  "rounded-xl border border-rule bg-field px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon";

export { FIELD };
