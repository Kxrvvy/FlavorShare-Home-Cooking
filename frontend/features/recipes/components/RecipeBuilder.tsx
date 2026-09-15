"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";

import {
  ApiError,
  addIngredient,
  addStep,
  attachRecipeImage,
  createRecipe,
  deleteIngredient,
  deleteImage,
  deleteRecipe,
  deleteStep,
  getRecipe,
  listIngredients,
  listSteps,
  publishRecipe,
  updateIngredient,
  updateRecipe,
  updateStep,
  uploadRecipeImage,
} from "@/features/recipes/api";
import { useSession } from "@/lib/useSession";

/* The recipe builder: every row saves itself.
 *
 * The form this replaces wrote fourteen things at the end and hoped. When one
 * failed, the rest were already on the server, the author was told nothing had
 * been saved, and pressing the button again created a second recipe - one more
 * orphan per attempt. Saving each row as it is finished removes all three of
 * those at once, and gives an error somewhere obvious to live: on the row it
 * belongs to.
 *
 * The title creates the draft. POST /recipes/ needs a title and nothing else,
 * and no ingredient or step can be written before a recipe exists to hang it
 * on. Everything else stays disabled until then - which also means opening the
 * builder and changing your mind leaves nothing behind.
 *
 * Saves fire on blur. The design allowed for a debounce as well; blur alone
 * turned out to be enough, because every way of leaving a field - including
 * clicking Publish - blurs it first, and a timer that races the user is a
 * source of bugs this does not need.
 */

type SaveState = "idle" | "saving" | "saved" | "error";

type RowStatus = { state: SaveState; message?: string };

const IDLE: RowStatus = { state: "idle" };
const SAVED: RowStatus = { state: "saved" };

interface IngredientDraft {
  key: string;
  rowId: number | null;
  quantity: string;
  unit: string;
  name: string;
  status: RowStatus;
}

interface StepDraft {
  key: string;
  stepId: number | null;
  /* The number the server gave this step, which is not its position. Deleting a
   * step leaves a gap on purpose - nothing renumbers the survivors - so a new
   * step numbered by position walks straight into a surviving row. Delete step
   * 2 of 3 and the next one added is position 3, which the server already has. */
  number: number | null;
  text: string;
  preview: string | null;
  imageUrl: string | null;
  imageId: number | null;
  status: RowStatus;
}

const UNITS = [
  "g", "kg", "ml", "l", "tsp", "tbsp", "cup", "cups",
  "piece", "pieces", "clove", "cloves", "slice", "slices",
  "pinch", "can", "pack",
];

const DIFFICULTIES = ["easy", "medium", "hard"] as const;

/** DECIMAL(6,2) - four digits before the point, two after. */
const QUANTITY = /^\d{1,4}(\.\d{1,2})?$/;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/* Accepts what people type, including the two formats the placeholder shows. */
function parseMinutes(value: string) {
  const match = value
    .trim()
    .match(/^(?:(\d+)\s*h(?:ours?|rs?)?\s*)?(?:(\d+)\s*(?:m(?:in(?:ute)?s?)?)?)?$/i);
  if (!match || (!match[1] && !match[2])) return null;
  return Number(match[1] || 0) * 60 + Number(match[2] || 0);
}

function minutesToText(value: number | null) {
  if (value === null) return "";
  if (value < 60) return `${value} mins`;
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return mins ? `${hours} hr ${mins} mins` : `${hours} hr`;
}

function makeKey() {
  return crypto.randomUUID();
}

function emptyIngredient(): IngredientDraft {
  return { key: makeKey(), rowId: null, quantity: "", unit: "", name: "", status: IDLE };
}

function emptyStep(): StepDraft {
  return {
    key: makeKey(), stepId: null, number: null, text: "",
    preview: null, imageUrl: null, imageId: null, status: IDLE,
  };
}

const FIELD = "rounded-md bg-[#f1e9d8] px-3 py-2 text-sm outline-none ring-[#3d5a40] focus:ring-2";

/** A row's own save indicator. Nothing is shown until a row has done something,
 * so an untouched form is not covered in spinners. */
function RowState({ status }: { status: RowStatus }) {
  if (status.state === "saving") return <span className="text-xs text-[#6b5f4f]">Saving...</span>;
  if (status.state === "saved") return <span className="text-xs text-[#3d5a40]">Saved</span>;
  return null;
}

export default function RecipeBuilder({ recipeId }: { recipeId?: number }) {
  const { user } = useSession();

  const [draftId, setDraftId] = useState<number | null>(recipeId ?? null);
  const [loading, setLoading] = useState(Boolean(recipeId));
  /* Set when an existing recipe could not be opened. Separate from `notice`
   * because it replaces the builder rather than sitting above it: the id came
   * from the URL, so a failure here means somebody else's recipe or one that no
   * longer exists, and rendering an editable form over it invites edits that
   * can only 404. */
  const [loadError, setLoadError] = useState("");
  const [published, setPublished] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [servings, setServings] = useState("");
  const [cookTime, setCookTime] = useState("");
  const [prepTime, setPrepTime] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [difficulty, setDifficulty] = useState("");

  const [ingredients, setIngredients] = useState<IngredientDraft[]>([emptyIngredient()]);
  const [steps, setSteps] = useState<StepDraft[]>([emptyStep()]);

  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  /* The Image row behind the cover, so replacing it can remove the old one
   * rather than leaving a recipe with two covers and no way to say which. */
  const [coverImageId, setCoverImageId] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [inFlight, setInFlight] = useState(0);
  const coverInput = useRef<HTMLInputElement>(null);

  /* What was last written to the server, so a blur that changed nothing does
   * not spend a request. Kept in a ref rather than state: reading it must never
   * trigger a render. */
  const saved = useRef<Record<string, string>>({});

  /* ---------------------------------------------------------------------
   * Three refs that exist because React state is not readable soon enough.
   *
   * A blur starts an async save. A second blur can arrive before the first
   * response lands, and at that moment state still says what it said before -
   * no id yet, no step number yet. Every decision a save makes about "does
   * this row exist on the server" therefore reads a ref, never state.
   * ------------------------------------------------------------------- */

  /** One save at a time per thing. Keyed "recipe" or by a row's key, so
   * different rows still save at once and only the same one queues. */
  const queue = useRef<Map<string, Promise<void>>>(new Map());

  /** Server ids, written the instant a response lands. A queued save reads the
   * id the save before it created, instead of POSTing a second row. */
  const ids = useRef<Record<string, number>>({});

  /** Reserved synchronously, because two colliding step saves belong to
   * different rows and queueing per row cannot separate them. */
  const nextNumber = useRef(1);

  function runExclusive(key: string, fn: () => Promise<void>) {
    const previous = queue.current.get(key) ?? Promise.resolve();
    const next = previous.then(fn, fn).finally(() => {
      if (queue.current.get(key) === next) queue.current.delete(key);
    });
    queue.current.set(key, next);
    return next;
  }

  const busy = (fn: () => Promise<void>) => async () => {
    setInFlight((n) => n + 1);
    try {
      await fn();
    } finally {
      setInFlight((n) => n - 1);
    }
  };

  // ------------------------------------------------------------- loading
  useEffect(() => {
    if (!recipeId) return;

    let cancelled = false;

    (async () => {
      try {
        const [recipe, stepRows, ingredientRows] = await Promise.all([
          getRecipe(recipeId),
          listSteps(recipeId),
          listIngredients(recipeId),
        ]);
        if (cancelled) return;

        setTitle(recipe.title);
        setDescription(recipe.description ?? "");
        setServings(recipe.servings === null ? "" : String(recipe.servings));
        setCookTime(minutesToText(recipe.cook_time));
        setPrepTime(minutesToText(recipe.prep_time));
        setCuisine(recipe.cuisine_type ?? "");
        setDifficulty(recipe.difficulty ?? "");
        setPublished(recipe.status === "published");

        saved.current = {
          title: recipe.title,
          description: recipe.description ?? "",
          servings: recipe.servings === null ? "" : String(recipe.servings),
          cook_time: minutesToText(recipe.cook_time),
          prep_time: minutesToText(recipe.prep_time),
          cuisine_type: recipe.cuisine_type ?? "",
          difficulty: recipe.difficulty ?? "",
        };

        ids.current.recipe = recipeId;
        /* Past every number the server already holds, so a new step cannot land
         * on one that survived a deletion. */
        nextNumber.current =
          Math.max(0, ...stepRows.map((row) => row.step_number)) + 1;
        setCoverPreview(recipe.images?.find((i) => i.type === "final")?.url ?? null);
        setCoverImageId(recipe.images?.find((i) => i.type === "final")?.image_id ?? null);

        setIngredients(
          ingredientRows.length
            ? ingredientRows.map((row) => {
                const key = makeKey();
                ids.current[key] = row.recipe_ingredient_id;
                return {
                  key,
                  rowId: row.recipe_ingredient_id,
                  quantity: row.quantity === null ? "" : String(Number(row.quantity)),
                  unit: row.unit ?? "",
                  name: row.ingredient.name,
                  status: SAVED,
                };
              })
            : [emptyIngredient()]
        );

        setSteps(
          stepRows.length
            ? stepRows.map((row) => {
                const key = makeKey();
                ids.current[key] = row.step_id;
                return {
                key,
                stepId: row.step_id,
                number: row.step_number,
                text: row.instruction,
                preview: row.images.find((i) => i.type === "step")?.url ?? null,
                imageUrl: row.images.find((i) => i.type === "step")?.url ?? null,
                imageId: row.images.find((i) => i.type === "step")?.image_id ?? null,
                status: SAVED,
              };
              })
            : [emptyStep()]
        );
      } catch (error) {
        if (!cancelled) {
          /* 404 is what the API returns for a recipe that is not yours -
           * visible_recipes() never hands over someone else's draft - and for
           * one that has been deleted. Neither is worth repeating DRF's
           * wording for. */
          setLoadError(
            error instanceof ApiError && error.status !== 404
              ? error.message
              : "That recipe could not be opened. It may have been deleted, or it may belong to somebody else."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  // ------------------------------------------------- the draft itself
  /** Creates the recipe the first time the title is usable; patches it after. */
  const saveTitle = busy(() =>
    runExclusive("recipe", async () => {
      const value = title.trim();

      if (value.length < 3) {
        setFieldErrors((e) => ({ ...e, title: "Title should be at least 3 characters." }));
        return;
      }
      setFieldErrors((e) => ({ ...e, title: "" }));

      if (value === saved.current.title) return;

      try {
        /* ids.current.recipe, not draftId: a second blur arriving while the
         * first POST is unanswered would read state that still says null and
         * create a second recipe - the duplicate-draft failure this builder
         * exists to prevent. */
        const existing = ids.current.recipe ?? null;

        if (existing === null) {
          const created = await createRecipe({ title: value });
          ids.current.recipe = created.recipe_id;
          setDraftId(created.recipe_id);
        } else {
          await updateRecipe(existing, { title: value });
        }
        saved.current.title = value;
      } catch (error) {
        setFieldErrors((e) => ({
          ...e,
          title: error instanceof ApiError ? error.message : "Could not save the title.",
        }));
      }
    })
  );

  /** Every other recipe field: one PATCH carrying only what changed. */
  function fieldSaver(
    key: string,
    value: string,
    build: () => Record<string, unknown> | null,
    errorKey = key
  ) {
    /* Queued behind the title on the same "recipe" key. Without that, typing a
     * title and tabbing straight into the description PATCHes against a draft
     * that does not exist yet - draftId is still null, the save returns
     * silently, and what was typed is quietly lost. Queueing means the id is
     * there by the time this runs. */
    return busy(() =>
      runExclusive("recipe", async () => {
        const recipe = ids.current.recipe;
        if (!recipe) return;
        if (value === (saved.current[key] ?? "")) return;

        const payload = build();
        if (payload === null) return; // invalid; the message is already set

        try {
          await updateRecipe(recipe, payload);
          saved.current[key] = value;
          setFieldErrors((e) => ({ ...e, [errorKey]: "" }));
        } catch (error) {
          setFieldErrors((e) => ({
            ...e,
            [errorKey]: error instanceof ApiError ? error.message : "Could not save that.",
          }));
        }
      })
    );
  }

  const saveDescription = fieldSaver("description", description, () => ({
    description: description.trim(),
  }));

  const saveServings = fieldSaver("servings", servings, () => {
    const trimmed = servings.trim();
    if (!trimmed) return { servings: null };
    if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) {
      setFieldErrors((e) => ({ ...e, servings: "Enter a whole number greater than 0." }));
      return null;
    }
    return { servings: Number(trimmed) };
  });

  const saveCookTime = fieldSaver("cook_time", cookTime, () => {
    const trimmed = cookTime.trim();
    if (!trimmed) return { cook_time: null };
    const minutes = parseMinutes(trimmed);
    if (!minutes) {
      setFieldErrors((e) => ({ ...e, cook_time: "Use a time such as 45 mins or 1 hr 30 mins." }));
      return null;
    }
    return { cook_time: minutes };
  });

  const savePrepTime = fieldSaver("prep_time", prepTime, () => {
    const trimmed = prepTime.trim();
    if (!trimmed) return { prep_time: null };
    const minutes = parseMinutes(trimmed);
    if (!minutes) {
      setFieldErrors((e) => ({ ...e, prep_time: "Use a time such as 15 mins, or leave it empty." }));
      return null;
    }
    return { prep_time: minutes };
  });

  const saveCuisine = fieldSaver("cuisine_type", cuisine, () => ({
    cuisine_type: cuisine.trim() || null,
  }));

  const saveDifficulty = fieldSaver("difficulty", difficulty, () => ({
    difficulty: (difficulty || null) as "easy" | "medium" | "hard" | null,
  }));

  // ------------------------------------------------------------ ingredients
  const patchIngredient = useCallback(
    (key: string, change: Partial<IngredientDraft>) =>
      setIngredients((rows) =>
        rows.map((row) => (row.key === key ? { ...row, ...change } : row))
      ),
    []
  );

  const saveIngredient = (row: IngredientDraft) =>
    busy(() =>
      runExclusive(row.key, async () => {
      const recipe = ids.current.recipe;
      if (!recipe) return;

      const name = row.name.trim();
      if (!name) return;

      if (row.quantity.trim() && !QUANTITY.test(row.quantity.trim())) {
        patchIngredient(row.key, {
          status: { state: "error", message: "Amounts must be numbers like 200 or 1.5, up to 9999.99." },
        });
        return;
      }

      patchIngredient(row.key, { status: { state: "saving" } });

      const payload = {
        quantity: row.quantity.trim() || null,
        unit: row.unit.trim() || null,
      };

      try {
        /* The ref, not row.rowId: tabbing through this row's three inputs can
         * start a second save while the first POST is unanswered, and the
         * closure would still say "no id yet" and create a duplicate. */
        const rowId = ids.current[row.key] ?? null;

        if (rowId === null) {
          const created = await addIngredient(recipe, {
            name,
            quantity: row.quantity.trim() || undefined,
            unit: row.unit.trim() || undefined,
          });
          ids.current[row.key] = created.recipe_ingredient_id;
          patchIngredient(row.key, {
            rowId: created.recipe_ingredient_id,
            status: SAVED,
          });
        } else {
          await updateIngredient(rowId, { ingredient_name: name, ...payload });
          patchIngredient(row.key, { status: SAVED });
        }
      } catch (error) {
        patchIngredient(row.key, {
          status: {
            state: "error",
            message: error instanceof ApiError ? error.message : "Could not save this ingredient.",
          },
        });
      }
      })
    )();

  const removeIngredient = (row: IngredientDraft) =>
    busy(async () => {
      if (row.rowId !== null) {
        try {
          await deleteIngredient(row.rowId);
        } catch (error) {
          patchIngredient(row.key, {
            status: {
              state: "error",
              message: error instanceof ApiError ? error.message : "Could not remove this row.",
            },
          });
          return;
        }
      }
      setIngredients((rows) => {
        const left = rows.filter((r) => r.key !== row.key);
        return left.length ? left : [emptyIngredient()];
      });
    })();

  // ------------------------------------------------------------------ steps
  const patchStep = useCallback(
    (key: string, change: Partial<StepDraft>) =>
      setSteps((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row))),
    []
  );

  const saveStep = (row: StepDraft, index: number) =>
    busy(() =>
      runExclusive(row.key, async () => {
      const recipe = ids.current.recipe;
      if (!recipe) return;

      const text = row.text.trim();
      if (!text) return;

      patchStep(row.key, { status: { state: "saving" } });

      try {
        const stepId = ids.current[row.key] ?? null;

        if (stepId === null) {
          /* Reserved from the ref before the await, so two steps saved together
           * take different numbers. Deriving it from state gave both the same
           * one, because neither had a number until its response landed. */
          const number = nextNumber.current++;
          const created = await addStep(recipe, text, number);
          ids.current[row.key] = created.step_id;
          patchStep(row.key, {
            stepId: created.step_id,
            number: created.step_number,
            status: SAVED,
          });
        } else {
          await updateStep(stepId, { instruction: text });
          patchStep(row.key, { status: SAVED });
        }
      } catch (error) {
        patchStep(row.key, {
          status: {
            state: "error",
            message: error instanceof ApiError ? error.message : "Could not save this step.",
          },
        });
      }
      })
    )();

  const removeStep = (row: StepDraft) =>
    busy(async () => {
      if (row.stepId !== null) {
        try {
          await deleteStep(row.stepId);
        } catch (error) {
          patchStep(row.key, {
            status: {
              state: "error",
              message: error instanceof ApiError ? error.message : "Could not remove this step.",
            },
          });
          return;
        }
      }
      setSteps((rows) => {
        const left = rows.filter((r) => r.key !== row.key);
        return left.length ? left : [emptyStep()];
      });
    })();

  /* A step photo needs its step to exist first - the image row names it - so an
   * unsaved step is saved on the way through. */
  const chooseStepImage = (row: StepDraft, index: number, file: File | null) =>
    busy(() =>
      runExclusive(row.key, async () => {
      if (!file || !ids.current.recipe) return;

      if (!file.type.startsWith("image/")) {
        patchStep(row.key, { status: { state: "error", message: "Step photos must be image files." } });
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        patchStep(row.key, { status: { state: "error", message: "Step photos must be 10MB or smaller." } });
        return;
      }

      patchStep(row.key, { status: { state: "saving" } });

      try {
        const recipe = ids.current.recipe as number;
        let stepId = ids.current[row.key] ?? null;

        if (stepId === null) {
          const created = await addStep(recipe, row.text.trim() || "Step", nextNumber.current++);
          stepId = created.step_id;
          ids.current[row.key] = stepId;
          patchStep(row.key, { stepId, number: created.step_number });
        }

        const uploaded = await uploadRecipeImage(file);
        const attached = await attachRecipeImage(recipe, uploaded.url, {
          type: "step",
          step: stepId,
        });

        /* Replacing a photo removes the one it replaces. Nothing in the schema
         * stops several images pointing at one step - CLAUDE.md records that as
         * a deliberate soft limitation - so without this they accumulate and
         * the page has no way to say which is current. */
        if (row.imageId !== null) {
          await deleteImage(row.imageId).catch(() => {});
        }

        patchStep(row.key, {
          preview: uploaded.url,
          imageUrl: uploaded.url,
          imageId: attached.image_id,
          status: SAVED,
        });
      } catch (error) {
        patchStep(row.key, {
          status: {
            state: "error",
            message: error instanceof ApiError ? error.message : "Could not add that photo.",
          },
        });
      }
      })
    )();

  const chooseCover = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setFieldErrors((e) => ({ ...e, image: "Please choose an image file." }));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setFieldErrors((e) => ({ ...e, image: "Images must be 10MB or smaller." }));
      return;
    }

    void busy(() =>
      runExclusive("cover", async () => {
      const recipe = ids.current.recipe;
      if (!recipe) return;
      setFieldErrors((e) => ({ ...e, image: "" }));
      try {
        const uploaded = await uploadRecipeImage(file);
        const attached = await attachRecipeImage(recipe, uploaded.url);
        if (coverImageId !== null) await deleteImage(coverImageId).catch(() => {});
        setCoverPreview(uploaded.url);
        setCoverImageId(attached.image_id);
      } catch (error) {
        setFieldErrors((e) => ({
          ...e,
          image: error instanceof ApiError ? error.message : "Could not upload that image.",
        }));
      }
      })
    )();
  };

  // ------------------------------------------------------------- publishing
  const publish = busy(async () => {
    if (draftId === null) return;
    setNotice("");
    try {
      await publishRecipe(draftId);
      setPublished(true);
      setNotice("Published. Anyone can find this recipe now.");
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "Could not publish this recipe.");
    }
  });

  const discard = busy(async () => {
    if (draftId === null) return;
    if (!window.confirm("Delete this recipe? This cannot be undone.")) return;
    try {
      await deleteRecipe(draftId);
      window.location.href = "/me/recipes";
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "Could not delete this recipe.");
    }
  });

  // ------------------------------------------------------------- the summary
  const rowsInTrouble =
    ingredients.filter((r) => r.status.state === "error").length +
    steps.filter((r) => r.status.state === "error").length;

  const summary = inFlight
    ? "Saving..."
    : rowsInTrouble
      ? `${rowsInTrouble} ${rowsInTrouble === 1 ? "row needs" : "rows need"} attention`
      : draftId
        ? "All changes saved"
        : "Name your recipe to start";

  const locked = draftId === null;

  if (loading) {
    return <p className="mx-auto max-w-5xl px-5 py-10 text-sm text-[#6b5f4f]">Opening your recipe...</p>;
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-16 text-center">
        <p role="alert" className="text-base font-semibold text-[#2b2119]">
          {loadError}
        </p>
        <a
          href="/me/recipes"
          className="mt-6 inline-block rounded-md bg-[#c1440e] px-5 py-2 text-sm font-semibold text-white hover:bg-[#9e3609]"
        >
          Back to my recipes
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 text-[#2b2119]">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-[#e6dbc6] pb-5">
        <div aria-live="polite" className="text-sm text-[#6b5f4f]">
          {summary}
          {published && <span className="ml-2 font-semibold text-[#3d5a40]">Published</span>}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={discard}
            disabled={locked}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={locked || published}
            className="rounded-md bg-[#c1440e] px-5 py-2 text-sm font-semibold text-white hover:bg-[#9e3609] disabled:opacity-50"
          >
            {published ? "Published" : "Publish"}
          </button>
        </div>
      </div>

      {notice && (
        <p role="alert" className="mb-6 rounded-md bg-[#f1e9d8] px-4 py-3 text-sm">
          {notice}
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        <div>
          <div className="aspect-[3/4] overflow-hidden rounded-lg border border-[#dcd0b8] bg-[#f1e9d8]">
            {coverPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverPreview} alt="Recipe cover" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[#6b5f4f]">
                Upload your recipe photo
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => coverInput.current?.click()}
            disabled={locked}
            className="mt-3 w-full rounded-md bg-[#e3a008] py-2 text-sm font-semibold hover:brightness-95 disabled:opacity-40"
          >
            {coverPreview ? "Change image" : "Upload recipe image"}
          </button>
          <input ref={coverInput} type="file" accept="image/*" onChange={chooseCover} className="hidden" />
          {fieldErrors.image && <p className="mt-1 text-xs text-red-600">{fieldErrors.image}</p>}
        </div>

        <div className="space-y-4">
          <div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              placeholder="Title"
              maxLength={150}
              aria-invalid={Boolean(fieldErrors.title)}
              className="w-full rounded-md bg-[#f1e9d8] px-4 py-3 text-xl font-semibold outline-none ring-[#3d5a40] focus:ring-2"
            />
            {fieldErrors.title && <p className="mt-1 text-xs text-red-600">{fieldErrors.title}</p>}
          </div>

          <div className="flex items-center gap-2 text-sm text-[#6b5f4f]">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#3d5a40] text-xs font-bold uppercase text-white">
              {user ? user.username.slice(0, 1) : " "}
            </span>
            {user ? `@${user.username}` : ""}
          </div>

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            disabled={locked}
            placeholder="Share a little more about your dish!"
            rows={4}
            className="w-full resize-none rounded-md bg-[#f1e9d8] px-4 py-3 outline-none ring-[#3d5a40] focus:ring-2 disabled:opacity-50"
          />

          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold">
              Cuisine
              <input
                value={cuisine}
                onChange={(e) => setCuisine(e.target.value)}
                onBlur={saveCuisine}
                disabled={locked}
                maxLength={50}
                placeholder="e.g. Filipino"
                className={`w-full font-normal disabled:opacity-50 ${FIELD}`}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm font-semibold">
              Difficulty
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                onBlur={saveDifficulty}
                disabled={locked}
                className={`w-40 font-normal capitalize disabled:opacity-50 ${FIELD}`}
              >
                <option value="">Not stated</option>
                {DIFFICULTIES.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="mt-10 grid gap-8 md:grid-cols-2">
        <section className="min-w-0">
          <h2 className="mb-3 text-xl font-semibold">Ingredients</h2>

          <label className="mb-1 flex items-center gap-3 text-sm font-semibold">
            Serving size
            <input
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              onBlur={saveServings}
              disabled={locked}
              inputMode="numeric"
              placeholder="# of people"
              className={`w-32 font-normal disabled:opacity-50 ${FIELD}`}
            />
          </label>
          {fieldErrors.servings && <p className="mb-2 text-xs text-red-600">{fieldErrors.servings}</p>}

          <div className="space-y-2">
            {ingredients.map((row, index) => (
              <div key={row.key}>
                {/* Narrow: the amount and unit share the top line with the
                  * remove button, and the ingredient name takes a full-width
                  * line of its own beneath. Three fixed-width boxes plus a name
                  * do not fit a phone - and the name is the part that needs the
                  * room, since "self-raising flour" is the content and "200 g"
                  * is only the measure.
                  *
                  * Unstacked at lg, not sm: these sections become two columns at
                  * md, so between md and lg each one is only ~350px wide and a
                  * single row would leave the name about 115px. Waiting for lg
                  * means it never unstacks into something cramped.
                  *
                  * Grid rather than flex-wrap, so the button can sit on the
                  * first line while the name - later in the DOM, where tab order
                  * wants it - is placed on the second. */}
                <div className="grid grid-cols-[4rem_6rem_1fr] gap-2 lg:grid-cols-[4rem_6rem_1fr_auto]">
                  <input
                    value={row.quantity}
                    onChange={(e) => patchIngredient(row.key, { quantity: e.target.value })}
                    onBlur={() => saveIngredient(row)}
                    disabled={locked}
                    inputMode="decimal"
                    aria-label={`Amount for ingredient ${index + 1}`}
                    placeholder="200"
                    className={`w-full min-w-0 disabled:opacity-50 ${FIELD}`}
                  />
                  <input
                    value={row.unit}
                    onChange={(e) => patchIngredient(row.key, { unit: e.target.value })}
                    onBlur={() => saveIngredient(row)}
                    disabled={locked}
                    list="ingredient-units"
                    maxLength={30}
                    aria-label={`Unit for ingredient ${index + 1}`}
                    placeholder="g"
                    className={`w-full min-w-0 disabled:opacity-50 ${FIELD}`}
                  />
                  <input
                    value={row.name}
                    onChange={(e) => patchIngredient(row.key, { name: e.target.value })}
                    onBlur={() => saveIngredient(row)}
                    disabled={locked}
                    maxLength={100}
                    aria-label={`Ingredient ${index + 1}`}
                    placeholder="plain flour"
                    className={`col-span-3 row-start-2 w-full min-w-0 disabled:opacity-50 lg:col-span-1 lg:col-start-3 lg:row-start-1 ${FIELD}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeIngredient(row)}
                    disabled={locked}
                    aria-label={`Remove ingredient ${index + 1}`}
                    className="col-start-3 row-start-1 justify-self-end px-2 text-[#6b5f4f] hover:text-red-600 disabled:opacity-30 lg:col-start-4 lg:row-start-1"
                  >
                    x
                  </button>
                </div>

                <div className="mt-1 flex items-center gap-2 pl-1">
                  <RowState status={row.status} />
                  {row.status.state === "error" && (
                    <>
                      <span role="alert" className="text-xs text-red-600">
                        {row.status.message}
                      </span>
                      <button
                        type="button"
                        onClick={() => saveIngredient(row)}
                        className="text-xs font-semibold text-[#c1440e] hover:underline"
                      >
                        Retry
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}

            <datalist id="ingredient-units">
              {UNITS.map((unit) => (
                <option key={unit} value={unit} />
              ))}
            </datalist>
          </div>

          <button
            type="button"
            onClick={() => setIngredients((rows) => [...rows, emptyIngredient()])}
            disabled={locked}
            className="mt-3 text-sm font-semibold text-[#c1440e] hover:underline disabled:opacity-40"
          >
            + Ingredient
          </button>
        </section>

        <section className="min-w-0">
          <h2 className="mb-3 text-xl font-semibold">Steps</h2>

          <label className="mb-1 flex items-center gap-3 text-sm font-semibold">
            Cooking time
            <input
              value={cookTime}
              onChange={(e) => setCookTime(e.target.value)}
              onBlur={saveCookTime}
              disabled={locked}
              placeholder="1 hr 30 mins"
              className={`w-40 font-normal disabled:opacity-50 ${FIELD}`}
            />
          </label>
          {fieldErrors.cook_time && <p className="mb-2 text-xs text-red-600">{fieldErrors.cook_time}</p>}

          <label className="mb-1 flex items-center gap-3 text-sm font-semibold">
            Prep time
            <input
              value={prepTime}
              onChange={(e) => setPrepTime(e.target.value)}
              onBlur={savePrepTime}
              disabled={locked}
              placeholder="15 mins (optional)"
              className={`w-40 font-normal disabled:opacity-50 ${FIELD}`}
            />
          </label>
          {fieldErrors.prep_time && <p className="mb-2 text-xs text-red-600">{fieldErrors.prep_time}</p>}

          <div className="space-y-3">
            {steps.map((row, index) => (
              <div key={row.key} className="flex items-start gap-2">
                <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#3d5a40] text-xs font-bold text-white">
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1 space-y-2">
                  <textarea
                    value={row.text}
                    onChange={(e) => patchStep(row.key, { text: e.target.value })}
                    onBlur={() => saveStep(row, index)}
                    disabled={locked}
                    placeholder={`Describe step ${index + 1}...`}
                    rows={2}
                    className="w-full resize-none rounded-md bg-[#f1e9d8] px-3 py-2 text-sm outline-none ring-[#3d5a40] focus:ring-2 disabled:opacity-50"
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    {row.preview && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.preview}
                        alt={`Step ${index + 1} photo`}
                        className="h-12 w-12 shrink-0 rounded-md border border-[#dcd0b8] object-cover"
                      />
                    )}

                    <label
                      className={`text-xs font-semibold text-[#c1440e] ${locked ? "opacity-40" : "cursor-pointer hover:underline"}`}
                    >
                      {row.imageUrl ? "Change photo" : "+ Photo"}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={locked}
                        aria-label={`Photo for step ${index + 1}`}
                        onChange={(e) => chooseStepImage(row, index, e.target.files?.[0] ?? null)}
                        className="hidden"
                      />
                    </label>

                    <RowState status={row.status} />

                    {row.status.state === "error" && (
                      <>
                        <span role="alert" className="text-xs text-red-600">
                          {row.status.message}
                        </span>
                        <button
                          type="button"
                          onClick={() => saveStep(row, index)}
                          className="text-xs font-semibold text-[#c1440e] hover:underline"
                        >
                          Retry
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => removeStep(row)}
                  disabled={locked}
                  aria-label={`Remove step ${index + 1}`}
                  className="mt-2 px-2 text-[#6b5f4f] hover:text-red-600 disabled:opacity-30"
                >
                  x
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setSteps((rows) => [...rows, emptyStep()])}
            disabled={locked}
            className="mt-3 text-sm font-semibold text-[#c1440e] hover:underline disabled:opacity-40"
          >
            + Step
          </button>
        </section>
      </div>
    </div>
  );
}
