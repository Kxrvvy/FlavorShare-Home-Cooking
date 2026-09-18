/* The admin-only surfaces: the summary report, the activity feed, and
 * account management. All three endpoints already gate on IsAdmin server-side
 * - see dashboard/views.py and accounts/views.py's AdminUserViewSet - so
 * nothing here re-checks the role; a non-admin token gets a 403 from the API
 * the same as it would from any other client.
 *
 * request/rows/Paginated are imported rather than redefined: they carry the
 * 401-retry-once behaviour features/recipes/api.ts already worked out, and a
 * second copy of that is exactly the kind of thing that drifts.
 */

import {
  request,
  type CommentRow,
  type Paginated,
  type RatingRow,
  type ReportReason,
} from "@/features/recipes/api";

export interface DashboardTotals {
  users: number;
  recipes: number;
  published_recipes: number;
  draft_recipes: number;
  ratings: number;
  comments: number;
  saved_recipes: number;
  tags: number;
  meal_plans: number;
  activities: number;
  pending_reports: number;
}

export interface LeaderboardRecipe {
  recipe_id: number;
  title: string;
  rating_count?: number;
  average_score?: number;
  save_count?: number;
}

export interface MonthlyActivityPoint {
  /** The first day of the month, e.g. "2026-09-01". */
  month: string;
  count: number;
}

export interface DashboardSummary {
  totals: DashboardTotals;
  most_rated: LeaderboardRecipe[];
  most_saved: LeaderboardRecipe[];
  monthly_activity: MonthlyActivityPoint[];
}

export async function getDashboardSummary() {
  return request<DashboardSummary>("/dashboard/summary/");
}

export interface ActivityRow {
  activity_id: number;
  user: { user_id: number; username: string };
  recipe: number | null;
  action_type: "posted" | "edited" | "commented" | "rated" | "saved";
  description: string;
  created_at: string;
}

export async function listActivities(params: {
  action_type?: ActivityRow["action_type"];
  user?: number;
  page?: number;
} = {}) {
  const query = new URLSearchParams();
  if (params.action_type) query.set("action_type", params.action_type);
  if (params.user) query.set("user", String(params.user));
  if (params.page) query.set("page", String(params.page));

  return request<Paginated<ActivityRow>>(`/dashboard/activities/?${query.toString()}`);
}

export interface AdminUserRow {
  user_id: number;
  username: string;
  email: string;
  role: "guest" | "registered" | "admin";
  is_admin: boolean;
  is_active: boolean;
  dietary_preferences: string | null;
  created_at: string;
  last_login: string | null;
}

export async function listUsers(params: {
  search?: string;
  role?: AdminUserRow["role"];
  is_active?: boolean;
  page?: number;
} = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.role) query.set("role", params.role);
  if (params.is_active !== undefined) query.set("is_active", String(params.is_active));
  if (params.page) query.set("page", String(params.page));

  return request<Paginated<AdminUserRow>>(`/accounts/users/?${query.toString()}`);
}

export async function getUser(userId: number) {
  return request<AdminUserRow>(`/accounts/users/${userId}/`);
}

/** Change a role or activate/deactivate - the two levers CLAUDE.md gives an
 * Admin over an account. Everything else on a user is theirs alone to edit. */
export async function updateUser(
  userId: number,
  patch: Partial<Pick<AdminUserRow, "role" | "is_active">>
) {
  return request<AdminUserRow>(`/accounts/users/${userId}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** A soft delete: the API sets is_active false and revokes the session
 * rather than removing the row, so the account's recipes and reviews are
 * never taken down with it. Reverse with updateUser(id, {is_active: true}). */
export async function deactivateUser(userId: number) {
  return request<void>(`/accounts/users/${userId}/`, { method: "DELETE" });
}

/* --------------------------------------------------------------- comments */

/** Every comment platform-wide, unfiltered - an admin's own token is what
 * makes that possible: CommentViewSet scopes through visible_recipes(), and
 * that function returns every recipe (drafts included) to an admin caller,
 * so no recipe/user filter at all still means "everything". */
export async function listAllComments(params: {
  recipe?: number;
  user?: number;
  page?: number;
} = {}) {
  const query = new URLSearchParams();
  if (params.recipe) query.set("recipe", String(params.recipe));
  if (params.user) query.set("user", String(params.user));
  query.set("ordering", "-created_at");
  if (params.page) query.set("page", String(params.page));

  return request<Paginated<CommentRow>>(`/social/comments/?${query.toString()}`);
}

/** Ratings one user has given - only the count is used, for their stats
 * panel on the user detail page. */
export async function listUserRatings(userId: number) {
  return request<Paginated<RatingRow>>(`/social/ratings/?user=${userId}`);
}

/* -------------------------------------------------------------- categories
 *
 * "Categories" in the admin panel manages the existing Tag lookup table -
 * there is no separate Category entity. TagViewSet is admin-only for writes
 * (IsAdminOrReadOnly) precisely so this page can use it; reads were already
 * open to guests, for the tag filter on the public recipe list.
 */

export interface TagRow {
  tag_id: number;
  name: string;
}

export async function listTags(params: { search?: string; page?: number } = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  query.set("ordering", "name");
  if (params.page) query.set("page", String(params.page));

  return request<Paginated<TagRow>>(`/social/tags/?${query.toString()}`);
}

export async function createTag(name: string) {
  return request<TagRow>("/social/tags/", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function updateTag(tagId: number, name: string) {
  return request<TagRow>(`/social/tags/${tagId}/`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/** Refused with a 400 naming the count if any recipe still carries this tag
 * - Tag.recipe_links is PROTECT, and perform_destroy checks first rather
 * than letting Django's ProtectedError surface as a 500. */
export async function deleteTag(tagId: number) {
  return request<void>(`/social/tags/${tagId}/`, { method: "DELETE" });
}

/* ---------------------------------------------------------------- reports
 *
 * The moderation queue. Filing itself (createReport) lives in
 * features/recipes/api.ts - any registered user can do that, not just an
 * admin - this file only covers the admin-only half: reading the queue and
 * resolving an entry.
 */

export interface ReportRow {
  report_id: number;
  reporter: { user_id: number; username: string };
  recipe: number | null;
  recipe_title: string | null;
  comment: number | null;
  comment_content: string | null;
  comment_recipe: number | null;
  reason: ReportReason;
  details: string;
  status: "pending" | "resolved" | "dismissed";
  resolved_by: { user_id: number; username: string } | null;
  resolved_at: string | null;
  created_at: string;
}

export async function listReports(params: {
  status?: ReportRow["status"];
  reason?: ReportReason;
  page?: number;
} = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.reason) query.set("reason", params.reason);
  if (params.page) query.set("page", String(params.page));

  return request<Paginated<ReportRow>>(`/dashboard/reports/?${query.toString()}`);
}

/** Marks the report closed without taking any action on its target - that
 * still happens through the existing recipe/comment moderation controls,
 * beforehand and separately. */
export async function resolveReport(
  reportId: number,
  status: "resolved" | "dismissed"
) {
  return request<ReportRow>(`/dashboard/reports/${reportId}/resolve/`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}
