"use client";

/* The tag row on the Explore page - the same CATEGORIES/CategoryChip
 * vocabulary the homepage's ExploreRecipes section uses, but a real
 * navigation instead of a client-side fetch: clicking a chip is a
 * router.push to a new /recipes?... URL, which RecipeResults (a Server
 * Component) re-fetches from. See app/recipes/page.tsx for why - one fetch
 * per interaction, not two, and Back/Forward work for free.
 */

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { CategoryChip } from "@/components/ui/CategoryChip";
import { buildUrl } from "@/features/recipes/browseParams";
import { CATEGORIES, tagLabel, tagName } from "@/lib/categories";

export function CategoryChipNav({
  current,
  tag,
}: {
  current: Record<string, string>;
  tag: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const active = tag ? tagLabel(tag) : "All";

  function select(label: string) {
    if (label === active) return;
    const url = buildUrl(current, { tag: label === "All" ? undefined : tagName(label) });
    startTransition(() => router.push(url));
  }

  return (
    <div
      role="group"
      aria-label="Filter recipes by category"
      className="mt-6 flex flex-wrap justify-center gap-2.5"
    >
      {CATEGORIES.map((label) => (
        <CategoryChip
          key={label}
          label={label}
          active={label === active}
          disabled={isPending}
          onSelect={() => select(label)}
        />
      ))}
    </div>
  );
}
