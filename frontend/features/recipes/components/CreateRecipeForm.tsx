"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  addIngredient,
  addStep,
  attachRecipeImage,
  createRecipe,
  publishRecipe,
  uploadRecipeImage,
} from "@/features/recipes/api";
import type {
  IngredientInput,
  RecipeFormErrors,
  StepInput,
  SubmitStatus,
} from "@/features/recipes/types";
import { getAccessToken } from "@/lib/auth";

function makeId() {
  return crypto.randomUUID();
}

function parseMinutes(value: string) {
  const match = value.trim().match(/^(?:(\d+)\s*h(?:ours?)?\s*)?(?:(\d+)\s*m(?:in(?:utes?)?)?)?$/i);
  if (!match || (!match[1] && !match[2])) return null;
  return Number(match[1] || 0) * 60 + Number(match[2] || 0);
}

export default function CreateRecipeForm() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [servingSize, setServingSize] = useState("");
  const [cookingTime, setCookingTime] = useState("");
  const [ingredients, setIngredients] = useState<IngredientInput[]>([
    { id: makeId(), text: "" },
  ]);
  const [steps, setSteps] = useState<StepInput[]>([{ id: makeId(), text: "" }]);
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<RecipeFormErrors>({});
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (file && !file.type.startsWith("image/")) {
      setErrors((current) => ({ ...current, image: "Please choose an image file." }));
      return;
    }
    setErrors((current) => ({ ...current, image: undefined }));
    setImage(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  }

  function validate() {
    const nextErrors: RecipeFormErrors = {};
    const minutes = parseMinutes(cookingTime);
    if (title.trim().length < 3) nextErrors.title = "Title should be at least 3 characters.";
    if (!/^\d+$/.test(servingSize.trim()) || Number(servingSize) <= 0) {
      nextErrors.servingSize = "Enter a whole number greater than 0.";
    }
    if (minutes === null || minutes <= 0) {
      nextErrors.cookingTime = "Use a time such as 45 mins or 1 hr 30 mins.";
    }
    if (!ingredients.some((item) => item.text.trim())) nextErrors.ingredients = "Add at least one ingredient.";
    if (!steps.some((item) => item.text.trim())) nextErrors.steps = "Add at least one step.";
    return nextErrors;
  }

  async function submitRecipe(event: FormEvent) {
    event.preventDefault();
    const validationErrors = validate();
    setErrors(validationErrors);
    if (Object.values(validationErrors).some(Boolean)) {
      setStatus("error");
      setStatusMessage("Please fix the highlighted fields before continuing.");
      return;
    }

    setStatus("submitting");
    setStatusMessage("");
    try {
      const token = getAccessToken();
      if (!token) throw new Error("Please sign in before creating a recipe.");
      const recipe = await createRecipe(
        {
          title: title.trim(),
          description: description.trim(),
          servings: Number(servingSize),
          cook_time: parseMinutes(cookingTime) as number,
        },
        token
      );
      await Promise.all([
        ...ingredients
          .map((item) => item.text.trim())
          .filter(Boolean)
          .map((ingredient) => addIngredient(recipe.recipe_id, ingredient, token)),
        ...steps
          .map((item) => item.text.trim())
          .filter(Boolean)
          .map((instruction) => addStep(recipe.recipe_id, instruction, token)),
      ]);
      if (image) {
        const uploaded = await uploadRecipeImage(image, token);
        await attachRecipeImage(recipe.recipe_id, uploaded.url, token);
      }
      await publishRecipe(recipe.recipe_id, token);
      setStatus("success");
      setStatusMessage("Recipe published successfully.");
    } catch (error) {
      setStatus("error");
      setStatusMessage(error instanceof Error ? error.message : "Something went wrong.");
    }
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setServingSize("");
    setCookingTime("");
    setIngredients([{ id: makeId(), text: "" }]);
    setSteps([{ id: makeId(), text: "" }]);
    setImage(null);
    setImagePreview(null);
    setErrors({});
    setStatus("idle");
    setStatusMessage("");
  }

  return (
    <form onSubmit={submitRecipe} noValidate className="mx-auto max-w-5xl px-5 py-10 text-[#2b2119]">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-[#e6dbc6] pb-5">
        <div aria-live="polite" className="text-sm text-[#6b5f4f]">{statusMessage}</div>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.confirm("Discard this recipe?") && resetForm()} className="rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">Delete</button>
          <button type="submit" disabled={status === "submitting"} className="rounded-md bg-[#c1440e] px-5 py-2 text-sm font-semibold text-white hover:bg-[#9e3609] disabled:opacity-50">{status === "submitting" ? "Publishing..." : "Publish"}</button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        <div>
          <div className="aspect-[3/4] overflow-hidden rounded-lg border border-[#dcd0b8] bg-[#f1e9d8]">
            {imagePreview ? <img src={imagePreview} alt="Recipe preview" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[#6b5f4f]">Upload your recipe photo</div>}
          </div>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="mt-3 w-full rounded-md bg-[#e3a008] py-2 text-sm font-semibold hover:brightness-95">{imagePreview ? "Change image" : "Upload recipe image"}</button>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageChange} className="hidden" />
          {errors.image && <p className="mt-1 text-xs text-red-600">{errors.image}</p>}
        </div>

        <div className="space-y-4">
          <div><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" aria-invalid={Boolean(errors.title)} className="w-full rounded-md bg-[#f1e9d8] px-4 py-3 text-xl font-semibold outline-none ring-[#3d5a40] focus:ring-2" />{errors.title && <p className="mt-1 text-xs text-red-600">{errors.title}</p>}</div>
          <div className="flex items-center gap-2 text-sm text-[#6b5f4f]"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#3d5a40] text-xs font-bold text-white">U</span>@Username123</div>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Share a little more about your dish!" rows={4} className="w-full resize-none rounded-md bg-[#f1e9d8] px-4 py-3 outline-none ring-[#3d5a40] focus:ring-2" />
        </div>
      </div>

      <div className="mt-10 grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="mb-3 text-xl font-semibold">Ingredients</h2>
          <label className="mb-1 flex items-center gap-3 text-sm font-semibold">Serving size<input value={servingSize} onChange={(event) => setServingSize(event.target.value)} inputMode="numeric" placeholder="# of people" className="w-32 rounded-md bg-[#f1e9d8] px-3 py-2 text-sm font-normal outline-none ring-[#3d5a40] focus:ring-2" /></label>
          {errors.servingSize && <p className="mb-2 text-xs text-red-600">{errors.servingSize}</p>}
          <div className="space-y-2">
            {ingredients.map((item, index) => <div key={item.id} className="flex gap-2"><input value={item.text} onChange={(event) => setIngredients((current) => current.map((entry) => entry.id === item.id ? { ...entry, text: event.target.value } : entry))} placeholder="e.g. 200g plain flour" className="min-w-0 flex-1 rounded-md bg-[#f1e9d8] px-3 py-2 text-sm outline-none ring-[#3d5a40] focus:ring-2" /><button type="button" disabled={ingredients.length === 1} onClick={() => setIngredients((current) => current.filter((entry) => entry.id !== item.id))} aria-label={`Remove ingredient ${index + 1}`} className="px-2 text-[#6b5f4f] hover:text-red-600 disabled:opacity-30">x</button></div>)}
          </div>
          {errors.ingredients && <p className="mt-2 text-xs text-red-600">{errors.ingredients}</p>}
          <button type="button" onClick={() => setIngredients((current) => [...current, { id: makeId(), text: "" }])} className="mt-3 text-sm font-semibold text-[#c1440e] hover:underline">+ Ingredient</button>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">Steps</h2>
          <label className="mb-1 flex items-center gap-3 text-sm font-semibold">Cooking time<input value={cookingTime} onChange={(event) => setCookingTime(event.target.value)} placeholder="1 hr 30 mins" className="w-40 rounded-md bg-[#f1e9d8] px-3 py-2 text-sm font-normal outline-none ring-[#3d5a40] focus:ring-2" /></label>
          {errors.cookingTime && <p className="mb-2 text-xs text-red-600">{errors.cookingTime}</p>}
          <div className="space-y-2">
            {steps.map((item, index) => <div key={item.id} className="flex items-start gap-2"><span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#3d5a40] text-xs font-bold text-white">{index + 1}</span><textarea value={item.text} onChange={(event) => setSteps((current) => current.map((entry) => entry.id === item.id ? { ...entry, text: event.target.value } : entry))} placeholder={`Describe step ${index + 1}...`} rows={2} className="min-w-0 flex-1 resize-none rounded-md bg-[#f1e9d8] px-3 py-2 text-sm outline-none ring-[#3d5a40] focus:ring-2" /><button type="button" disabled={steps.length === 1} onClick={() => setSteps((current) => current.filter((entry) => entry.id !== item.id))} aria-label={`Remove step ${index + 1}`} className="mt-2 px-2 text-[#6b5f4f] hover:text-red-600 disabled:opacity-30">x</button></div>)}
          </div>
          {errors.steps && <p className="mt-2 text-xs text-red-600">{errors.steps}</p>}
          <button type="button" onClick={() => setSteps((current) => [...current, { id: makeId(), text: "" }])} className="mt-3 text-sm font-semibold text-[#c1440e] hover:underline">+ Step</button>
        </section>
      </div>
    </form>
  );
}
