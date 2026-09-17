import { ExploreRecipes } from "@/components/home/ExploreRecipes";
import { FeaturedRecipes } from "@/components/home/FeaturedRecipes";
import { Hero } from "@/components/home/Hero";
import { AppShell } from "@/components/layout/AppShell";
import { CreateRecipeButton } from "@/components/layout/CreateRecipeButton";
import { getExplore, getFeatured, getTrending } from "@/lib/home-recipes";

/* The homepage.
 *
 * A Server Component that reads the data and hands it down; the three sections
 * are client components only because they hold a carousel index or a selected
 * chip (ExploreRecipes also re-fetches its own data when that chip changes -
 * see the client-side call to getExplore() there).
 */

export default async function HomePage() {
  const [trending, featured, explore] = await Promise.all([
    getTrending(),
    getFeatured(),
    getExplore(),
  ]);

  return (
    <AppShell action={<CreateRecipeButton />}>
      <Hero recipes={trending.results} />
      <FeaturedRecipes recipes={featured.results} />
      <ExploreRecipes recipes={explore.results} />
    </AppShell>
  );
}
