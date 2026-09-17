/* /recipes has one filter surface (search, tag, cuisine, difficulty,
 * ingredient, four time bounds, ordering, page) shared by three separate
 * client controls - the category chips, the filters form, and the pager.
 * Threading each field through as its own prop to all three does not scale,
 * so every control instead gets the whole current query as a plain record
 * and calls buildUrl() with only the fields it owns.
 */

export function buildUrl(
  current: Record<string, string>,
  patch: Record<string, string | undefined>
): string {
  const query = new URLSearchParams(current);

  for (const [key, value] of Object.entries(patch)) {
    if (value) query.set(key, value);
    else query.delete(key);
  }

  // Changing any filter restarts pagination - a page number that made sense
  // for the old result set rarely still does for the new one.
  if (!("page" in patch)) query.delete("page");
  if (query.get("page") === "1") query.delete("page");

  const search = query.toString();
  return search ? `/recipes?${search}` : "/recipes";
}
