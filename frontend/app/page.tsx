import { ExploreRecipes } from "@/components/home/ExploreRecipes";
import { FeaturedRecipes } from "@/components/home/FeaturedRecipes";
import { Hero } from "@/components/home/Hero";
import { AppShell } from "@/components/layout/AppShell";
import { CreateRecipeButton } from "@/components/layout/CreateRecipeButton";
import { getExplore, getFeatured, getTrending } from "@/lib/dummy-recipes";

/* The homepage.
 *
 * A Server Component that reads the data and hands it down; the three sections
 * are client components only because they hold a carousel index or a selected
 * chip. When the API is wired up, the three calls below become awaited fetches
 * and this stays a server component - which is the point of loading data here
 * rather than inside the sections.
 */

export default function HomePage() {
  const trending = getTrending();
  const featured = getFeatured();
  const explore = getExplore();

  return (
    <AppShell action={<CreateRecipeButton />}>
      <Hero recipes={trending.results} />
      <FeaturedRecipes recipes={featured.results} />
      <ExploreRecipes recipes={explore.results} />
    </AppShell>
  );
}
