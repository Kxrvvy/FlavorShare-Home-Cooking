import { listMyRecipes, listSavedRecipes } from "@/features/recipes/api";

/* How many recipes sit behind each view of My recipes.
 *
 * A module store rather than per-component state, for two reasons the sweep
 * found. AppShell is rendered by every page, so fetching on mount meant two API
 * calls on every navigation - including pages like /help that show no recipes
 * at all. And the numbers were read once and never again, so creating a draft
 * left the sidebar claiming the old total until something happened to remount.
 *
 * Fetched once and served from memory; the few places that change the numbers
 * call refresh() afterwards. Same subscribe/snapshot shape as lib/auth.ts and
 * lib/sidebar.ts, so useSyncExternalStore reads it without a hydration
 * mismatch.
 */

export type CollectionCounts = {
  all: number;
  saved: number;
  mine: number;
  published: number;
};

const listeners = new Set<() => void>();

/** The snapshot. An object identity that only changes when the numbers do -
 * useSyncExternalStore compares by identity, so a fresh object every read would
 * loop forever. */
let counts: CollectionCounts | null = null;
let loadedFor: number | null = null;
let inFlight: Promise<void> | null = null;

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeToCounts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCounts(): CollectionCounts | null {
  return counts;
}

/** Null on the server and on the first client render, so the two agree. */
export function countsServerSnapshot(): null {
  return null;
}

async function load(userId: number): Promise<void> {
  try {
    const [mine, saved] = await Promise.all([
      listMyRecipes(userId),
      listSavedRecipes(),
    ]);

    /* A recipe you wrote and also saved is one recipe, counted as yours - the
     * same rule the page applies when it merges the two lists. */
    const ownIds = new Set(mine.map((recipe) => recipe.recipe_id));
    const borrowed = saved.filter((row) => !ownIds.has(row.recipe_detail.recipe_id));

    counts = {
      all: mine.length + borrowed.length,
      saved: saved.length,
      mine: mine.length,
      published: mine.filter((recipe) => recipe.status === "published").length,
    };
    loadedFor = userId;
  } catch {
    // A count is decoration; a failure should not put an error in the
    // navigation of every page.
    counts = null;
  }

  notify();
}

/** Fetch once per user. Later callers get whatever is already in memory. */
export function ensureCounts(userId: number): void {
  if (loadedFor === userId || inFlight) return;

  inFlight = load(userId).finally(() => {
    inFlight = null;
  });
}

/** After something changes the numbers: publishing, deleting, a first save. */
export function refreshCollectionCounts(userId: number): void {
  if (inFlight) return;

  inFlight = load(userId).finally(() => {
    inFlight = null;
  });
}

/** Signing out must not leave the next account looking at these. */
export function clearCollectionCounts(): void {
  counts = null;
  loadedFor = null;
  notify();
}
