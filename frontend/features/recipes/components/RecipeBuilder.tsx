"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  latestImage,
  listIngredients,
  listRecipeTags,
  listSteps,
  addRecipeTag,
  publishRecipe,
  removeRecipeTag,
  reorderSteps,
  updateIngredient,
  updateRecipe,
  updateStep,
  uploadRecipeImage,
} from "@/features/recipes/api";
import { TAG_LABELS, tagLabel, tagName } from "@/lib/categories";
import { RecipePreview } from "@/features/recipes/components/RecipePreview";
import { refreshCollectionCounts } from "@/lib/collectionCounts";
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
  /** The coral heading in the reference design - optional, so a step written
   * without one still renders exactly as every step did before this existed. */
  title: string;
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
    key: makeKey(), stepId: null, number: null, title: "", text: "",
    preview: null, imageUrl: null, imageId: null, status: IDLE,
  };
}

/* One input treatment, from the tokens in app/globals.css. The builder used to
 * be painted in #f1e9d8 and #c1440e - the only screen in the app with its own
 * palette, which is what made it read as a different product. */
const FIELD =
  "rounded-xl border border-rule bg-field px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon";

/** A row's own save indicator. Nothing is shown until a row has done something,
 * so an untouched form is not covered in spinners. */
function RowState({ status }: { status: RowStatus }) {
  if (status.state === "saving") return <span className="text-xs text-muted">Saving...</span>;
  if (status.state === "saved") return <span className="text-xs text-maroon">Saved</span>;
  return null;
}

export default function RecipeBuilder({ recipeId }: { recipeId?: number }) {
  const { user } = useSession();
  const router = useRouter();

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
  const [body, setBody] = useState("");
  const [equipment, setEquipment] = useState("");
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
  const [dragging, setDragging] = useState<number | null>(null);
  /* Only the tags this recipe carries. The chip row renders TAG_LABELS and
   * looks each one up here, so an unknown tag applied through the admin still
   * shows rather than disappearing. */
  const [tags, setTags] = useState<{ name: string; rowId: number }[]>([]);
  const [tagError, setTagError] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
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

  /** Every other "final" image id this recipe is already carrying, besides
   * the one coverImageId tracks - normally empty. A cover replace deletes
   * the row it knows about and then, self-healing, everything left in this
   * set too: if an earlier delete ever failed silently (still possible -
   * deleteImage below is still best-effort), the recipe would otherwise
   * carry an orphaned final image forever, and get_cover_image()/latestImage()
   * picking "the newest" only hides it - the row stays in the database and
   * the next photo replace is what actually clears it. */
  const staleCoverIds = useRef<number[]>([]);

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
        const [recipe, stepRows, ingredientRows, tagRows] = await Promise.all([
          getRecipe(recipeId),
          listSteps(recipeId),
          listIngredients(recipeId),
          listRecipeTags(recipeId),
        ]);
        if (cancelled) return;

        setTitle(recipe.title);
        setDescription(recipe.description ?? "");
        setBody(recipe.body ?? "");
        setEquipment(recipe.equipment ?? "");
        setServings(recipe.servings === null ? "" : String(recipe.servings));
        setCookTime(minutesToText(recipe.cook_time));
        setPrepTime(minutesToText(recipe.prep_time));
        setCuisine(recipe.cuisine_type ?? "");
        setDifficulty(recipe.difficulty ?? "");
        setPublished(recipe.status === "published");

        saved.current = {
          title: recipe.title,
          description: recipe.description ?? "",
          body: recipe.body ?? "",
          equipment: recipe.equipment ?? "",
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
        setTags(
          tagRows.map((row) => ({ name: row.tag.name, rowId: row.recipe_tag_id }))
        );
        const cover = latestImage(recipe.images, "final");
        setCoverPreview(cover?.url ?? null);
        setCoverImageId(cover?.image_id ?? null);
        staleCoverIds.current = (recipe.images ?? [])
          .filter((i) => i.type === "final" && i.image_id !== cover?.image_id)
          .map((i) => i.image_id);

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
                title: row.title ?? "",
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
          // The sidebar totals just changed.
          if (user) refreshCollectionCounts(user.user_id);
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

  const saveBody = fieldSaver("body", body, () => ({
    body: body.trim() || null,
  }));

  const saveEquipment = fieldSaver("equipment", equipment, () => ({
    equipment: equipment.trim() || null,
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

  const saveStep = (row: StepDraft) =>
    busy(() =>
      runExclusive(row.key, async () => {
      const recipe = ids.current.recipe;
      if (!recipe) return;

      const text = row.text.trim();
      if (!text) return;

      const title = row.title.trim();

      patchStep(row.key, { status: { state: "saving" } });

      try {
        const stepId = ids.current[row.key] ?? null;

        if (stepId === null) {
          /* Reserved from the ref before the await, so two steps saved together
           * take different numbers. Deriving it from state gave both the same
           * one, because neither had a number until its response landed. */
          const number = nextNumber.current++;
          const created = await addStep(recipe, text, number, title || undefined);
          ids.current[row.key] = created.step_id;
          patchStep(row.key, {
            stepId: created.step_id,
            number: created.step_number,
            status: SAVED,
          });
        } else {
          await updateStep(stepId, { instruction: text, title: title || null });
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
  const chooseStepImage = (row: StepDraft, file: File | null) =>
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
          const created = await addStep(
            recipe,
            row.text.trim() || "Step",
            nextNumber.current++,
            row.title.trim() || undefined
          );
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

    /* Cleared on every selection, valid or not - without this, choosing the
     * same file a second time (retrying after an error, say) fires no
     * change event at all, since the input's value has not changed from the
     * browser's point of view. Nothing else visibly happens, which looked
     * exactly like "changing the photo doesn't do anything." */
    if (coverInput.current) coverInput.current.value = "";

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

        /* Every final image this recipe was already carrying - the one row
         * state knows about, plus any orphan left behind by an earlier
         * delete that failed silently (staleCoverIds's own comment explains
         * why one can exist). Swept together so a single old failure cannot
         * keep masking the cover forever - see latestImage() in api.ts,
         * which is what would otherwise keep surfacing the oldest one. Any
         * id that fails to delete this time is kept for the next attempt
         * rather than dropped.
         */
        const toRemove = [...staleCoverIds.current, ...(coverImageId !== null ? [coverImageId] : [])];
        const stillThere = await Promise.all(
          toRemove.map((id) => deleteImage(id).then(() => null).catch(() => id))
        );
        staleCoverIds.current = stillThere.filter((id): id is number => id !== null);

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
      if (user) refreshCollectionCounts(user.user_id);
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
      if (user) refreshCollectionCounts(user.user_id);
      router.push("/me/recipes");
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "Could not delete this recipe.");
    }
  });

  /* ------------------------------------------------------------------ tags */

  /** Apply or remove one tag. Keyed per tag, so two toggled quickly cannot
   * collide - and so a failure on one leaves the others alone. */
  const toggleTag = (label: string) =>
    busy(() =>
      runExclusive(`tag:${label}`, async () => {
        const recipe = ids.current.recipe;
        if (!recipe) return;

        const name = tagName(label);
        const applied = tags.find((t) => t.name === name);
        setTagError("");

        try {
          if (applied) {
            await removeRecipeTag(applied.rowId);
            setTags((current) => current.filter((t) => t.name !== name));
          } else {
            const created = await addRecipeTag(recipe, name);
            setTags((current) => [
              ...current,
              { name, rowId: created.recipe_tag_id },
            ]);
          }
        } catch (error) {
          setTagError(
            error instanceof ApiError ? error.message : "Could not change that tag."
          );
        }
      })
    )();

  /* ------------------------------------------------------------- reordering */

  /** Send the new order, then renumber locally to match. */
  const persistOrder = (next: StepDraft[], previous: StepDraft[]) =>
    busy(() =>
      runExclusive("steps", async () => {
        /* Wait for any row still being created. steps/reorder/ refuses a
         * partial list - "List every step in this recipe exactly once" - so a
         * step that finishes saving after the list is built would be missing
         * from it and the whole reorder would fail. */
        await Promise.allSettled(
          next.map((row) => queue.current.get(row.key)).filter(Boolean) as Promise<void>[]
        );

        const recipe = ids.current.recipe;
        const ordered = next
          .map((row) => ids.current[row.key])
          .filter((id): id is number => typeof id === "number");

        // Nothing saved yet, or only one row: no order to record.
        if (!recipe || ordered.length < 2) return;

        try {
          await reorderSteps(recipe, ordered);

          /* Reordering renumbers from 1, so this also closes any gap a deletion
           * left behind - the numbers stop drifting. */
          let position = 0;
          setSteps((rows) =>
            rows.map((row) =>
              ids.current[row.key] ? { ...row, number: ++position } : row
            )
          );
          nextNumber.current = ordered.length + 1;
        } catch (error) {
          // Put the rows back, so what is on screen is what is stored.
          setSteps(previous);
          setNotice(
            error instanceof ApiError ? error.message : "Could not reorder the steps."
          );
        }
      })
    )();

  /** Move a step to a new position. Used by both the drag handle and the
   * up/down buttons - HTML5 drag cannot be reached from a keyboard, so a
   * drag-only control would make step order mouse-only. */
  function moveStep(from: number, to: number) {
    if (from === to || to < 0 || to >= steps.length) return;

    const previous = steps;
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    setSteps(next);
    persistOrder(next, previous);
  }

  /* Leaving is just navigation - everything is already written. The one thing
   * worth stopping for is a row that failed, because its content exists only in
   * this browser and closing the page abandons it. */
  function leave() {
    if (rowsInTrouble > 0) {
      const ok = window.confirm(
        `${rowsInTrouble} ${rowsInTrouble === 1 ? "row has" : "rows have"} not been saved. Leave anyway?`
      );
      if (!ok) return;
    }
    router.push("/me/recipes");
  }

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
    return <p className="mx-auto max-w-[860px] px-5 py-10 text-sm text-muted">Opening your recipe...</p>;
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-[860px] px-5 py-16 text-center">
        <p role="alert" className="font-display text-base font-semibold text-ink">
          {loadError}
        </p>
        <Link
          href="/me/recipes"
          className="mt-6 inline-block rounded-full bg-maroon px-5 py-2.5 font-display text-sm font-semibold text-card transition-opacity hover:opacity-90"
        >
          Back to my recipes
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[860px] px-5 py-8 lg:px-6">
      {/* Exit on the left, state in the middle, actions on the right.
        *
        * No "Save and Close": nothing is waiting to be saved, and a button
        * saying otherwise would imply that leaving without it loses work - the
        * exact worry this editor removes. The status line is the reassurance,
        * and it is honest because it reflects what has actually been written. */}
      {/* auto/1fr/auto, not 1fr/auto/1fr: equal side tracks centre the middle
        * on the page, and the two sides are not the same width - the back link
        * is far narrower than Delete and Publish, so the gap between them was
        * lopsided. Sizing the sides to their content makes the middle track
        * exactly the space between them, and centring inside it centres
        * between the buttons. */}
      <div className="mb-8 grid gap-4 border-b border-rule pb-5 sm:grid-cols-[auto_1fr_auto] sm:items-end">
        <button
          type="button"
          onClick={leave}
          className="flex items-center gap-2 pb-1.5 font-display text-xs font-medium text-slate transition-colors hover:text-ink sm:justify-self-start"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
          My recipes
        </button>

        <div className="flex flex-col items-center gap-1.5 justify-self-center">
          <p aria-live="polite" className="text-center text-[10px] text-muted">
            {summary}
            {published && <span className="ml-1.5 font-semibold text-maroon">Published</span>}
          </p>

          <div className="flex rounded-full border border-rule p-0.5">
            {(["edit", "preview"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                aria-pressed={mode === option}
                disabled={option === "preview" && locked}
                className={`rounded-full px-3.5 py-1 font-display text-[11px] font-semibold capitalize transition-colors disabled:opacity-40 ${
                  mode === option ? "bg-maroon text-card" : "text-slate hover:text-ink"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-end justify-center gap-4 sm:justify-self-end">
          <button
            type="button"
            onClick={discard}
            disabled={locked}
            className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-maroon transition-colors hover:bg-panel disabled:opacity-40"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={locked || published}
            className="rounded-full bg-maroon px-5 py-2.5 font-display text-sm font-semibold text-card transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {published ? "Published" : "Publish"}
          </button>
        </div>
      </div>

      {notice && (
        <p role="alert" className="mb-6 rounded-xl bg-panel px-4 py-3 text-sm text-ink">
          {notice}
        </p>
      )}

      {mode === "preview" ? (
        <RecipePreview
          title={title}
          description={description}
          body={body}
          equipment={equipment}
          servings={servings}
          prepTime={prepTime}
          cookTime={cookTime}
          cuisine={cuisine}
          difficulty={difficulty}
          cover={coverPreview}
          tags={tags.map((t) => tagLabel(t.name))}
          ingredients={ingredients}
          steps={steps}
          author={user?.username}
        />
      ) : (
      <>
      {/* ------------------------------------------------------------ identity */}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        placeholder="Name your recipe"
        maxLength={150}
        aria-label="Recipe title"
        aria-invalid={Boolean(fieldErrors.title)}
        className="w-full bg-transparent font-display text-3xl font-semibold text-ink outline-none placeholder:text-muted/60 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-maroon lg:text-4xl"
      />
      {fieldErrors.title && <p className="mt-2 text-sm text-red-600">{fieldErrors.title}</p>}

      <div className="mt-3 flex items-center gap-2 text-sm text-muted">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-maroon text-xs font-bold uppercase text-card">
          {user ? user.username.slice(0, 1) : " "}
        </span>
        {user ? `@${user.username}` : ""}
      </div>

      {/* A wide shallow band rather than a portrait box: on a phone the title
        * stays above the fold instead of sitting under most of a screen. */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-rule bg-panel">
        <div className="relative aspect-[16/7] w-full">
          {coverPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverPreview} alt="Recipe cover" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
              <p className="font-display text-sm font-semibold text-ink">Upload your recipe photo</p>
              <p className="text-xs text-muted">A real photo of the finished dish</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => coverInput.current?.click()}
          disabled={locked}
          className="rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-ink transition-colors hover:bg-panel disabled:opacity-40"
        >
          {coverPreview ? "Change photo" : "Add photo"}
        </button>
        <input ref={coverInput} type="file" accept="image/*" onChange={chooseCover} className="hidden" />
        {fieldErrors.image && <p className="text-xs text-red-600">{fieldErrors.image}</p>}
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={saveDescription}
        disabled={locked}
        placeholder="Share a little more about your dish"
        rows={3}
        aria-label="Description"
        className={`mt-6 w-full resize-none ${FIELD} disabled:opacity-50`}
      />

      {/* Long-form content beyond the short description above - a headnote,
        * cooking tips, whatever would not fit in a couple of sentences.
        * Plain text: a blank line between paragraphs is the only structure
        * it carries. */}
      <label className="mt-6 block text-xs font-semibold uppercase tracking-wide text-muted">
        More about this recipe (optional)
      </label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={saveBody}
        disabled={locked}
        placeholder="A headnote, cooking tips, serving suggestions - as much as you like"
        rows={5}
        aria-label="More about this recipe"
        className={`mt-1.5 w-full resize-none ${FIELD} disabled:opacity-50`}
      />

      {/* One row for the facts. They used to be split across the two columns,
        * with the times filed under Steps and the serving size under
        * Ingredients, which nothing justified. */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          Serves
          <input
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            onBlur={saveServings}
            disabled={locked}
            inputMode="numeric"
            placeholder="4"
            className={`w-full font-normal normal-case tracking-normal text-ink ${FIELD} disabled:opacity-50`}
          />
          {fieldErrors.servings && (
            <span className="font-normal normal-case tracking-normal text-red-600">{fieldErrors.servings}</span>
          )}
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          Prep time
          <input
            value={prepTime}
            onChange={(e) => setPrepTime(e.target.value)}
            onBlur={savePrepTime}
            disabled={locked}
            placeholder="15 mins"
            className={`w-full font-normal normal-case tracking-normal text-ink ${FIELD} disabled:opacity-50`}
          />
          {fieldErrors.prep_time && (
            <span className="font-normal normal-case tracking-normal text-red-600">{fieldErrors.prep_time}</span>
          )}
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          Cook time
          <input
            value={cookTime}
            onChange={(e) => setCookTime(e.target.value)}
            onBlur={saveCookTime}
            disabled={locked}
            placeholder="1 hr 30 mins"
            className={`w-full font-normal normal-case tracking-normal text-ink ${FIELD} disabled:opacity-50`}
          />
          {fieldErrors.cook_time && (
            <span className="font-normal normal-case tracking-normal text-red-600">{fieldErrors.cook_time}</span>
          )}
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          Cuisine
          <input
            value={cuisine}
            onChange={(e) => setCuisine(e.target.value)}
            onBlur={saveCuisine}
            disabled={locked}
            maxLength={50}
            placeholder="Filipino"
            className={`w-full font-normal normal-case tracking-normal text-ink ${FIELD} disabled:opacity-50`}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          Difficulty
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            onBlur={saveDifficulty}
            disabled={locked}
            className={`w-full font-normal normal-case capitalize tracking-normal text-ink ${FIELD} disabled:opacity-50`}
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

      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold text-ink">Tags</h2>
        <p className="mt-1 text-sm text-muted">
          How people find this recipe when browsing.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {TAG_LABELS.map((label) => {
            const applied = tags.some((t) => t.name === tagName(label));

            return (
              <button
                key={label}
                type="button"
                onClick={() => toggleTag(label)}
                disabled={locked}
                aria-pressed={applied}
                className={`rounded-full border px-4 py-2 font-display text-xs font-semibold transition-colors disabled:opacity-40 ${
                  applied
                    ? "border-maroon bg-maroon text-card"
                    : "border-rule text-slate hover:bg-panel hover:text-ink"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* A tag applied before this list existed - through the admin, say -
          * still shows, so nothing silently disappears from a recipe. */}
        {tags.some((t) => !TAG_LABELS.some((l) => tagName(l) === t.name)) && (
          <p className="mt-3 text-xs text-muted">
            Also tagged:{" "}
            {tags
              .filter((t) => !TAG_LABELS.some((l) => tagName(l) === t.name))
              .map((t) => tagLabel(t.name))
              .join(", ")}
          </p>
        )}

        {tagError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {tagError}
          </p>
        )}
      </section>

      {/* --------------------------------------------------------- ingredients */}
      <section className="mt-12">
        <h2 className="font-display text-xl font-semibold text-ink">Ingredients</h2>

        <div className="mt-4 space-y-3">
          {ingredients.map((row, index) => (
            <div key={row.key}>
              {/* Full width now, so the three boxes fit one line from about
                * 600px up; below that the name still takes its own row. */}
              <div className="grid grid-cols-[5rem_7rem_1fr] gap-2 sm:grid-cols-[5rem_7rem_1fr_auto]">
                <input
                  value={row.quantity}
                  onChange={(e) => patchIngredient(row.key, { quantity: e.target.value })}
                  onBlur={() => saveIngredient(row)}
                  disabled={locked}
                  inputMode="decimal"
                  aria-label={`Amount for ingredient ${index + 1}`}
                  placeholder="200"
                  className={`w-full min-w-0 ${FIELD} disabled:opacity-50`}
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
                  className={`w-full min-w-0 ${FIELD} disabled:opacity-50`}
                />
                <input
                  value={row.name}
                  onChange={(e) => patchIngredient(row.key, { name: e.target.value })}
                  onBlur={() => saveIngredient(row)}
                  disabled={locked}
                  maxLength={100}
                  aria-label={`Ingredient ${index + 1}`}
                  placeholder="plain flour"
                  className={`col-span-3 row-start-2 w-full min-w-0 sm:col-span-1 sm:col-start-3 sm:row-start-1 ${FIELD} disabled:opacity-50`}
                />
                <button
                  type="button"
                  onClick={() => removeIngredient(row)}
                  disabled={locked}
                  aria-label={`Remove ingredient ${index + 1}`}
                  className="col-start-3 row-start-1 justify-self-end px-2 text-muted transition-colors hover:text-red-600 disabled:opacity-30 sm:col-start-4 sm:row-start-1"
                >
                  &times;
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
                      className="text-xs font-semibold text-maroon hover:underline"
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
          className="mt-4 font-display text-sm font-semibold text-maroon hover:underline disabled:opacity-40"
        >
          + Ingredient
        </button>

        {/* Equipment sits with ingredients, not steps: both are "what you
          * need before you start", read from the same sidebar panel in the
          * reference design. One tool per line, the same free-typed shape as
          * `body` above rather than its own set of rows - nothing here needs
          * equipment to be searched or reused the way an ingredient is. */}
        <label className="mt-8 block text-xs font-semibold uppercase tracking-wide text-muted">
          Equipment needed (optional)
        </label>
        <textarea
          value={equipment}
          onChange={(e) => setEquipment(e.target.value)}
          onBlur={saveEquipment}
          disabled={locked}
          placeholder={"One tool per line, e.g.\nRoasting pan\nMeat thermometer"}
          rows={3}
          aria-label="Equipment needed"
          className={`mt-1.5 w-full resize-none ${FIELD} disabled:opacity-50`}
        />
      </section>

      {/* --------------------------------------------------------------- steps */}
      <section className="mt-12">
        <h2 className="font-display text-xl font-semibold text-ink">Steps</h2>

        <div className="mt-4 space-y-4">
          {steps.map((row, index) => (
            <div
              key={row.key}
              onDragOver={(e) => {
                if (dragging !== null) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging !== null) moveStep(dragging, index);
                setDragging(null);
              }}
              className={`rounded-2xl border bg-card p-4 transition-colors ${
                dragging === index ? "border-maroon" : "border-rule"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-1 flex shrink-0 flex-col items-center gap-1">
                  {/* Drag for a mouse, the arrows for everything else. */}
                  <button
                    type="button"
                    draggable={!locked}
                    onDragStart={() => setDragging(index)}
                    onDragEnd={() => setDragging(null)}
                    disabled={locked}
                    aria-label={`Reorder step ${index + 1}`}
                    className="cursor-grab px-1 text-muted transition-colors hover:text-ink active:cursor-grabbing disabled:opacity-30"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M5 9h14M5 15h14" />
                    </svg>
                  </button>

                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-maroon text-xs font-bold text-card">
                    {index + 1}
                  </span>

                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => moveStep(index, index - 1)}
                      disabled={locked || index === 0}
                      aria-label={`Move step ${index + 1} up`}
                      className="px-1 text-muted transition-colors hover:text-ink disabled:opacity-25"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 15l6-6 6 6" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStep(index, index + 1)}
                      disabled={locked || index === steps.length - 1}
                      aria-label={`Move step ${index + 1} down`}
                      className="px-1 text-muted transition-colors hover:text-ink disabled:opacity-25"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <input
                    value={row.title}
                    onChange={(e) => patchStep(row.key, { title: e.target.value })}
                    onBlur={() => saveStep(row)}
                    disabled={locked}
                    placeholder="Step heading (optional)"
                    aria-label={`Heading for step ${index + 1}`}
                    className={`${FIELD} disabled:opacity-50`}
                  />
                  <textarea
                    value={row.text}
                    onChange={(e) => patchStep(row.key, { text: e.target.value })}
                    onBlur={() => saveStep(row)}
                    disabled={locked}
                    placeholder={`What happens in step ${index + 1}?`}
                    rows={2}
                    aria-label={`Step ${index + 1}`}
                    className={`resize-none ${FIELD} disabled:opacity-50`}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => removeStep(row)}
                  disabled={locked}
                  aria-label={`Remove step ${index + 1}`}
                  className="mt-1.5 px-2 text-muted transition-colors hover:text-red-600 disabled:opacity-30"
                >
                  &times;
                </button>
              </div>

              {/* A real preview rather than a 48px thumbnail - there is room for
                * it now that the editor is one column. */}
              <div className="mt-3 flex flex-wrap items-center gap-3 pl-11">
                {row.preview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={row.preview}
                    alt={`Step ${index + 1} photo`}
                    className="h-28 w-40 shrink-0 rounded-xl border border-rule object-cover"
                  />
                )}

                <label
                  className={`rounded-full border border-rule px-4 py-2 font-display text-xs font-semibold text-ink transition-colors ${
                    locked ? "opacity-40" : "cursor-pointer hover:bg-panel"
                  }`}
                >
                  {row.imageUrl ? "Change photo" : "Add photo"}
                  <input
                    type="file"
                    accept="image/*"
                    disabled={locked}
                    aria-label={`Photo for step ${index + 1}`}
                    onChange={(e) => chooseStepImage(row, e.target.files?.[0] ?? null)}
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
                      onClick={() => saveStep(row)}
                      className="text-xs font-semibold text-maroon hover:underline"
                    >
                      Retry
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setSteps((rows) => [...rows, emptyStep()])}
          disabled={locked}
          className="mt-4 font-display text-sm font-semibold text-maroon hover:underline disabled:opacity-40"
        >
          + Step
        </button>
      </section>
      </>
      )}
    </div>
  );
}
