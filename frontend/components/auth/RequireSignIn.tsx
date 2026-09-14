"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useSession } from "@/lib/useSession";

/* Gate for pages that need an account.
 *
 * The Create Recipe button never sends a signed-out visitor to one of these, but
 * the URL still works - typed, bookmarked, or followed from an old link - and
 * without this they would fill in an entire recipe before CreateRecipeForm
 * refused to submit it. Saying so at the door costs them nothing.
 *
 * A courtesy, not a security boundary. The session it reads lives in
 * localStorage, so anyone can forge one; what actually protects a recipe is the
 * API, which answers 401 to an unauthenticated POST whatever the browser
 * believes. This is the sign on the door, not the lock.
 *
 * Three states, not two: `ready` is false until hydration, and rendering the
 * message during that window would flash "you need an account" at someone who
 * has one, on every single load.
 */

type Props = {
  children: ReactNode;
  /** Where to send them back to once they have signed in. */
  next: string;
  /** What they were trying to do, completing "You need an account to ...". */
  action: string;
};

const BUTTON =
  "rounded-full px-6 py-3 font-display text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon";

export function RequireSignIn({ children, next, action }: Props) {
  const { user, ready } = useSession();

  if (!ready) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-5">
        <p className="text-sm text-muted">Checking your session...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-5 py-12">
        <div
          role="alert"
          className="w-full max-w-md rounded-[2rem] border border-rule bg-card p-8 text-center shadow-sm"
        >
          <h1 className="font-display text-xl font-semibold text-ink">
            You need an account to {action}
          </h1>

          <p className="mt-3 text-sm text-muted">
            Sign in and we will bring you straight back here.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href={`/login?next=${encodeURIComponent(next)}`}
              className={`${BUTTON} bg-maroon text-card`}
            >
              Sign in
            </Link>

            <Link
              href="/signup"
              className={`${BUTTON} border border-rule text-ink hover:bg-panel`}
            >
              Create account
            </Link>
          </div>

          <Link
            href="/"
            className="mt-7 inline-block text-xs font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
