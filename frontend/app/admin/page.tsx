import { redirect } from "next/navigation";

/* /admin has nothing of its own to show - Dashboard is the first thing an
 * administrator sees, per the spec, so this is a redirect rather than a
 * page. The layout's RequireAdmin gate applies the same way at
 * /admin/dashboard, so this never shows anything to a non-admin either. */
export default function AdminIndexPage() {
  redirect("/admin/dashboard");
}
