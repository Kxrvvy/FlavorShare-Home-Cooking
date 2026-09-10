# FlavorShare Home Cooking

A recipe sharing web application for home cooks — publish and save recipes,
rate and review them, and generate meal plans from what you've saved.

Course project, Group 4 (AM5). Django + DRF backend, MySQL database, with a
Next.js frontend to follow.

> **Full project spec** — roles, features, ERD, and team split — lives in
> [`CLAUDE.md`](CLAUDE.md). Read that before making changes.

---

## Prerequisites

| | Version | Notes |
|---|---|---|
| Python | 3.12+ | developed on 3.14 |
| MySQL | 8.0+ | MySQL Workbench is fine for creating the database |
| Git | any | |

---

## Setup

Do these in order. Steps 4 and 6 are the ones people skip.

### 1. Clone and enter the project

```bash
git clone https://github.com/<your-org>/FlavorShare-Home-Cooking.git
cd FlavorShare-Home-Cooking
```

### 2. Create a virtual environment

```bash
python -m venv .venv
```

Activate it — **this differs by shell**, and you need it active in every new
terminal:

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
```
```bash
# Git Bash / macOS / Linux
source .venv/Scripts/activate     # Windows
source .venv/bin/activate         # macOS / Linux
```

Your prompt should now start with `(.venv)`.

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

If `mysqlclient` fails to build here, see [Troubleshooting](#troubleshooting).

### 4. Create the MySQL database

The app does **not** create the database for you — only the tables inside it.
In MySQL Workbench (or the `mysql` CLI), run:

```sql
CREATE DATABASE IF NOT EXISTS flavorshare_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- A dedicated account, so nobody has to put their root password in a file.
-- Using root locally works too; just match it in DATABASE_URL below.
CREATE USER IF NOT EXISTS 'flavorshare'@'localhost' IDENTIFIED BY 'choose-a-password';
GRANT ALL PRIVILEGES ON flavorshare_db.* TO 'flavorshare'@'localhost';

-- Django builds a separate database when running tests and drops it after.
GRANT ALL PRIVILEGES ON test_flavorshare_db.* TO 'flavorshare'@'localhost';

FLUSH PRIVILEGES;
```

> The `CREATE TABLE` statements in [`backend/flavorshare.sql`](backend/flavorshare.sql)
> are reference documentation for the ERD. **Don't run them** — Django creates
> the real tables from the models in step 6.

### 5. Configure environment variables

Create a file at `backend/.env` — by hand, not by copying a template. **No
`.env` file of any kind belongs in this repository**, so there is nothing to
copy from; `.gitignore` blocks the whole `.env*` family on purpose.

| Variable | Required | Example | What it does |
|---|---|---|---|
| `DATABASE_URL` | **yes** | `mysql://flavorshare:your-password@127.0.0.1:3306/flavorshare_db` | Points Django at MySQL. Omit it and Django silently falls back to a local SQLite file — the usual reason your tables look empty. |
| `SECRET_KEY` | yes | *generate one, see below* | Signs sessions and JWTs. Never share or reuse one. |
| `DEBUG` | no | `True` | `True` locally, `False` in production. |
| `ALLOWED_HOSTS` | no | `localhost,127.0.0.1` | Comma-separated. Add your Render hostname once deployed. |
| `CORS_ALLOWED_ORIGINS` | no | `http://localhost:3000,http://127.0.0.1:3000` | Origins allowed to call this API. Add the Vercel URL once the frontend ships. |
| `CLOUDINARY_CLOUD_NAME` | for uploads | `dxxxxxxxx` | Cloudinary account to upload recipe photos to. |
| `CLOUDINARY_API_KEY` | for uploads | `123456789012345` | Public half of the Cloudinary credentials. |
| `CLOUDINARY_API_SECRET` | for uploads | *from your dashboard* | Secret half. Server-side only — never put this in the frontend. |

The three `CLOUDINARY_*` keys are needed only for image uploads. Leave them
out and everything else runs; `POST /api/recipes/images/upload/` answers
`503` with a message saying they are missing. Find all three on the Cloudinary
dashboard at <https://console.cloudinary.com> under **Account Details** — the
free tier is enough for this project.

Generate your own `SECRET_KEY`:

```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

So a minimal `backend/.env` looks like:

```ini
DATABASE_URL=mysql://flavorshare:your-password@127.0.0.1:3306/flavorshare_db
SECRET_KEY=paste-your-generated-key-here

# Only needed if you are working on image uploads
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

The three optional keys have working defaults in `settings.py`; set them only
when you need to override one.

### 6. Create the tables

```bash
python backend/manage.py migrate
```

**Run this again every time you pull.** New models and new third-party apps
both arrive as migrations, and skipping it produces confusing
"table doesn't exist" errors at runtime rather than at startup.

### 7. Create an admin account (optional)

```bash
python backend/manage.py createsuperuser
```

Superusers count as Admins in this project, so this account can reach
admin-only endpoints and the Django admin panel at `/admin/`.

### 8. Run it

```bash
python backend/manage.py runserver
```

The API is at http://127.0.0.1:8000/ and the Django admin at
http://127.0.0.1:8000/admin/.

---

## Running the tests

**Run these from inside `backend/`**, not from the project root:

```bash
cd backend
python manage.py test              # everything
python manage.py test accounts     # one app
```

Test discovery starts from the current directory, so `python
backend/manage.py test` from the project root finds **zero** tests and still
prints `OK` — a silent false pass. Naming an app
(`python backend/manage.py test accounts`) works from anywhere; only the
bare form needs the `cd`.

Tests build and drop their own `test_flavorshare_db`; your real data is never
touched. If this fails with a permissions error, revisit the second `GRANT`
in step 4.

---

## Auth endpoints

Everything below is live. Recipes, social, meal plans, and dashboard routes
are still being built by Persons 2–5.

Send the access token as a header: `Authorization: Bearer <access token>`.

| Method | Endpoint | Access | Body | Returns |
|---|---|---|---|---|
| `POST` | `/api/accounts/register/` | anyone | `username`, `email`, `password`, `dietary_preferences` (optional) | `201` + the new profile |
| `POST` | `/api/token/` | anyone | `username`, `password` | `200` + `access` and `refresh` tokens |
| `POST` | `/api/token/refresh/` | anyone | `refresh` | `200` + a new `access` **and a new `refresh`** |
| `POST` | `/api/token/verify/` | anyone | `token` | `200` if valid, `401` if not |
| `POST` | `/api/accounts/logout/` | signed in | `refresh` | `204`, no body |
| `GET` | `/api/accounts/me/` | signed in | — | `200` + the caller's own profile |
| `PATCH` | `/api/accounts/me/` | signed in | any of `username`, `email`, `dietary_preferences` | `200` + the updated profile |
| `POST` | `/api/accounts/password/` | signed in | `current_password`, `new_password` | `204`, no body |

Three things that will otherwise cost you an afternoon:

- **Refresh tokens rotate.** `/api/token/refresh/` returns a *new* refresh
  token and immediately invalidates the one you sent. Store the new one — reusing
  the old one returns `401`.
- **Logout revokes the refresh token, not the access token.** A JWT can't be
  recalled once issued, so the access token keeps working until it expires
  (30 minutes). Have the frontend discard both on logout.
- **`role` is read-only.** Sending it to `/register/` or `PATCH /me/` does
  nothing; every new account is `registered`. Promotion to admin is an
  Admin-only action.
- **Changing a password signs out every other session.** All of that account's
  refresh tokens are revoked, so the frontend must send the user back through
  login afterwards rather than reusing the token it holds.

### Admin only

Requires an account with `role = admin` (or a superuser). Anything else gets
`403`.

| Method | Endpoint | Body | Returns |
|---|---|---|---|
| `GET` | `/api/accounts/users/` | — | `200` + a paginated list of accounts |
| `GET` | `/api/accounts/users/<id>/` | — | `200` + one account |
| `PATCH` | `/api/accounts/users/<id>/` | `role` and/or `is_active` | `200` + the updated account |
| `DELETE` | `/api/accounts/users/<id>/` | — | `204`, no body |

List supports `?search=` (username, email), `?role=`, `?is_active=`, and
`?ordering=` (`username`, `created_at`, `role`; prefix with `-` to reverse).

- **`DELETE` deactivates — it does not delete.** The row stays, `is_active`
  goes `False`, and the account's recipes and reviews survive. Undo with
  `PATCH {"is_active": true}`. Deactivating also revokes that account's
  refresh tokens, so an existing session can't outlive it.
- **Admins can only change `role` and `is_active`.** Username, email, and
  dietary preferences stay read-only here, so moderation can't rewrite
  someone's profile.
- **You can't demote or deactivate yourself.** Returns `400`. Another admin
  has to do it — otherwise the last admin could lock everyone out.
- **There is no `POST`.** Accounts are only created by signing up.

---

## Troubleshooting

**`pip install` fails building `mysqlclient` (Windows).**
It compiles against MySQL's C client. Either install the
[MySQL Connector/C](https://dev.mysql.com/downloads/c-api/) and the
"Desktop development with C++" workload from the Visual Studio Build Tools,
or install a prebuilt wheel:

```bash
pip install mysqlclient --only-binary :all:
```

**`django.db.utils.OperationalError: (1049, "Unknown database 'flavorshare_db'")`**
Step 4 wasn't run, or `DATABASE_URL` names a different database.

**`Access denied for user ...`**
The credentials in `backend/.env` don't match the MySQL user from step 4.

**`Table 'flavorshare_db.<something>' doesn't exist`**
You pulled new code without migrating. Run `python backend/manage.py migrate`.

**Changes to a model do nothing.**
Editing `models.py` doesn't touch the database. Run
`python backend/manage.py makemigrations`, then `migrate`.

---

## Maintenance

**Expired refresh tokens.** Every login and refresh records a row so tokens
can be revoked. Once a token has expired it's rejected on age anyway, so the
row is dead weight — clear them out occasionally:

```bash
python backend/manage.py flushexpiredtokens
```

---

## Project layout

```
backend/
├── backend/      # settings and the main URL router
├── accounts/     # User model, auth, shared permission classes
├── recipes/      # Recipe, Ingredient, Step, Image
├── social/       # Rating, Comment, Tag, SavedRecipe
├── meal_plans/   # MealPlan, MealPlanEntry, NutritionInfo
└── dashboard/    # Activity, admin dashboard, moderation
```

Every app owns its own `models.py`, `serializers.py`, `views.py`, and
`urls.py`. Shared permission classes live in `accounts/permissions.py` —
import from there rather than writing your own role checks.
