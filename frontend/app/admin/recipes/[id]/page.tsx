import { notFound } from "next/navigation";

import { AdminRecipeDetail } from "@/features/dashboard/components/AdminRecipeDetail";

export default async function AdminRecipeDetailPage({
  params,
}: PageProps<"/admin/recipes/[id]">) {
  const { id } = await params;
  const recipeId = Number(id);

  if (!Number.isInteger(recipeId) || recipeId <= 0) notFound();

  return <AdminRecipeDetail recipeId={recipeId} />;
}
