import type { Difficulty, Recipe } from "./types";

/* The card meta line, e.g. "40 MIN - EASY PREP - 3 SERVES".
 *
 * The design shows one time value; the API stores prep_time and cook_time
 * separately. Summing them is the reading the mockup supports - its longest
 * recipe reads "1 HOUR - HARD PREP - 4 SERVES" against a recipe that is an hour
 * in the oven plus preparation.
 *
 * Done here rather than on the server so the two columns stay separate and
 * independently editable; only the card needs them added up.
 */

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} MIN`;

  const hours = minutes / 60;
  // "1 HOUR", "2 HOURS", but "1.5 HOURS" rather than a rounded-away half.
  const value = Number.isInteger(hours) ? hours : Math.round(hours * 10) / 10;
  return `${value} ${value === 1 ? "HOUR" : "HOURS"}`;
}

export function formatDifficulty(difficulty: Difficulty | null): string | null {
  return difficulty ? `${difficulty.toUpperCase()} PREP` : null;
}

/** Real community signal, for a recipe with none of prep/cook/servings/
 * difficulty to show - the imported TheMealDB catalogue, mainly, since that
 * provider has no such fields at all. Never invents a number: a recipe
 * nobody has rated or saved yet returns null here, same as the fields above
 * return null for a value nobody has recorded. */
function formatCommunityMeta(recipe: Recipe): string | null {
  return [
    recipe.avg_score != null ? `${recipe.avg_score.toFixed(1)} RATING` : null,
    recipe.save_count ? `${recipe.save_count} ${recipe.save_count === 1 ? "SAVE" : "SAVES"}` : null,
  ]
    .filter(Boolean)
    .join(" - ") || null;
}

export function formatRecipeMeta(recipe: Recipe): string {
  const total = (recipe.prep_time ?? 0) + (recipe.cook_time ?? 0);

  // Each part is dropped when its field is null rather than printed as "0 MIN"
  // or "NULL PREP" - a draft recipe can legitimately have none of them yet.
  const known = [
    total > 0 ? formatDuration(total) : null,
    formatDifficulty(recipe.difficulty),
    recipe.servings ? `${recipe.servings} SERVES` : null,
  ]
    .filter(Boolean)
    .join(" - ");

  // A recipe with none of the above - the whole imported catalogue, which
  // carries no structured prep/cook/servings/difficulty at all - falls back
  // to what people have actually done with it, rather than leaving the card
  // blank wherever a rating or save exists to show. Genuinely untried
  // recipes still show nothing here, same as this project treats every
  // other "nobody has recorded this yet" case.
  return known || formatCommunityMeta(recipe) || "";
}
