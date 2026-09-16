import type { ReactNode } from "react";

import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { AdminShell } from "@/components/layout/AdminShell";

/* Every /admin/* route shares this: the gate first, the shell only once it
 * passes. A non-admin who lands here sees the "Admins only" card, never the
 * sidebar - the panel is meant to read as a separate, privileged area, not a
 * tab on the regular site that happens to refuse its content.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAdmin>
      <AdminShell>{children}</AdminShell>
    </RequireAdmin>
  );
}
