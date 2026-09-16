import { notFound } from "next/navigation";

import { AdminUserDetail } from "@/features/dashboard/components/AdminUserDetail";

export default async function AdminUserDetailPage({
  params,
}: PageProps<"/admin/users/[id]">) {
  const { id } = await params;
  const userId = Number(id);

  if (!Number.isInteger(userId) || userId <= 0) notFound();

  return <AdminUserDetail userId={userId} />;
}
