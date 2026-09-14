"use client";

import { useMemo, useSyncExternalStore } from "react";

import {
  getSessionSnapshot,
  parseSessionUser,
  signOut,
  subscribeToSession,
} from "@/lib/auth";

/* Who is signed in, for components that render.
 *
 * The session lives in localStorage, which does not exist on the server, so the
 * two renders of the same markup would disagree: "signed out" from the server,
 * "signed in" from the browser. That is a hydration mismatch - React throws away
 * the server HTML and warns.
 *
 * useSyncExternalStore is the API built for exactly this. Its third argument is
 * the server snapshot, so the first render - on the server and again during
 * hydration - is always the signed-out state, and React re-renders with the real
 * session once hydrated. No effect, no setState, no mismatch.
 *
 * `ready` is the same trick applied to a boolean: false until hydrated, true
 * after. It is the difference between "nobody is signed in" and "we have not
 * looked yet". Without it, every page load flashes a signed-out header at a
 * signed-in user, because those two states look identical for one frame.
 */

/* `ready` never changes after hydration, so it needs no subscription - but
 * useSyncExternalStore requires one, hence a subscribe that unsubscribes to
 * nothing. */
const noSubscription = () => () => {};
const alwaysReady = () => true;
const neverReadyOnServer = () => false;

export function useSession() {
  // The raw JSON string, not an object: useSyncExternalStore compares snapshots
  // by identity, so parsing here would hand it a new object every call and loop.
  const raw = useSyncExternalStore(
    subscribeToSession,
    getSessionSnapshot,
    () => null,
  );

  const ready = useSyncExternalStore(
    noSubscription,
    alwaysReady,
    neverReadyOnServer,
  );

  const user = useMemo(() => parseSessionUser(raw), [raw]);

  return { user, ready, signOut };
}
