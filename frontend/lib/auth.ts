/* The browser's copy of who is signed in.
 *
 * This module exists because the same session was being read and written by
 * files that had each invented their own contract: the login page stored a
 * token under "access" while the create-recipe form looked for "accessToken",
 * so a signed-in user was told to sign in. Two files agreeing on a string by
 * coincidence is not a contract - this is.
 *
 * Nothing outside this file should touch localStorage for auth. If you find
 * yourself writing localStorage.getItem("access") somewhere, add a function
 * here instead.
 *
 * It is also a subscribable store, because components have to re-render when
 * the session changes and localStorage fires no event for a write made by the
 * page that owns it. See subscribeToSession below.
 *
 * Storage, not security. A token in localStorage is readable by any script on
 * the page, which is the known trade of the token-in-the-browser approach the
 * API was built for. Keeping it in one module at least means there is a single
 * place to change if that decision is ever revisited.
 */

import axios from "axios";

import { API_BASE_URL } from "@/lib/api";

/** Mirrors accounts.serializers.UserSerializer - what /accounts/me/ returns. */
export type SessionUser = {
  user_id: number;
  username: string;
  email: string;
  role: "guest" | "registered" | "admin";
  dietary_preferences: string | null;
  created_at: string;
};

export type SessionTokens = {
  access: string;
  refresh: string;
};

/* Named after the fields the API itself returns, so there is no translation
 * step to get wrong. */
const ACCESS_KEY = "access";
const REFRESH_KEY = "refresh";
const USER_KEY = "user";

/* localStorage does not exist while rendering on the server. Every caller today
 * is a client component, but a helper that throws the moment someone imports it
 * into a Server Component is a trap, so each accessor checks first. */
function storage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

/* ------------------------------------------------------------------ the store */

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Watch for session changes. Returns the unsubscribe function.
 *
 * Two sources, because neither covers the other:
 *
 *   the listener set - writes made by this tab. localStorage fires no event for
 *     its own page, so setSession and clearSession call notify() themselves.
 *   the 'storage' event - writes made by OTHER tabs. Signing out in one tab
 *     therefore signs out the header in every other open tab.
 */
export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** The stored user as the raw JSON string it is kept as.
 *
 * Returns the string rather than a parsed object on purpose: this is read
 * through useSyncExternalStore, which compares snapshots by identity, and a
 * freshly parsed object every call would re-render forever. Pair it with
 * parseSessionUser.
 */
export function getSessionSnapshot(): string | null {
  return storage()?.getItem(USER_KEY) ?? null;
}

/** Parse a snapshot. Unreadable means signed out - see getUser. */
export function parseSessionUser(raw: string | null): SessionUser | null {
  if (!raw) return null;

  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    // Anything can end up in localStorage - a half-written value, a leftover
    // from an older shape. Treat unreadable as signed out rather than throwing
    // in whichever component happened to ask.
    return null;
  }
}

/* ----------------------------------------------------------------- accessors */

/** Store a whole session at once, so the three values cannot drift apart. */
export function setSession(tokens: SessionTokens, user: SessionUser): void {
  const store = storage();
  if (!store) return;

  store.setItem(ACCESS_KEY, tokens.access);
  store.setItem(REFRESH_KEY, tokens.refresh);
  store.setItem(USER_KEY, JSON.stringify(user));
  notify();
}

export function getAccessToken(): string | null {
  return storage()?.getItem(ACCESS_KEY) ?? null;
}

export function getRefreshToken(): string | null {
  return storage()?.getItem(REFRESH_KEY) ?? null;
}

/** The signed-in user, or null if nobody is - or if what is stored is junk. */
export function getUser(): SessionUser | null {
  return parseSessionUser(getSessionSnapshot());
}

export function isSignedIn(): boolean {
  return getAccessToken() !== null;
}

/** Sign out. Used by a logout control, and by anything that gives up on a token. */
export function clearSession(): void {
  const store = storage();
  if (!store) return;

  store.removeItem(ACCESS_KEY);
  store.removeItem(REFRESH_KEY);
  store.removeItem(USER_KEY);
  notify();
}

/* Sign out, ending the session on the server as well as in this browser.
 *
 * The refresh token is blacklisted so it cannot be spent again. The access token
 * is not recalled, because a JWT cannot be - it stays usable until it expires,
 * which is why ACCESS_TOKEN_LIFETIME is kept short. LogoutView's own docstring
 * says the same thing from the other side.
 *
 * Never throws, and clears local state in a finally. The endpoint answers 400
 * for a token that is expired or already blacklisted, and somebody who clicked
 * "Sign out" has to end up signed out either way - leaving a dead token in
 * localStorage because the server disliked it is the worse outcome.
 *
 * Sends the access token too: /accounts/logout/ is IsRegisteredUser, so an
 * unauthenticated POST would be refused before the refresh token is even read.
 */
export async function signOut(): Promise<void> {
  const refresh = getRefreshToken();
  const access = getAccessToken();

  try {
    if (refresh && access) {
      await axios.post(
        `${API_BASE_URL}/accounts/logout/`,
        { refresh },
        { headers: { Authorization: `Bearer ${access}` } },
      );
    }
  } catch {
    // Nothing worth telling the user. Either the token was already dead or the
    // network is down, and both end the same way for them.
  } finally {
    clearSession();
  }
}
