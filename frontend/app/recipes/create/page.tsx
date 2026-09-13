import type { Metadata } from "next";
import CreateRecipeForm from "@/features/recipes/components/CreateRecipeForm";

export const metadata: Metadata = {
  title: "Create Recipe | FlavorShare",
};

export default function CreateRecipePage() {
  return (
    <main className="min-h-screen bg-white">
      <CreateRecipeForm />
    </main>
  );
}
