import type { Metadata } from "next";

import { RequireSignIn } from "@/components/auth/RequireSignIn";
import { AppShell } from "@/components/layout/AppShell";
import { AccountSettings } from "@/features/account/components/AccountSettings";

export const metadata: Metadata = {
  title: "Settings | FlavorShare",
};

/* A registered user's own profile and password - the same AccountSettings
 * an admin gets at /admin/settings, reached from the regular AppShell
 * instead of the admin panel. Both endpoints (GET/PATCH /api/accounts/me/,
 * POST /api/accounts/password/) already work for any signed-in account, so
 * this page needed no backend change - only somewhere for a non-admin to
 * reach them, which did not exist until now.
 */
export default function MeSettingsPage() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[900px] px-5 py-10 lg:px-6 lg:py-14">
        <RequireSignIn next="/me/settings" action="change your account settings">
          <h1 className="font-display text-2xl font-semibold text-ink">Settings</h1>
          <div className="mt-8">
            <AccountSettings />
          </div>
        </RequireSignIn>
      </div>
    </AppShell>
  );
}
