"use client";

/* The public recipe page: RecipePreview's rendering, plus the things a
 * finished recipe needs that a preview does not - a rating, reviews, nutrition,
 * and a way to save it.
 *
 * Nutrition is the one thing RecipePreview cannot render for itself: it comes
 * from Edamam, fetched for a real, saved recipe, never for a draft still being
 * written in the builder. It is passed in through RecipePreview's
 * `extraSidebar` slot instead - the same cream sidebar Ingredients and
 * Equipment already sit in, not a section of its own.
 *
 * Still deliberately not the full page the original ComingSoon stub
 * described - that one also needs User.bio and User.avatar_url for a real
 * author card, which do not exist yet. Everything else the stub asked for
 * (Step.title, Recipe.equipment, Recipe.body) is real now; see
 * app/recipes/[id]/page.tsx for what that page still defers.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  ApiError,
  createRating,
  deleteComment,
  fetchNutrition,
  getMyRating,
  getRecipe,
  getSavedEntry,
  listComments,
  listIngredients,
  listRecipeTags,
  listSteps,
  postComment,
  saveRecipe,
  unsaveRecipe,
  updateRating,
  type CommentRow,
  type IngredientRow,
  type NutritionInfoRow,
  type RatingRow,
  type RecipeRow,
  type SavedRow,
  type StepRow,
} from "@/features/recipes/api";
import { RecipePreview } from "@/features/recipes/components/RecipePreview";
import { ReportButton } from "@/features/recipes/components/ReportButton";
import { tagLabel } from "@/lib/categories";
import { useSession } from "@/lib/useSession";

type Loaded = {
  recipe: RecipeRow;
  steps: StepRow[];
  ingredients: IngredientRow[];
  tags: string[];
};

function Stars({
  value,
  onPick,
  disabled,
}: {
  value: number;
  onPick?: (score: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1" role={onPick ? "radiogroup" : undefined}>
      {[1, 2, 3, 4, 5].map((score) => (
        <button
          key={score}
          type="button"
          role={onPick ? "radio" : undefined}
          aria-checked={onPick ? score === value : undefined}
          disabled={!onPick || disabled}
          onClick={() => onPick?.(score)}
          className={`text-xl leading-none ${onPick ? "cursor-pointer" : "cursor-default"} ${
            score <= Math.round(value) ? "text-ember" : "text-rule"
          } disabled:opacity-50`}
        >
          {"★"}
        </button>
      ))}
    </div>
  );
}

/** A decimal string from NutritionInfoRow, rounded for display - "500.00"
 * reads as a lab result; "500" reads as a fact. Null (never fetched, or
 * fetched and Edamam had nothing usable) renders the same as a bad number:
 * a dash, not a fabricated zero. */
function macro(value: string | null): string {
  const num = value == null ? NaN : Number(value);
  return Number.isNaN(num) ? "-" : String(Math.round(num));
}

function NutritionRow({ label, value, unit }: { label: string; value: string | null; unit: string }) {
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="text-ink">{label}</span>
      <span className="font-semibold text-ink">
        {value != null ? `${macro(value)} ${unit}` : "-"}
      </span>
    </li>
  );
}

/** The sidebar card RecipePreview's `extraSidebar` slot renders, next to
 * Ingredients and Equipment - matches their own card styling rather than
 * inventing a fourth look for one more panel in the same column. */
function NutritionCard({
  state,
  nutrition,
}: {
  state: "loading" | "ready" | "unavailable";
  nutrition: NutritionInfoRow | null;
}) {
  return (
    <div className="rounded-2xl bg-panel p-6">
      <h2 className="font-display text-xs font-semibold uppercase tracking-widest text-maroon">
        Nutritional value
      </h2>

      {state === "loading" && <p className="mt-3 text-sm text-muted">Looking this up...</p>}

      {state === "unavailable" && (
        <p className="mt-3 text-sm text-muted">Not available right now.</p>
      )}

      {state === "ready" && (
        <ul className="mt-4 flex flex-col gap-2">
          <NutritionRow label="Calories" value={nutrition?.calories ?? null} unit="kcal" />
          <NutritionRow label="Protein" value={nutrition?.protein ?? null} unit="g" />
          <NutritionRow label="Carbs" value={nutrition?.carbs ?? null} unit="g" />
          <NutritionRow label="Fat" value={nutrition?.fat ?? null} unit="g" />
        </ul>
      )}
    </div>
  );
}

export function RecipeDetail({ recipeId }: { recipeId: number }) {
  const { user } = useSession();
  const canAct = !!user && user.role !== "guest";

  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: Loaded }
  >({ status: "loading" });

  const [myRating, setMyRating] = useState<RatingRow | null>(null);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingError, setRatingError] = useState("");

  const [savedEntry, setSavedEntry] = useState<SavedRow | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState("");

  const [nutrition, setNutrition] = useState<NutritionInfoRow | null>(null);
  const [nutritionState, setNutritionState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [recipe, steps, ingredients, tagRows] = await Promise.all([
          getRecipe(recipeId),
          listSteps(recipeId),
          listIngredients(recipeId),
          listRecipeTags(recipeId),
        ]);
        if (cancelled) return;
        setState({
          status: "ready",
          data: {
            recipe,
            steps,
            ingredients,
            tags: tagRows.map((row) => tagLabel(row.tag.name)),
          },
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            err instanceof ApiError && err.status === 404
              ? "This recipe does not exist, or is no longer public."
              : "Could not load this recipe.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  // Your own rating and saved state are fetched separately from the recipe
  // itself - they depend on who is asking. Left unset for a guest or for
  // your own recipe; the render below only reads them when canAct is true,
  // so a stale value from before signing out is never shown.
  useEffect(() => {
    if (!canAct || !user) return;

    let cancelled = false;
    (async () => {
      const [rating, saved] = await Promise.all([
        getMyRating(recipeId, user.user_id),
        getSavedEntry(recipeId),
      ]);
      if (!cancelled) {
        setMyRating(rating);
        setSavedEntry(saved);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canAct, user, recipeId]);

  // Registered users only, matching the endpoint's own gate - a guest never
  // sees this section at all (see the render below), so there is nothing to
  // fetch for one. Populates and caches server-side on first call; every
  // later view of this recipe answers from that cache instead of asking
  // Edamam again.
  useEffect(() => {
    if (!canAct) return;

    let cancelled = false;
    (async () => {
      if (!cancelled) setNutritionState("loading");
      try {
        const info = await fetchNutrition(recipeId);
        if (!cancelled) {
          setNutrition(info);
          setNutritionState("ready");
        }
      } catch {
        if (!cancelled) setNutritionState("unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canAct, recipeId]);

  useEffect(() => {
    (async () => {
      try {
        setComments(await listComments(recipeId));
      } catch {
        // A quiet failure here still leaves the recipe itself readable.
      }
    })();
  }, [recipeId]);

  async function rate(score: number) {
    if (ratingBusy) return;
    setRatingBusy(true);
    setRatingError("");
    try {
      const result = myRating
        ? await updateRating(myRating.rating_id, score)
        : await createRating(recipeId, score);
      setMyRating(result);
    } catch (err) {
      setRatingError(
        err instanceof ApiError ? err.message : "Could not save your rating."
      );
    } finally {
      setRatingBusy(false);
    }
  }

  async function toggleSave() {
    if (saveBusy) return;
    setSaveBusy(true);
    setSaveError("");
    try {
      if (savedEntry) {
        await unsaveRecipe(savedEntry.saved_recipe_id);
        setSavedEntry(null);
      } else {
        setSavedEntry(await saveRecipe(recipeId));
      }
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Could not update your collection."
      );
    } finally {
      setSaveBusy(false);
    }
  }

  async function submitComment() {
    const content = commentText.trim();
    if (!content || commentBusy) return;
    setCommentBusy(true);
    setCommentError("");
    try {
      const created = await postComment(recipeId, content);
      setComments((current) => [created, ...current]);
      setCommentText("");
    } catch (err) {
      setCommentError(
        err instanceof ApiError ? err.message : "Could not post that review."
      );
    } finally {
      setCommentBusy(false);
    }
  }

  async function removeComment(commentId: number) {
    try {
      await deleteComment(commentId);
      setComments((current) => current.filter((c) => c.comment_id !== commentId));
    } catch {
      // Left in the list; the delete button stays clickable to try again.
    }
  }

  if (state.status === "loading") {
    return <p className="text-sm text-muted">Loading recipe...</p>;
  }

  if (state.status === "error") {
    return (
      <div className="rounded-2xl border border-rule bg-card p-10 text-center">
        <p className="font-display text-lg font-semibold text-ink">{state.message}</p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-full border border-rule px-6 py-3 font-display text-sm font-semibold text-ink hover:bg-panel"
        >
          Back to home
        </Link>
      </div>
    );
  }

  const { recipe, steps, ingredients, tags } = state.data;
  const isOwnRecipe = !!user && recipe.user?.user_id === user.user_id;
  const cover = recipe.images?.find((i) => i.type === "final")?.url ?? null;

  return (
    <div className="pb-16">
      <Link
        href="/recipes"
        className="font-display text-sm font-semibold text-maroon hover:underline"
      >
        ← Back to recipes
      </Link>

      <div className="mt-6">
        <RecipePreview
          title={recipe.title}
          description={recipe.description ?? ""}
          body={recipe.body ?? ""}
          equipment={recipe.equipment ?? ""}
          servings={recipe.servings != null ? String(recipe.servings) : ""}
          prepTime={recipe.prep_time != null ? `${recipe.prep_time} min` : ""}
          cookTime={recipe.cook_time != null ? `${recipe.cook_time} min` : ""}
          cuisine={recipe.cuisine_type ?? ""}
          difficulty={recipe.difficulty ?? ""}
          cover={cover}
          tags={tags}
          ingredients={ingredients.map((row) => ({
            key: String(row.recipe_ingredient_id),
            quantity: row.quantity ?? "",
            unit: row.unit ?? "",
            name: row.ingredient.name,
          }))}
          steps={steps.map((row) => ({
            key: String(row.step_id),
            title: row.title ?? undefined,
            text: row.instruction,
            preview: row.images[0]?.url ?? null,
          }))}
          author={recipe.user?.username}
          extraSidebar={
            canAct && <NutritionCard state={nutritionState} nutrition={nutrition} />
          }
        />
      </div>

      {/* -------------------------------------------------- rating & save */}
      <section className="mx-auto mt-4 flex max-w-[620px] flex-col items-center gap-3 border-t border-rule pt-8 text-center">
        <div className="flex items-center gap-3">
          <Stars value={recipe.avg_score ?? 0} />
          <span className="text-sm text-muted">
            {recipe.avg_score != null
              ? `${recipe.avg_score.toFixed(1)} average`
              : "Not yet rated"}
            {typeof recipe.save_count === "number" &&
              ` · saved ${recipe.save_count} ${recipe.save_count === 1 ? "time" : "times"}`}
          </span>
        </div>

        {canAct && !isOwnRecipe && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted">
              Your rating
            </p>
            <Stars value={myRating?.score ?? 0} onPick={rate} disabled={ratingBusy} />
          </div>
        )}

        {!canAct && (
          <p className="text-xs text-muted">
            <Link href={`/login?next=/recipes/${recipeId}`} className="font-semibold text-maroon hover:underline">
              Sign in
            </Link>{" "}
            to rate or save this recipe.
          </p>
        )}

        {canAct && !isOwnRecipe && (
          <button
            type="button"
            disabled={saveBusy}
            onClick={toggleSave}
            className={`rounded-full px-6 py-2.5 font-display text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-60 ${
              savedEntry ? "border border-rule text-ink" : "bg-maroon text-card"
            }`}
          >
            {saveBusy ? "Working..." : savedEntry ? "Saved · remove" : "Save recipe"}
          </button>
        )}

        {(ratingError || saveError) && (
          <p role="alert" className="text-sm text-red-600">
            {ratingError || saveError}
          </p>
        )}

        {canAct && !isOwnRecipe && (
          <ReportButton target={{ recipe: recipeId }} label="Report this recipe" />
        )}
      </section>

      {/* ------------------------------------------------------- reviews */}
      <section className="mx-auto mt-12 max-w-[620px]">
        <h2 className="font-display text-xl font-semibold text-ink">Reviews</h2>

        {canAct && (
          <div className="mt-4">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Share how it went..."
              rows={3}
              className="w-full rounded-2xl border border-rule bg-card p-3 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon"
            />
            <div className="mt-2 flex items-center justify-between">
              {commentError && (
                <p role="alert" className="text-sm text-red-600">
                  {commentError}
                </p>
              )}
              <button
                type="button"
                disabled={commentBusy || !commentText.trim()}
                onClick={submitComment}
                className="ml-auto rounded-full bg-maroon px-5 py-2 font-display text-xs font-semibold text-card transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {commentBusy ? "Posting..." : "Post review"}
              </button>
            </div>
          </div>
        )}

        {comments.length === 0 ? (
          <p className="mt-6 text-sm text-muted">No reviews yet.</p>
        ) : (
          <ul className="mt-6 flex flex-col gap-5">
            {comments.map((comment) => {
              const isOwnerOrAdmin =
                !!user && (user.user_id === comment.user.user_id || user.role === "admin");

              return (
                <li key={comment.comment_id} className="border-b border-rule pb-5">
                  <div className="flex items-center justify-between">
                    <p className="font-display text-sm font-semibold text-ink">
                      @{comment.user.username}
                    </p>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted">
                        {new Date(comment.created_at).toLocaleDateString()}
                      </span>
                      {isOwnerOrAdmin && (
                        <button
                          type="button"
                          onClick={() => removeComment(comment.comment_id)}
                          className="text-xs font-semibold text-maroon hover:underline"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate">{comment.content}</p>
                  {canAct && !isOwnerOrAdmin && (
                    <div className="mt-2">
                      <ReportButton target={{ comment: comment.comment_id }} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
