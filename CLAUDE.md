# FlavorShare Home Cooking — Project Context (CLAUDE.md)

This file documents everything decided so far for this project. Read this
before making changes so suggestions stay consistent with what the team
has already agreed on.

---

## ⚠️ WORKING AGREEMENT — READ BEFORE WRITING ANY CODE

**I will review every piece of code before it is accepted. Do not treat
any code you write as final until I explicitly approve it.**

Concretely, this means:

1. Before writing code for a new feature or file, briefly state your
   plan (what files you'll touch, what each will do) and wait for my
   go-ahead if the change is non-trivial.
2. After writing or editing code, **stop and summarize the diff** —
   what changed and why — instead of silently moving on to the next
   file.
3. Do not mark a task/todo as done, commit, or move to the next step
   until I've reviewed and approved the current change.
4. Never run destructive commands (`git push`, force operations, mass
   file deletion, overwriting my edits) without asking first.
5. If you're unsure about a requirement below, ask rather than assume
   and silently pick an interpretation.
6. Keep changes small and reviewable — prefer one file/feature at a
   time over large multi-file sweeps I'd have to review all at once.

---

## Project Overview

**App name:** FlavorShare Home Cooking
**Type:** Recipe sharing web application — course project (Group 4, AM5)
**Team size:** 5 members

### Problem Statement
- Fragmented recipe saving for home and amateur cooks
- Decentralized sources for shared recipes, making it hard to find and
  share reliable recipes within the community
- Difficulty creating meal plans and pursuing dietary goals with recipes
  scattered across sources

### Target Users

**External users** (interact with content):
- Home cooks
- Food bloggers
- Users with specific dietary goals

**Internal users** (manage the platform) — *folded into a single Admin
role, see User Roles below*:
- Food/Culinary Curator
- Content Moderators
- Admin

---

## User Roles (exactly 3 — required by course rubric)

1. **Guest Users**
   - Browse recipes, search/filter/sort
   - View recipe details and ratings
   - View public users' recipe collections

2. **Registered Users** — all Guest permissions, plus:
   - Create, edit, publish, and save recipes
   - Leave ratings and reviews
   - View nutrition info on recipes
   - Receive email notifications (new comments/ratings, meal plan reminders)
   - Generate meal plans from saved recipes

3. **Admin** — all Registered User permissions, plus:
   - Manage user accounts (remove, promote to admin)
   - Delete/flag explicit or inappropriate reviews and recipes
     (covers old "content moderator" function)
   - Curate/feature recipes (covers old "food curator" function)
   - Access the Admin Dashboard & Reporting

---

## Proposed Features (10)

1. **Account Creation** — sign up to publish/save recipes
2. **Recipe Publishing** — create/edit/publish recipes (name, ingredients,
   steps, final image)
3. **Image Uploads** — ingredient photos, process steps, final product
4. **Recipe Search, Filtering, and Sorting** — by keyword, title, cuisine,
   ingredients, tags/diet; paginated results
5. **Personal Recipe Collection** — saved/published recipes under a
   user's own records
6. **Ratings & Reviews** — 1–5 star ratings + comments
7. **Meal Plan Generator** — daily/weekly schedules from saved recipes
8. **Admin Dashboard & Reporting** — totals, pending moderation, most
   rated/saved recipes, recent activity, monthly activity chart
9. **Nutrition Information** — auto-fetched nutrition facts per recipe
   via Edamam's Recipe Analysis API, fetched lazily on first view and cached
10. **Email Notifications** — new comment/rating alerts, meal plan
    reminders via **Brevo**

---

## System Architecture (plain-language version)

- **Client Layer** — React/Next.js website used by all 3 roles; Admins
  see extra pages (e.g., dashboard) others can't access.
- **Server Layer** — Django is the "brain": handles routing, sessions,
  auth, and business logic. Django REST Framework (DRF) exposes the API
  that the frontend calls to get/send data.
- **Database Layer** — MySQL stores all actual data (users, recipes,
  ingredients, ratings, comments, saved recipes, meal plans), organized
  into connected tables (proper PK/FK relationships).
- **External Integrations**
  - Nutrition API — Edamam Recipe Analysis calculates calories/macros per recipe
  - Brevo — sends email notifications
- **Image Handling** — Cloudinary stores and resizes uploaded photos.
- **Security Layer** — hashed passwords, role-based access control,
  input validation, safe session management (Django defaults handle
  most of this; SQL injection protection comes from the Django ORM).

### Feature-to-Component Mapping
- Recipe Publishing → Django + MySQL (separate tables for ingredients/steps, not one text blob)
- Image Uploads → Cloudinary; only the image URL is stored in MySQL
- Search, Filter & Sort → MySQL queries (title, cuisine, ingredient, tag)
- Personal Recipe Collection → `SavedRecipe` join table (User ↔ Recipe)
- Ratings & Reviews → own tables, linked to both User and Recipe
- Meal Plan Generator → pulls from a user's saved/published recipes
- Nutrition Info → fetched from Edamam the first time a recipe is viewed by a
  signed-in user, then cached (`meal_plans/nutrition.py`, `NutritionInfoViewSet.fetch`)
- Email Notifications → triggered by events (new comment, new rating), sent via Brevo
- Admin Dashboard & Moderation → Admin-only; pulls stats directly from the database

---

## Initial ERD

**Note:** every primary key follows the `tablename_id` naming convention.
ERD was built manually by a group member and reviewed — structurally
correct and complete as of the last review.

### Core Entities

| Table | Fields |
|---|---|
| **User** | user_id (PK), username, email, password_hash, role, dietary_preferences, created_at |
| **Recipe** | recipe_id (PK), user_id (FK), title, description, cuisine_type, prep_time, cook_time, servings, difficulty, status (draft/published), view_count, created_at, updated_at |
| **Ingredient** | ingredient_id (PK), name, category |
| **Step** | step_id (PK), recipe_id (FK), step_number, instruction |
| **Image** | image_id (PK), recipe_id (FK), step_id (FK → Step, nullable), uploaded_by (FK → User), url, type (ingredient/step/final) |
| **Rating** | rating_id (PK), recipe_id (FK), user_id (FK), score (1–5), created_at |
| **Comment** | comment_id (PK), recipe_id (FK), user_id (FK), content, created_at |
| **Tag** | tag_id (PK), name (e.g., "vegan", "gluten-free", "Italian") |
| **MealPlan** | meal_plan_id (PK), user_id (FK), name, start_date, end_date |
| **MealPlanEntry** | meal_plan_entry_id (PK), meal_plan_id (FK), recipe_id (FK), day, meal_type (breakfast/lunch/dinner/snack) |
| **NutritionInfo** | nutrition_info_id (PK), recipe_id (FK), calories, protein, carbs, fat, fetched_at |
| **Activity** | activity_id (PK), user_id (FK), recipe_id (FK, nullable), action_type (posted/commented/rated/saved/edited), description, created_at |

### Join Tables (many-to-many)

| Table | Fields | Connects |
|---|---|---|
| **RecipeIngredient** | recipe_ingredient_id (PK), recipe_id (FK), ingredient_id (FK), quantity, unit | Recipe ↔ Ingredient |
| **SavedRecipe** | saved_recipe_id (PK), user_id (FK), recipe_id (FK), saved_at | User ↔ Recipe |
| **RecipeTag** | recipe_tag_id (PK), recipe_id (FK), tag_id (FK) | Recipe ↔ Tag |

**Design notes:**
- `Recipe.view_count` tracks views directly on the Recipe row instead of
  logging every page view into `Activity` (avoids table bloat).
- `Activity` exists to power the Admin Dashboard's "Recent Activities"
  feed, and can also serve as a trigger source for email notifications.
- `Image` is a **model inside the `recipes` app**, not its own separate
  Django app (it only exists in service of a recipe, so it doesn't meet
  the bar for being its own feature/app).
- `Image.step_id` is **nullable on purpose**: the recipe builder gives each
  step its own optional photo, so a step image points at its step, while
  cover (`final`) and `ingredient` images belong to the recipe as a whole
  and leave it null. Added after the original ERD — **the diagram needs
  redrawing to match.**
- **Soft limitation, not a bug:** nothing caps how many images may point at
  one step. The frontend renders a single photo slot per step to match the
  reference design, so extra step photos would simply not be displayed. A
  uniqueness constraint was considered and deliberately not added. Worth
  knowing if the Admin Dashboard ever counts or lists recipe images.
- **Silent schedule gaps, not a bug:** `MealPlanEntry` rows are read through
  `visible_recipes()`, so if a recipe you scheduled is later unpublished by
  its author, that entry disappears from the plan while its row stays in the
  database. This is deliberate and matches `SavedRecipe`, which hides
  unpublished recipes from a collection the same way — one visibility rule,
  not a per-feature exception. The consequence is that a plan can look like it
  has holes for no visible reason. Depth-pass options: surface the entry as
  "recipe no longer available" instead of omitting it, or have the Admin
  Dashboard report the divergence. Worth knowing if an entry count ever
  disagrees with what the schedule shows.
- **Auth support tables (not ERD entities):** `PendingSignup` and
  `OneTimeCode` live in the `accounts` app to carry email verification and
  password reset. They are in neither the ERD nor `flavorshare.sql`, and are
  excluded from both on purpose — they are infrastructure for a feature, like
  the framework tables below, not things the application is *about*. Both hold
  short-lived rows: created, used once, deleted. Signup is **deferred account
  creation** — a `Users` row is written only after its email is verified, so
  there is no `is_verified` column and no login-blocking logic anywhere.
- **Soft limitation, not a bug:** a username is only checked against *active*
  `PendingSignup` rows in the serializer, not by a database constraint, so two
  people registering the same username in the same instant can both pass the
  check before either row commits, and the second one wins the username at
  verification time. A unique constraint is not the fix: expired pending rows
  are never deleted, so one holding a username for an abandoned signup would
  block that username forever. Accepted at this scale; worth knowing before
  anyone treats pending usernames as reserved.
- **Expired `PendingSignup` / `OneTimeCode` rows were never deleted** — solved
  by `python manage.py cleanup_expired_tokens` (`accounts/management/commands/`),
  which deletes both tables' `.expired()` rows in one query each (`--dry-run`
  to preview counts first). Nothing calls it on a schedule yet — there is no
  background task runner in this project — so it is still a "run it by hand,
  or point cron/a host's scheduled-task feature at it" tool rather than
  something that runs itself.
- **Framework tables:** Django and SimpleJWT create their own tables in
  `flavorshare_db` (sessions, migrations, content types, permissions,
  admin log, token blacklist), so the live database holds more tables
  than the 15 above. These are infrastructure, not part of the
  application data model, and are intentionally excluded from this ERD.

---

## Technology Stack

- **Frontend:** React / Next.js
- **Styling:** Tailwind CSS
- **Backend:** Python (Django)
- **API:** REST (Django REST Framework)
- **Database:** MySQL
- **Auth:** JWT (`djangorestframework-simplejwt`)
- **Image Storage:** Cloudinary
- **Email Service:** Brevo (`brevo-python`; was Resend — see below)
- **Nutrition API:** Edamam Recipe Analysis (`meal_plans/nutrition.py`)
- **Hosting:** Vercel (frontend) + **Render** (backend, free tier)

### Hosting decision notes
- Render's free tier has a cold-start delay (~30–60s after inactivity)
  but does **not** block outbound API calls — acceptable tradeoff.
- PythonAnywhere was considered but rejected: free tier restricts
  outbound internet access to an allowlist, which would likely block
  Brevo and any future nutrition API calls.
- Railway and Fly.io were considered but ruled out due to unclear/
  no longer fully free tiers.
- **Action item before demo:** ping the Render backend a minute or two
  before presenting/grading so it's "warm" (not mid cold-start).

### Why Brevo, after starting with Resend
- Resend was integrated first and removed. On its free tier, without a verified
  sending domain, it only delivers to the **Resend account owner's own inbox** —
  a hard rejection from their API, not a spam-folder problem. Since an account
  is only created once its email is verified, that meant nobody but the key's
  owner could ever finish signing up: no teammate, no instructor, no grader.
- Buying and verifying a domain would fix it and is out of scope for this
  project, so the provider changed instead.
- Brevo's free tier sends to **any** real recipient with no domain setup —
  300 emails/day, no card required. The tradeoff is spam-folder risk rather than
  an outright block, which is the better problem to have here.
- **Constraint to remember:** without a verified domain Brevo still requires the
  From address to be a real mailbox you control, so `BREVO_FROM_EMAIL` cannot be
  an invented address like `no-reply@flavorshare.app`. README.md explains how to
  add and confirm one.
- SDK: the `brevo-python` distribution, which installs the package `brevo`
  (`from brevo import Brevo`). Not `sib-api-v3-sdk`, which is the legacy
  Sendinblue SDK, and there is no `brevo` distribution on PyPI at all.
- Only the transport changed. `accounts/emails.py` keeps the same two
  exceptions, the same public functions and the same message wording, and the
  views still map them to 503 and 502.

### Why Django over FastAPI (rationale, for reference)
- Team has mixed experience; Django's structure/conventions (ORM,
  migrations, built-in admin, auth) give more guardrails than FastAPI's
  minimal, "bring your own structure" approach.
- Built-in Django admin panel useful as a fallback while the custom
  admin dashboard is being built.
- DRF is mature and well-documented for CRUD/REST endpoints.

### Why MySQL (not PostgreSQL)
- Course rubric explicitly requires MySQL under "Database" — not just
  an example, a requirement. (Originally PostgreSQL was suggested for
  better Django ORM/search fit, but this was reverted to comply with
  the rubric.)

---

## Required Technical Features (Course Rubric) — Mapping

| Requirement | Covered by |
|---|---|
| Responsive UI (HTML5/CSS3/Tailwind/mobile) | Next.js + Tailwind |
| Client-side JS (validation, DOM, fetch, dynamic content) | Next.js/React |
| Routing, sessions, auth, authorization | Django + DRF |
| DB design, PK/FK, relationships, CRUD, SQL, normalization | ERD above, MySQL |
| REST API (GET/POST/PUT/DELETE) | DRF viewsets |
| Auth & security (hashing, RBAC, input validation, SQLi/XSS protection, sessions) | Django defaults + DRF |
| Dashboard & reporting | Admin Dashboard feature |
| Search, filter, sort, pagination | `django-filter` + DRF pagination |
| External API integration | Cloudinary (images), Brevo (email), and Edamam (nutrition) all integrated |

**Resolved:** instructor confirmed Django counts as an approved
server-side technology (rubric names PHP only as the default example, not
as a requirement).

### Search, filter and sort — two decisions worth knowing

Built in `recipes/filters.py` and wired into `RecipeViewSet`. Both of the
following look like oversights and are not, so they are recorded here as well
as in the code.

- **Repeated `tag` and `ingredient` values mean OR, not AND.**
  `?tag=vegan&tag=gluten-free` returns recipes carrying *either* — it widens
  the result rather than narrowing it. Different parameters still combine with
  AND, so `?tag=vegan&cuisine_type=thai` means both. A test asserts that a
  recipe matching only one of two supplied tags is still returned, which is
  what will fail if someone later "corrects" this into AND.
- **Nothing calls `.distinct()`, deliberately.** Filtering across tags or
  ingredients joins one recipe to several rows and would normally duplicate it.
  Two things already prevent that: the aggregate annotations in
  `RecipeViewSet.get_queryset()` put a `GROUP BY` on `Recipe.recipe_id`, and
  DRF's `SearchFilter` deduplicates its own joins by rewriting the query to
  `base.filter(Exists(...))`. A `.distinct()` on top would be redundant and
  would cost a pass over every listing.

  The consequence: **`RecipeFilterSet` is not self-contained.** Applied to a
  queryset with no aggregate annotation it *does* return duplicate rows —
  measured, and asserted in `FilterSetInIsolationTests`. Anything that reuses
  it elsewhere has to annotate or call `.distinct()` itself.

  Related, and the reason the `order_by()` in `get_queryset()` must not be
  removed: a `GROUP BY` also discards the model's `Meta.ordering` entirely, so
  that explicit `order_by` is the only thing ordering the recipe list. Dropping
  it makes pagination silently repeat and skip rows.

---

## Project Folder Structure

```
FlavorShare-Home-Cooking/
├── .claude/
├── .gitignore
├── README.md
├── requirements.txt
└── backend/
    ├── manage.py
    ├── db.sqlite3                  # temporary, gitignored, until MySQL is connected
    │
    ├── backend/                    # project settings package
    │   ├── __init__.py
    │   ├── settings.py
    │   ├── urls.py                 # MAIN router, includes all app urls.py
    │   ├── asgi.py
    │   └── wsgi.py
    │
    ├── accounts/                   # Person 1 — User & Auth
    ├── recipes/                    # Person 2 — Recipe, Ingredient, RecipeIngredient, Step, Image
    ├── social/                     # Person 3 — Rating, Comment, Tag, RecipeTag, SavedRecipe
    ├── meal_plans/                 # Person 4 — MealPlan, MealPlanEntry, NutritionInfo
    └── dashboard/                  # Person 5 — Activity, Admin dashboard, moderation
```

Each app follows the same internal structure:
```
<app_name>/
├── migrations/
├── __init__.py
├── admin.py
├── apps.py
├── models.py
├── serializers.py   # created manually — not generated by `startapp`
├── views.py
├── urls.py          # created manually — not generated by `startapp`
└── tests.py
```

**Frontend — decided by precedent, not a separate planning pass.** The tree
above predates the frontend entirely; this is the shape it actually grew
into, built out incrementally alongside the backend rather than planned up
front. Recorded here now that it is stable enough to call decided:

```
frontend/
├── app/                          # Next.js App Router — one folder per route
│   ├── admin/                    # the admin panel, its own layout+shell (see below)
│   ├── recipes/                  # Explore (list) and a recipe's own page
│   ├── me/                       # signed-in-only: meal plans, (my recipes lives here too)
│   └── ...                       # login, signup, forgot/reset-password, static pages
├── features/<domain>/            # one folder per backend app the frontend talks to
│   ├── api.ts                    # fetch wrappers + response types for that domain
│   └── components/               # components only that domain's pages use
├── components/                   # shared, not owned by any one domain
│   ├── layout/                   # AppShell, AdminShell, SearchField, nav
│   ├── auth/                     # RequireSignIn, RequireAdmin
│   ├── ui/                       # generic pieces used by more than one feature (PageButtons, ...)
│   └── home/                     # homepage-only sections (Hero, FeaturedRecipes, ...)
└── lib/                          # cross-cutting, no domain of its own
    ├── api.ts                    # API_BASE_URL, shared error parsing
    ├── auth.ts                   # the session store (see its own header comment)
    ├── useSession.ts             # the hook every component reads it through
    ├── types.ts                  # shapes mirroring the Django API, for pages with no feature/ of their own
    ├── format.ts                 # display formatting (recipe meta line, etc.)
    └── categories.ts             # the fixed six-tag chip list
```

`features/<domain>/api.ts` is the one place each domain's fetch calls and
response types live - `features/recipes/api.ts` also exports the shared
`request()`/`ApiError` helper every other domain's `api.ts` imports, rather
than each reimplementing the 401-retry-once behaviour it carries. A page
under `app/` is a thin composition of a domain's API calls and components;
business logic beyond "call the API and render the result" stays out of
`app/`.

### Team Split (5 people)
1. **Person 1 — Database Setup + Authentication** *(build first — others depend on this)*
   MySQL/Django connection, `User` model, signup/login/logout, password
   hashing, role-based access (sessions/JWT).
2. **Person 2 — Recipe Core**
   `Recipe`, `Ingredient`, `RecipeIngredient`, `Step`, `Image`; recipe CRUD; Cloudinary integration.
3. **Person 3 — Social Features**
   `Rating`, `Comment`, `Tag`, `RecipeTag`, `SavedRecipe`; save/unsave; search/filter/sort/pagination.
4. **Person 4 — Meal Plan + Nutrition**
   `MealPlan`, `MealPlanEntry`, `NutritionInfo`; meal plan generator; nutrition API integration (pending).
5. **Person 5 — Admin, Activity & Email**
   `Activity` logging, admin dashboard endpoints, email integration, moderation actions.

---

## Status / Open Items

**Decided:**
- Backend: Django + DRF
- Frontend: Next.js + Tailwind
- Database: MySQL
- Auth: JWT
- Image storage: Cloudinary
- Email service: Brevo (switched from Resend)
- Nutrition API: Edamam Recipe Analysis — chosen over Spoonacular/USDA
  FoodData Central/CalorieNinjas because it takes a title plus plain-English
  ingredient lines (what `RecipeIngredient`'s free-typed name+quantity+unit
  already is) and returns whole-recipe macros in one call; the others all
  need each ingredient resolved to a specific food id first. Built:
  `meal_plans/nutrition.py` (the client) and
  `NutritionInfoViewSet.fetch` (`meal_plans/views.py`) populate `NutritionInfo`
  lazily, the first time a signed-in user views a recipe, and cache it rather
  than re-asking Edamam's rate-limited free tier on every view. `EDAMAM_APP_ID`
  / `EDAMAM_APP_KEY` are blank by default — see README.md for getting a free
  pair.
- Hosting: Vercel (frontend) + Render (backend)
- Full ERD (15 tables) — built and reviewed
- 5-app Django structure — built and reviewed
- Frontend folder/page structure — grown by precedent rather than planned
  up front; recorded as decided under **Project Folder Structure** above
- **Admin Settings page** (`/admin/settings`) — scoped to the signed-in
  admin's own account (profile fields, password) rather than site-wide
  configuration, since no site-wide setting exists in this project's models
  to back one. Both endpoints it uses (`/api/accounts/me/`,
  `/api/accounts/password/`) already existed and were already tested; this
  is the first page in the whole project to surface either one. A password
  change signs the admin out everywhere, including the current session -
  `PasswordChangeView` blacklists every outstanding refresh token, and the
  page calls `signOut()` right after a successful change rather than trying
  to stay signed in past that.
- User roles (3) — finalized
- Proposed features (10) — finalized
- **Pending moderation metric, and moderation's Activity-log gap** — both
  were the same open item below for the same reason: nothing recorded that a
  recipe or review *had been* reported, or that an admin (rather than an
  author) had acted on one. Resolved together: `dashboard.Report` is a 16th
  table, past the original ERD on purpose (see its own docstring), that a
  registered user files a report into and an admin resolves or dismisses;
  `DashboardSummaryView` now counts `pending_reports` for real. Separately,
  `Activity.ActionType` gained a sixth value, `MODERATED`, logged only when
  the actor unpublishing a recipe or deleting a comment is not its author -
  self-service still logs nothing, the same as it always has. See
  `dashboard/models.py`, `dashboard/signals.py` and `dashboard/views.py`.

**Not yet decided / not yet built:**
- **`backend/flavorshare.sql`'s `CREATE TABLE` script — a teammate's own
  in-progress file, not a task waiting on this assistant.** It remains a
  reference alongside Django's migrations, not what the live database runs
  off of. It now carries its own header note explaining why its `ON DELETE`
  clauses will not match the live schema even where the intended behaviour
  agrees (Django's generated DDL is always `NO ACTION` regardless of a
  model's `on_delete`), and flagging the one place they disagree on more
  than DDL mechanics - every `user_id` FK here is CASCADE, where nearly
  every one in the models is PROTECT, because removing a user is a
  deactivation, not a delete. See the note in `dashboard/models.py` for the
  DDL-mechanics half in more depth. Nothing further here is expected unless
  the teammate asks for help finishing it.