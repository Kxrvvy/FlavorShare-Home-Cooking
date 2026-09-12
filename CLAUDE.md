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
   via an external nutrition API (deferred — not yet integrated)
10. **Email Notifications** — new comment/rating alerts, meal plan
    reminders via **Resend**

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
  - Nutrition API — calculates calories/macros per recipe (not yet chosen/integrated)
  - Resend — sends email notifications
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
- Nutrition Info → fetched from external API when a recipe is created/viewed (pending)
- Email Notifications → triggered by events (new comment, new rating), sent via Resend
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
- **Email Service:** Resend
- **Nutrition API:** not yet chosen (deferred)
- **Hosting:** Vercel (frontend) + **Render** (backend, free tier)

### Hosting decision notes
- Render's free tier has a cold-start delay (~30–60s after inactivity)
  but does **not** block outbound API calls — acceptable tradeoff.
- PythonAnywhere was considered but rejected: free tier restricts
  outbound internet access to an allowlist, which would likely block
  Resend and any future nutrition API calls.
- Railway and Fly.io were considered but ruled out due to unclear/
  no longer fully free tiers.
- **Action item before demo:** ping the Render backend a minute or two
  before presenting/grading so it's "warm" (not mid cold-start).

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
| External API integration | Resend (email) confirmed; nutrition API deferred |

**Open item:** confirm with instructor whether Django counts as an
"approved server-side technology" (rubric explicitly names PHP as the
default example).

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
   `Activity` logging, admin dashboard endpoints, Resend integration, moderation actions.

---

## Status / Open Items

**Decided:**
- Backend: Django + DRF
- Frontend: Next.js + Tailwind
- Database: MySQL
- Auth: JWT
- Image storage: Cloudinary
- Email service: Resend
- Hosting: Vercel (frontend) + Render (backend)
- Full ERD (15 tables) — built and reviewed
- 5-app Django structure — built and reviewed
- User roles (3) — finalized
- Proposed features (10) — finalized

**Not yet decided / not yet built:**
- Nutrition API provider (Edamam vs. Spoonacular vs. other) — deferred
- Instructor confirmation that Django satisfies "approved server-side technology"
- Actual `CREATE TABLE` DB script (in progress by a teammate) — note that
  Django enforces `on_delete` in the ORM, not in DDL: the FKs it generates are
  all `ON DELETE NO ACTION`, so a hand-written script using `ON DELETE CASCADE`
  / `SET NULL` will not match the live database's constraints even when the
  application behaviour agrees. See the note in `dashboard/models.py`.
- Frontend folder/page structure (not yet discussed)
- **Pending moderation metric** — Feature 8 lists it on the Admin Dashboard,
  but nothing in the ERD records that a recipe or review *was* reported, so
  there is no queue to count. Needs a decision: add a 16th table (`Flag` or
  `Report`) or redefine the metric as something derivable. Deliberately not
  implemented rather than filled with a fabricated number.
- **Moderation is invisible to the Activity log** — `Activity.action_type` has
  the ERD's five values (posted/edited/commented/rated/saved), none of which
  describes unpublishing, this project's soft moderation action. So an admin
  taking a recipe out of public view logs nothing, and the recent-activity feed
  cannot show moderation history. Adding a sixth value is an ERD change; parked
  with the item above since both point at the same gap.