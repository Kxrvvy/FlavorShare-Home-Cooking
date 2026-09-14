/* Where the Django API lives.
 *
 * One definition, imported by everything that talks to the backend. Before
 * this there were two: features/recipes/api.ts read the environment variable,
 * while the login page hardcoded http://127.0.0.1:8000 - so login would have
 * kept pointing at localhost from a deployed frontend.
 *
 * The value INCLUDES the /api prefix, because that is what
 * NEXT_PUBLIC_API_BASE_URL already meant where it was first used. Callers
 * therefore pass paths like "/token/" and "/recipes/", not "/api/token/".
 *
 * NEXT_PUBLIC_ is required for the browser to see it: this is read in client
 * components, and Next only exposes variables with that prefix to the bundle.
 * It is inlined at build time, so a deployed build needs it set before
 * `next build`, not at runtime.
 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000/api";

/* Turning an API failure into something a form can show.
 *
 * DRF answers in two shapes and they mean different things to a user:
 *
 *   {"username": ["This username is taken."]}   a field the person can fix
 *   {"detail": "Email is not configured..."}    something they cannot
 *
 * The second covers the email layer's 503 and 502 as well as auth's 401, and it
 * has to reach the screen verbatim - "registration failed" would send someone
 * hunting for a typo when the real problem is a missing API key on the server.
 */

import axios from "axios";

export type ApiErrors = {
  /** Keyed by field name, ready to drop into a form's error state. */
  fields: Record<string, string>;
  /** A whole-form message, or null when every problem belongs to a field. */
  message: string | null;
};

export function extractApiErrors(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): ApiErrors {
  if (!axios.isAxiosError(error)) {
    return { fields: {}, message: fallback };
  }

  // No response at all: the request never arrived. Worth saying plainly rather
  // than blaming whatever the person just typed.
  if (!error.response) {
    return {
      fields: {},
      message: "Could not reach the server. Is the backend running?",
    };
  }

  const data = error.response.data;

  if (typeof data === "string") return { fields: {}, message: data };

  if (data && typeof data === "object") {
    const body = data as Record<string, unknown>;

    if (typeof body.detail === "string") {
      return { fields: {}, message: body.detail };
    }

    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      // DRF gives a list per field; a form shows one line, so take the first.
      const text = Array.isArray(value) ? value[0] : value;
      if (typeof text === "string") fields[key] = text;
    }

    if (Object.keys(fields).length > 0) return { fields, message: null };
  }

  return { fields: {}, message: fallback };
}
