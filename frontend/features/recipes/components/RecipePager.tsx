"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { PageButtons } from "@/components/ui/PageButtons";
import { buildUrl } from "@/features/recipes/browseParams";

export function RecipePager({
  current,
  page,
  hasNext,
}: {
  current: Record<string, string>;
  page: number;
  hasNext: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function goTo(next: number) {
    startTransition(() => router.push(buildUrl(current, { page: String(next) })));
  }

  return <PageButtons page={page} hasNext={hasNext} onChange={goTo} disabled={isPending} />;
}
