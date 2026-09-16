/* The fixed set of tags a recipe can carry.
 *
 * Fixed rather than free text so the homepage chips are authoritative: Tag is
 * an open table and the API takes any name, so an author typing "vegetarian"
 * would produce a recipe no chip can reach. Decided as a starting point and
 * expected to be revisited - widening this list later costs nothing, whereas
 * un-inventing tags people have already applied does not.
 *
 * The label is what a person reads; the name is what is stored and what
 * ?tag= matches. Tag.save() lowercases and strips, so the two differ - and
 * deriving one from the other here rather than writing both out keeps them
 * from drifting apart the way two hand-written lists would.
 */

export const TAG_LABELS = [
  "Vegan",
  "Breakfast",
  "Lunch",
  "Dinner",
  "Dessert",
  "Quick Bite!",
] as const;

export type TagLabel = (typeof TAG_LABELS)[number];

/** Mirrors _normalise_tag_name in social/serializers.py. */
export function tagName(label: string): string {
  return label.trim().toLowerCase();
}

/** The label for a stored name, or the name itself if it is not one of ours -
 * a tag applied through the admin before this list existed, say. */
export function tagLabel(name: string): string {
  return TAG_LABELS.find((label) => tagName(label) === name) ?? name;
}

/** The chip row on the homepage: the tags, with "All" for no filter at all. */
export const CATEGORIES = ["All", ...TAG_LABELS] as const;
