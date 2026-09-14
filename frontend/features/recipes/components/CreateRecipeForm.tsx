"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  addIngredient,
  addStep,
  ApiError,
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
import { useSession } from "@/lib/useSession";

function makeId() {
  return crypto.randomUUID();
}

/* Accepts the abbreviations people actually type, including the two this form
 * advertises. The previous pattern allowed min/minute/minutes and
 * h/hour/hours, but not "mins" or "hr" - so "45 mins" and "1 hr 30 mins", the
 * placeholder's own example and the wording of the error shown when parsing
 * fails, were both rejected. A bare number is read as minutes, which is what
 * someone typing "90" into a cooking-time box means. */
function parseMinutes(value: string) {
  const match = value.trim().match(/^(?:(\d+)\s*h(?:ours?|rs?)?\s*)?(?:(\d+)\s*(?:m(?:in(?:ute)?s?)?)?)?$/i);
  if (!match || (!match[1] && !match[2])) return null;
  return Number(match[1] || 0) * 60 + Number(match[2] || 0);
}

/* Which input an API field error belongs to. The API names a column, the form
 * names a box; anything without a box falls to the status line rather than
 * being dropped. */
const FIELD_TO_INPUT: Record<string, keyof RecipeFormErrors> = {
  title: "title",
  servings: "servingSize",
  cook_time: "cookingTime",
  prep_time: "prepTime",
  cuisine_type: "cuisine",
  difficulty: "difficulty",
};

/* Recipe.difficulty is an enum of exactly these three, so unlike units this is
 * a real closed set and belongs in a <select>. The blank option is the default:
 * the column is nullable and not every cook wants to grade their own recipe. */
const DIFFICULTIES = ["easy", "medium", "hard"] as const;

/* Matches MAX_IMAGE_UPLOAD_BYTES in backend/settings.py. The server refuses an
 * oversized file either way; checking here means it is refused when the photo is
 * chosen, rather than after the whole recipe has been typed and the upload is
 * the last thing standing between the author and a published recipe. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function tooLarge(file: File) {
  return file.size > MAX_IMAGE_BYTES;
}

/* Name the row a failure came from.
 *
 * Ingredients and steps are sent as a list of identical-looking requests, so
 * "This recipe already has a step 3." is not much use on its own. The API's
 * field map is carried through unchanged - those fields are still reported
 * where they can be - only the readable message gains the row.
 */
async function withRowContext<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) {
      throw new ApiError(error.status, error.fields, `${label}: ${error.message}`);
    }
    throw error;
  }
}

/* Suggested units. A datalist rather than a <select>, because the column takes
 * any 30 characters and cooking has no closed set of units - "cloves",
 * "sprigs" and "cans" all have to be typeable, while the common ones stay one
 * click away. */
const UNITS = [
  "g", "kg", "ml", "l", "tsp", "tbsp", "cup", "cups",
  "piece", "pieces", "clove", "cloves", "slice", "slices",
  "pinch", "can", "pack",
];

/* quantity is DECIMAL(6,2): four digits before the point at most and two after,
 * so 9999.99 is the ceiling. Checked here so an amount the column cannot hold
 * is caught beside the box, rather than as a 400 after the recipe row already
 * exists. */
const QUANTITY = /^\d{1,4}(\.\d{1,2})?$/;

type IngredientPayload = { name: string; quantity?: string; unit?: string };

/* Drop repeats before sending.
 *
 * (recipe, ingredient) is unique and the server folds names to a canonical
 * form, so "Flour" typed twice - or "flour" and " Flour " - is one row to the
 * database and an IntegrityError on the second request. Only the name decides
 * it: two rows naming the same ingredient are a duplicate whatever amounts they
 * carry. The server stays the authority on what counts as the same name.
 */
function dedupeIngredients(values: IngredientPayload[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function CreateRecipeForm() {
  /* Whose kitchen this is. RequireSignIn guarantees somebody is signed in by the
   * time this renders, but the session is still read after hydration, so the
   * byline is blank for a frame rather than showing a name that might be wrong.
   * It used to read "@Username123" for everyone. */
  const { user } = useSession();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [servingSize, setServingSize] = useState("");
  const [cookingTime, setCookingTime] = useState("");
  const [prepTime, setPrepTime] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [ingredients, setIngredients] = useState<IngredientInput[]>([
    { id: makeId(), quantity: "", unit: "", name: "" },
  ]);
  const [steps, setSteps] = useState<StepInput[]>([
    { id: makeId(), text: "", image: null, preview: null },
  ]);
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
    if (file && tooLarge(file)) {
      setErrors((current) => ({ ...current, image: "Images must be 10MB or smaller." }));
      return;
    }
    setErrors((current) => ({ ...current, image: undefined }));
    setImage(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  }

  /* Mirrors handleImageChange for the cover, per step. The old object URL is
   * revoked before it is replaced, so choosing several photos in a row does not
   * leak one blob each time. */
  function setStepImage(id: string, file: File | null) {
    if (file && !file.type.startsWith("image/")) {
      setErrors((current) => ({ ...current, steps: "Step photos must be image files." }));
      return;
    }
    if (file && tooLarge(file)) {
      setErrors((current) => ({ ...current, steps: "Step photos must be 10MB or smaller." }));
      return;
    }
    setErrors((current) => ({ ...current, steps: undefined }));
    setSteps((current) =>
      current.map((entry) => {
        if (entry.id !== id) return entry;
        if (entry.preview) URL.revokeObjectURL(entry.preview);
        return { ...entry, image: file, preview: file ? URL.createObjectURL(file) : null };
      })
    );
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
    // Optional, so only a value that was typed and cannot be read is an error.
    if (prepTime.trim() && !parseMinutes(prepTime)) {
      nextErrors.prepTime = "Use a time such as 15 mins, or leave it empty.";
    }
    const named = ingredients.filter((item) => item.name.trim());
    if (named.length === 0) {
      nextErrors.ingredients = "Add at least one ingredient.";
    } else if (named.some((item) => item.quantity.trim() && !QUANTITY.test(item.quantity.trim()))) {
      nextErrors.ingredients = "Amounts must be numbers like 200 or 1.5, up to 9999.99.";
    } else if (named.some((item) => item.name.trim().length > 100)) {
      nextErrors.ingredients = "Ingredient names must be 100 characters or fewer.";
    }
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
          ...(prepTime.trim() ? { prep_time: parseMinutes(prepTime) as number } : {}),
          ...(cuisine.trim() ? { cuisine_type: cuisine.trim() } : {}),
          ...(difficulty ? { difficulty: difficulty as (typeof DIFFICULTIES)[number] } : {}),
        },
        token
      );

      /* One at a time, in order.
       *
       * Steps carry their own number now, so they no longer collide whichever
       * way they are sent. Sending them in sequence is what makes a failure
       * nameable - "Step 3" rather than "something failed" - and it keeps two
       * ingredients that fold to the same name from reaching the server
       * together. The cost is a round trip per row, which for a recipe-sized
       * list is not worth optimising away.
       */
      const ingredientRows = dedupeIngredients(
        ingredients
          .filter((item) => item.name.trim())
          .map((item) => ({
            name: item.name.trim(),
            // Empty stays undefined so addIngredient omits the key entirely;
            // both columns are nullable and "" is not a valid decimal.
            quantity: item.quantity.trim() || undefined,
            unit: item.unit.trim() || undefined,
          }))
      );
      for (const [index, ingredient] of ingredientRows.entries()) {
        await withRowContext(`Ingredient ${index + 1}`, () =>
          addIngredient(recipe.recipe_id, ingredient, token)
        );
      }

      /* Kept as objects, not strings, because each one may carry a photo - and
       * that photo can only be attached once its step exists and has an id. */
      const written = steps.filter((item) => item.text.trim());
      const stepIds: number[] = [];
      for (const [index, step] of written.entries()) {
        const created = await withRowContext(`Step ${index + 1}`, () =>
          addStep(recipe.recipe_id, step.text.trim(), index + 1, token)
        );
        stepIds.push(created.step_id);
      }

      if (image) {
        const uploaded = await uploadRecipeImage(image, token);
        await attachRecipeImage(recipe.recipe_id, uploaded.url, token);
      }
      /* After the steps, because each attach needs the step_id collected above,
       * and after the cover for no reason beyond reading in the order the page
       * is filled in. */
      for (const [index, step] of written.entries()) {
        if (!step.image) continue;
        await withRowContext(`Step ${index + 1} photo`, async () => {
          const uploaded = await uploadRecipeImage(step.image as File, token);
          return attachRecipeImage(recipe.recipe_id, uploaded.url, token, {
            type: "step",
            step: stepIds[index],
          });
        });
      }

      await publishRecipe(recipe.recipe_id, token);
      setStatus("success");
      setStatusMessage("Recipe published successfully.");
    } catch (error) {
      setStatus("error");

      if (error instanceof ApiError) {
        /* Put what the server said beside the box it is about. A rejected title
         * belongs on the title input; anything this form has no box for - a
         * step number, a status transition - stays in the status line rather
         * than vanishing, which is what used to happen to all of it. */
        const fieldErrors: RecipeFormErrors = {};
        const unplaced: string[] = [];

        for (const [field, message] of Object.entries(error.fields)) {
          const input = FIELD_TO_INPUT[field];
          if (input) fieldErrors[input] = message;
          else unplaced.push(message);
        }

        const placed = Object.keys(fieldErrors).length > 0;
        if (placed) setErrors((current) => ({ ...current, ...fieldErrors }));

        if (unplaced.length > 0) setStatusMessage(unplaced.join(" "));
        else if (placed) setStatusMessage("Please fix the highlighted fields before continuing.");
        else setStatusMessage(error.message);

        return;
      }

      setStatusMessage(error instanceof Error ? error.message : "Something went wrong.");
    }
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setServingSize("");
    setCookingTime("");
    setPrepTime("");
    setCuisine("");
    setDifficulty("");
    setIngredients([{ id: makeId(), quantity: "", unit: "", name: "" }]);
    setSteps([{ id: makeId(), text: "", image: null, preview: null }]);
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
          <div className="flex items-center gap-2 text-sm text-[#6b5f4f]">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#3d5a40] text-xs font-bold uppercase text-white">
              {user ? user.username.slice(0, 1) : " "}
            </span>
            {user ? `@${user.username}` : ""}
          </div>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Share a little more about your dish!" rows={4} className="w-full resize-none rounded-md bg-[#f1e9d8] px-4 py-3 outline-none ring-[#3d5a40] focus:ring-2" />

          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold">
              Cuisine
              <input
                value={cuisine}
                onChange={(event) => setCuisine(event.target.value)}
                maxLength={50}
                placeholder="e.g. Filipino"
                className="w-full font-normal rounded-md bg-[#f1e9d8] px-3 py-2 text-sm outline-none ring-[#3d5a40] focus:ring-2"
              />
              {errors.cuisine && <p className="text-xs font-normal text-red-600">{errors.cuisine}</p>}
            </label>

            <label className="flex flex-col gap-1 text-sm font-semibold">
              Difficulty
              <select
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value)}
                className="w-40 font-normal capitalize rounded-md bg-[#f1e9d8] px-3 py-2 text-sm outline-none ring-[#3d5a40] focus:ring-2"
              >
                <option value="">Not stated</option>
                {DIFFICULTIES.map((level) => (
                  <option key={level} value={level} className="capitalize">
                    {level}
                  </option>
                ))}
              </select>
              {errors.difficulty && <p className="text-xs font-normal text-red-600">{errors.difficulty}</p>}
            </label>
          </div>
        </div>
      </div>

      <div className="mt-10 grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="mb-3 text-xl font-semibold">Ingredients</h2>
          <label className="mb-1 flex items-center gap-3 text-sm font-semibold">Serving size<input value={servingSize} onChange={(event) => setServingSize(event.target.value)} inputMode="numeric" placeholder="# of people" className="w-32 rounded-md bg-[#f1e9d8] px-3 py-2 text-sm font-normal outline-none ring-[#3d5a40] focus:ring-2" /></label>
          {errors.servingSize && <p className="mb-2 text-xs text-red-600">{errors.servingSize}</p>}
          <div className="space-y-2">
            {ingredients.map((item, index) => {
              const patch = (field: "quantity" | "unit" | "name", value: string) =>
                setIngredients((current) =>
                  current.map((entry) => (entry.id === item.id ? { ...entry, [field]: value } : entry))
                );

              return (
                <div key={item.id} className="flex gap-2">
                  <input
                    value={item.quantity}
                    onChange={(event) => patch("quantity", event.target.value)}
                    inputMode="decimal"
                    aria-label={`Amount for ingredient ${index + 1}`}
                    placeholder="200"
                    className="w-16 shrink-0 rounded-md bg-[#f1e9d8] px-3 py-2 text-sm outline-none ring-[#3d5a40] focus:ring-2"
                  />
                  <input
                    value={item.unit}
                    onChange={(event) => patch("unit", event.target.value)}
                    list="ingredient-units"
                    maxLength={30}
                    aria-label={`Unit for ingredient ${index + 1}`}
                    placeholder="g"
                    className="w-24 shrink-0 rounded-md bg-[#f1e9d8] px-3 py-2 text-sm outline-none ring-[#3d5a40] focus:ring-2"
                  />
                  <input
                    value={item.name}
                    onChange={(event) => patch("name", event.target.value)}
                    maxLength={100}
                    aria-label={`Ingredient ${index + 1}`}
                    placeholder="plain flour"
                    className="min-w-0 flex-1 rounded-md bg-[#f1e9d8] px-3 py-2 text-sm outline-none ring-[#3d5a40] focus:ring-2"
                  />
                  <button
                    type="button"
                    disabled={ingredients.length === 1}
                    onClick={() => setIngredients((current) => current.filter((entry) => entry.id !== item.id))}
                    aria-label={`Remove ingredient ${index + 1}`}
                    className="px-2 text-[#6b5f4f] hover:text-red-600 disabled:opacity-30"
                  >
                    x
                  </button>
                </div>
              );
            })}
            {/* Shared by every row; the browser shows these as suggestions
              * while still accepting anything else typed. */}
            <datalist id="ingredient-units">
              {UNITS.map((unit) => (
                <option key={unit} value={unit} />
              ))}
            </datalist>
          </div>
          {errors.ingredients && <p className="mt-2 text-xs text-red-600">{errors.ingredients}</p>}
          <button type="button" onClick={() => setIngredients((current) => [...current, { id: makeId(), quantity: "", unit: "", name: "" }])} className="mt-3 text-sm font-semibold text-[#c1440e] hover:underline">+ Ingredient</button>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold">Steps</h2>
          <label className="mb-1 flex items-center gap-3 text-sm font-semibold">Cooking time<input value={cookingTime} onChange={(event) => setCookingTime(event.target.value)} placeholder="1 hr 30 mins" className="w-40 rounded-md bg-[#f1e9d8] px-3 py-2 text-sm font-normal outline-none ring-[#3d5a40] focus:ring-2" /></label>
          {errors.cookingTime && <p className="mb-2 text-xs text-red-600">{errors.cookingTime}</p>}
          <label className="mb-1 flex items-center gap-3 text-sm font-semibold">Prep time<input value={prepTime} onChange={(event) => setPrepTime(event.target.value)} placeholder="15 mins (optional)" className="w-40 font-normal rounded-md bg-[#f1e9d8] px-3 py-2 text-sm outline-none ring-[#3d5a40] focus:ring-2" /></label>
          {errors.prepTime && <p className="mb-2 text-xs text-red-600">{errors.prepTime}</p>}
          <div className="space-y-2">
            {steps.map((item, index) => (
              <div key={item.id} className="flex items-start gap-2">
                <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#3d5a40] text-xs font-bold text-white">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1 space-y-2">
                  <textarea
                    value={item.text}
                    onChange={(event) =>
                      setSteps((current) =>
                        current.map((entry) =>
                          entry.id === item.id ? { ...entry, text: event.target.value } : entry
                        )
                      )
                    }
                    placeholder={`Describe step ${index + 1}...`}
                    rows={2}
                    className="w-full resize-none rounded-md bg-[#f1e9d8] px-3 py-2 text-sm outline-none ring-[#3d5a40] focus:ring-2"
                  />

                  <div className="flex items-center gap-2">
                    {item.preview && (
                      <img
                        src={item.preview}
                        alt={`Step ${index + 1} preview`}
                        className="h-12 w-12 shrink-0 rounded-md border border-[#dcd0b8] object-cover"
                      />
                    )}

                    <label className="cursor-pointer text-xs font-semibold text-[#c1440e] hover:underline">
                      {item.image ? "Change photo" : "+ Photo"}
                      <input
                        type="file"
                        accept="image/*"
                        aria-label={`Photo for step ${index + 1}`}
                        onChange={(event) => setStepImage(item.id, event.target.files?.[0] ?? null)}
                        className="hidden"
                      />
                    </label>

                    {item.image && (
                      <button
                        type="button"
                        onClick={() => setStepImage(item.id, null)}
                        className="text-xs text-[#6b5f4f] hover:text-red-600"
                      >
                        Remove photo
                      </button>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={steps.length === 1}
                  onClick={() => setSteps((current) => current.filter((entry) => entry.id !== item.id))}
                  aria-label={`Remove step ${index + 1}`}
                  className="mt-2 px-2 text-[#6b5f4f] hover:text-red-600 disabled:opacity-30"
                >
                  x
                </button>
              </div>
            ))}
          </div>
          {errors.steps && <p className="mt-2 text-xs text-red-600">{errors.steps}</p>}
          <button type="button" onClick={() => setSteps((current) => [...current, { id: makeId(), text: "", image: null, preview: null }])} className="mt-3 text-sm font-semibold text-[#c1440e] hover:underline">+ Step</button>
        </section>
      </div>
    </form>
  );
}
