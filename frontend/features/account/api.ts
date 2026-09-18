/* The caller's own account: /api/accounts/me/ and /api/accounts/password/.
 *
 * Both endpoints have existed since accounts/views.py was built, but nothing
 * in the frontend ever called them - there was no page for a user, admin or
 * otherwise, to edit their own profile or change their password. This is
 * that client, first used by the admin Settings page.
 *
 * request/ApiError are imported rather than redefined, the same reason every
 * other feature module's api.ts gives.
 */

import { request } from "@/features/recipes/api";
import type { SessionUser } from "@/lib/auth";

export async function getMe() {
  return request<SessionUser>("/accounts/me/");
}

/** `role` is read-only on the backend serializer regardless of what is sent
 * here - the type only offers the three fields a user may actually change. */
export async function updateMe(
  patch: Partial<Pick<SessionUser, "username" | "email" | "dietary_preferences">>
) {
  return request<SessionUser>("/accounts/me/", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** 204, no body. Revokes every refresh token the account holds - including
 * the one this session is using - so the caller is expected to sign out
 * right after a successful call, not merely re-render with new data. */
export async function changePassword(current_password: string, new_password: string) {
  return request<void>("/accounts/password/", {
    method: "POST",
    body: JSON.stringify({ current_password, new_password }),
  });
}
