"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { CarouselArrows } from "@/components/ui/CarouselArrows";
import type { Recipe } from "@/lib/types";

/* The trending carousel.
 *
 * Desktop and mobile diverge here, and not only in stacking - the mobile export
 * has an EXPLORE RECIPES button where the desktop has arrows and dot
 * indicators. Both are rendered, each shown at its own breakpoint, because one
 * is not a reflow of the other.
 *
 * Advancing is a click, with a colour-free crossfade. There is no autoplay: a
 * hero that moves on its own takes the headline away from anyone still reading
 * it, and this one carries the recipe's title and author.
 */

export function Hero({ recipes }: { recipes: Recipe[] }) {
  const [index, setIndex] = useState(0);

  if (recipes.length === 0) return null;

  const current = recipes[index];

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Trending recipes"
      className="mx-auto w-full max-w-[1320px] px-5 lg:px-6"
    >
      <div className="relative overflow-hidden rounded-3xl">
        <div className="relative aspect-[375/460] w-full sm:aspect-[1258/355]">
          {current.cover_image && (
            <Image
              src={current.cover_image}
              alt=""
              fill
              priority
              sizes="(max-width: 1320px) 100vw, 1320px"
              className="object-cover"
            />
          )}
          {/* Readability, not decoration: the headline sits on a photograph
           * whose brightness we do not control. */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/45 to-black/10" />
        </div>

        <div className="absolute inset-0 flex flex-col justify-center px-7 py-8 lg:px-14">
          <div className="max-w-md">
            <p className="font-display text-xl font-medium text-ember lg:text-base">
              Trending now
            </p>

            <h1 className="mt-2 font-display text-[2.35rem] font-bold leading-[1.12] text-white lg:mt-3 lg:text-[2.6rem]">
              {current.title}
            </h1>

            <p className="mt-3 text-lg text-white/90 lg:text-base">
              By {current.user.username}
            </p>

            {/* Mobile only - the desktop export has no button here. */}
            <Link
              href="/recipes"
              className="mt-8 inline-block rounded-full bg-[#F5A623] px-7 py-3 font-display text-[11px] font-semibold uppercase tracking-widest text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:hidden"
            >
              Explore recipes
            </Link>
          </div>

          {/* Desktop only - arrows and dots, centred at the foot of the photo. */}
          <div className="absolute inset-x-0 bottom-6 hidden flex-col items-center gap-3 sm:flex">
            <CarouselArrows
              tone="light"
              label="trending recipe"
              onPrevious={() => setIndex((i) => Math.max(0, i - 1))}
              onNext={() => setIndex((i) => Math.min(recipes.length - 1, i + 1))}
              canGoPrevious={index > 0}
              canGoNext={index < recipes.length - 1}
            />

            <ol className="flex items-center gap-1.5">
              {recipes.map((recipe, i) => (
                <li key={recipe.recipe_id}>
                  <button
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-label={`Show ${recipe.title}`}
                    aria-current={i === index ? "true" : undefined}
                    className={`block h-1.5 rounded-full transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                      i === index ? "w-5 bg-white" : "w-1.5 bg-white/55"
                    }`}
                  />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
