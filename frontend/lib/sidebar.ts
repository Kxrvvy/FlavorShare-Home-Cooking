/* Whether the sidebar is collapsed to icons.
 *
 * Stored rather than held in component state because AppShell is rendered by
 * each page, so it unmounts and remounts on every navigation - a collapse kept
 * in useState would spring back open the moment you clicked a nav link.
 *
 * Shaped as a subscribable store for the same reason lib/auth.ts is: it is read
 * through useSyncExternalStore, whose server snapshot keeps the first render
 * identical on both sides. Reading localStorage while rendering would give the
 * server "expanded" and the browser "collapsed" for the same markup, which is a
 * hydration mismatch.
 */

const KEY = "sidebar-collapsed";

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Watch for changes, including from another tab. Returns the unsubscribe. */
export function subscribeToSidebar(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** A boolean, so useSyncExternalStore can compare snapshots by identity. */
export function isSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    // Private windows and blocked site data both throw on access.
    return false;
  }
}

/** The server has no idea, and neither does the first client render. */
export function sidebarServerSnapshot(): boolean {
  return false;
}

export function setSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    // Not being able to remember the preference is not worth failing over.
  }
  notify();
}
