import type { Paginated, Recipe } from "./types";

/* Stand-in data, shaped exactly like GET /api/recipes/.
 *
 * The titles, descriptions and timings are the ones in the Figma mockup, so the
 * page renders as designed rather than as lorem. Photos were cropped out of the
 * export itself and live in public/recipes/.
 *
 * When the API is wired up, the three selector functions at the bottom are what
 * change - each becomes a fetch against a query string that already exists:
 *
 *   getTrending()  -> /api/recipes/?ordering=-view_count
 *   getFeatured()  -> /api/recipes/?featured=true
 *   getExplore()   -> /api/recipes/?tag=<chip>
 *
 * Nothing above them, and no component, should need to change.
 */

const AUTHOR = { user_id: 1, username: "johnmike" };
const NOW = "2026-01-15T09:00:00Z";

function recipe(partial: Partial<Recipe> & Pick<Recipe, "recipe_id" | "title">): Recipe {
  return {
    user: AUTHOR,
    description: "",
    cuisine_type: null,
    prep_time: null,
    cook_time: null,
    servings: null,
    difficulty: null,
    status: "published",
    view_count: 0,
    cover_image: null,
    avg_score: null,
    save_count: 0,
    created_at: NOW,
    updated_at: NOW,
    featured: false,
    tags: [],
    ...partial,
  };
}

export const RECIPES: Recipe[] = [
  recipe({
    recipe_id: 1,
    title: "Mike's famous salad with cheese",
    description:
      "A crisp, generous salad built on shaved vegetables, herbed croutons and plenty of cheese.",
    cuisine_type: "Mediterranean",
    prep_time: 15,
    cook_time: 10,
    servings: 2,
    difficulty: "easy",
    cover_image: "/recipes/hero-salad.jpg",
    view_count: 4120,
    avg_score: 4.6,
    save_count: 212,
    tags: ["quick bite"],
  }),
  recipe({
    recipe_id: 2,
    title: "Savory Herb-Infused Chicken",
    description:
      "Indulge in the rich and savory symphony of flavors with our Savory Herb-Infused Chicken",
    cuisine_type: "American",
    prep_time: 15,
    cook_time: 25,
    servings: 3,
    difficulty: "easy",
    cover_image: "/recipes/featured-1.jpg",
    view_count: 2870,
    avg_score: 4.4,
    save_count: 168,
    featured: true,
    tags: ["dinner"],
  }),
  recipe({
    recipe_id: 3,
    title: "Decadent Chocolate Mousse",
    description:
      "Dive into the velvety indulgence of our Decadent Chocolate Mousse. A dessert that transcends sweetness!",
    cuisine_type: "French",
    prep_time: 20,
    cook_time: 10,
    servings: 4,
    difficulty: "medium",
    cover_image: "/recipes/featured-2.jpg",
    view_count: 3310,
    avg_score: 4.8,
    save_count: 240,
    featured: true,
    tags: ["dessert"],
  }),
  recipe({
    recipe_id: 4,
    title: "Lemon Garlic Grilled Chicken",
    description:
      "Experience the perfect blend of zesty lemon and aromatic garlic with this roasted chicken recipe",
    cuisine_type: "Mediterranean",
    prep_time: 20,
    cook_time: 40,
    servings: 4,
    difficulty: "hard",
    cover_image: "/recipes/explore-2.jpg",
    view_count: 1980,
    avg_score: 4.2,
    save_count: 96,
    tags: ["dinner"],
  }),
  recipe({
    recipe_id: 5,
    title: "Quinoa Veggie Stir-Fry",
    description:
      "Quick, wholesome, and bursting with flavors, it's perfect for a healthy weeknight dinner.",
    cuisine_type: "Asian",
    prep_time: 10,
    cook_time: 20,
    servings: 3,
    difficulty: "easy",
    cover_image: "/recipes/explore-3.jpg",
    view_count: 1540,
    avg_score: 4.5,
    save_count: 131,
    tags: ["vegan", "lunch"],
  }),
  recipe({
    recipe_id: 6,
    title: "Berry Bliss Smoothie Bowl",
    description:
      "This berry smoothie bowl is not only visually appealing but also a powerhouse of antioxidants.",
    cuisine_type: "American",
    prep_time: 10,
    cook_time: 0,
    servings: 2,
    difficulty: "easy",
    cover_image: "/recipes/explore-4.jpg",
    view_count: 2210,
    avg_score: 4.7,
    save_count: 187,
    tags: ["vegan", "breakfast"],
  }),
  recipe({
    recipe_id: 7,
    title: "Spaghetti Aglio e Olio",
    description:
      "A minimalist yet flavorful dish with garlic, olive oil, and a hint of red pepper flakes.",
    cuisine_type: "Italian",
    prep_time: 5,
    cook_time: 15,
    servings: 2,
    difficulty: "easy",
    cover_image: "/recipes/explore-5.jpg",
    view_count: 3640,
    avg_score: 4.3,
    save_count: 205,
    tags: ["dinner", "quick bite"],
  }),
  recipe({
    recipe_id: 8,
    title: "Grilled Veggies with Sauce",
    description:
      "Served with a zesty chimichurri sauce its a perfect addition to your outdoor gatherings.",
    cuisine_type: "Argentinian",
    prep_time: 15,
    cook_time: 10,
    servings: 6,
    difficulty: "medium",
    cover_image: "/recipes/explore-6.jpg",
    view_count: 1120,
    avg_score: 4.1,
    save_count: 74,
    tags: ["vegan", "dinner"],
  }),
  recipe({
    recipe_id: 9,
    title: "Herb Roasted Chicken Thighs",
    description:
      "Crisp skin, soft herbs and a pan of roasting juices worth spooning over everything.",
    cuisine_type: "American",
    prep_time: 15,
    cook_time: 25,
    servings: 3,
    difficulty: "easy",
    cover_image: "/recipes/explore-1.jpg",
    view_count: 2050,
    avg_score: 4.4,
    save_count: 143,
    tags: ["dinner"],
  }),
];

function page(results: Recipe[]): Paginated<Recipe> {
  return { count: results.length, next: null, previous: null, results };
}

/** The hero carousel. Stands in for ?ordering=-view_count. */
export function getTrending(): Paginated<Recipe> {
  return page(
    [...RECIPES].sort((a, b) => b.view_count - a.view_count).slice(0, 5),
  );
}

/** The FEATURED RECIPES panel. Stands in for ?featured=true. */
export function getFeatured(): Paginated<Recipe> {
  return page(RECIPES.filter((r) => r.featured));
}

/** The explore grid. Stands in for ?tag=<chip>, or no filter for "All". */
export function getExplore(tag?: string): Paginated<Recipe> {
  const results = RECIPES.filter((r) => r.recipe_id !== 1).filter(
    (r) => !tag || r.tags.includes(tag),
  );
  return page(results.slice(0, 6));
}

export const CATEGORIES = [
  "All",
  "Vegan",
  "Breakfast",
  "Lunch",
  "Dinner",
  "Dessert",
  "Quick Bite!",
] as const;
