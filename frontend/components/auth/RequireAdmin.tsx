"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useSession } from "@/lib/useSession";

/* Gate for /admin. The same three-state shape RequireSignIn uses, and the
 * same caveat: this is the sign on the door, not the lock. The session lives
 * in localStorage, so anyone can forge one; what actually refuses a
 * non-admin is IsAdmin on every endpoint this page calls. A signed-in
 * registered user who somehow lands here gets told plainly rather than
 * seeing a page full of failed requests.
 */

type Props = { children: ReactNode };

export function RequireAdmin({ children }: Props) {
  const { user, ready } = useSession();

  if (!ready) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-5">
        <p className="text-sm text-muted">Checking your session...</p>
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return (
      <div className="grid min-h-[60vh] place-items-center px-5 py-12">
        <div
          role="alert"
          className="w-full max-w-md rounded-[2rem] border border-rule bg-card p-8 text-center shadow-sm"
        >
          <h1 className="font-display text-xl font-semibold text-ink">
            Admins only
          </h1>

          <p className="mt-3 text-sm text-muted">
            {user
              ? "Your account does not have admin access."
              : "Sign in with an admin account to reach the dashboard."}
          </p>

          <Link
            href={user ? "/" : "/login?next=/admin"}
            className="mt-7 inline-block rounded-full bg-maroon px-6 py-3 font-display text-sm font-semibold text-card transition-opacity hover:opacity-90"
          >
            {user ? "Back to home" : "Sign in"}
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
