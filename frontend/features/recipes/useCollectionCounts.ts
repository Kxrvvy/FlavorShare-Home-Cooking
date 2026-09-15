"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  countsServerSnapshot,
  ensureCounts,
  getCounts,
  subscribeToCounts,
  type CollectionCounts,
} from "@/lib/collectionCounts";
import { useSession } from "@/lib/useSession";

/** The counts behind each view of My recipes, from the shared store. */
export function useCollectionCounts(): CollectionCounts | null {
  const { user } = useSession();

  const counts = useSyncExternalStore(
    subscribeToCounts,
    getCounts,
    countsServerSnapshot
  );

  /* Asks the store to fill itself if it has not already. ensureCounts is a
   * no-op once loaded, so navigating between pages costs nothing - which is the
   * point, since this hook runs in the shell on every page. */
  useEffect(() => {
    if (user) ensureCounts(user.user_id);
  }, [user]);

  // Gated rather than cleared, so signing out needs no write during a render.
  return user ? counts : null;
}
