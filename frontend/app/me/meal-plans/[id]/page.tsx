import { notFound } from "next/navigation";

import { RequireSignIn } from "@/components/auth/RequireSignIn";
import { AppShell } from "@/components/layout/AppShell";
import { MealPlanDetail } from "@/features/mealplans/components/MealPlanDetail";

export default async function MealPlanDetailPage({
  params,
}: PageProps<"/me/meal-plans/[id]">) {
  const { id } = await params;
  const planId = Number(id);

  if (!Number.isInteger(planId) || planId <= 0) notFound();

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1000px] px-5 py-10 lg:px-6 lg:py-14">
        <RequireSignIn next={`/me/meal-plans/${planId}`} action="see this meal plan">
          <MealPlanDetail planId={planId} />
        </RequireSignIn>
      </div>
    </AppShell>
  );
}
