/* Admin Settings, deliberately scoped to the signed-in admin's own account
 * rather than site-wide configuration - there is no site-wide setting this
 * project's models can actually back yet (no feature flag, no site name
 * column, nothing). An admin is a user first, and this is where that admin's
 * own account settings live - the same AccountSettings a registered user
 * gets at /me/settings, just reached from inside the admin panel.
 */

import { AccountSettings } from "@/features/account/components/AccountSettings";

export default function AdminSettingsPage() {
  return <AccountSettings />;
}
