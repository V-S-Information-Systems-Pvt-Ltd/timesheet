# VSIS Time Sheet System

Track and manage timesheet entries for VSIS projects: users log hours against
projects, mark leave days, set personal reminders, and admins/PMs/COs manage
users, projects, and CSV reports.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- [Tailwind CSS 4](https://tailwindcss.com) with a small shared design system in `app/components/ui.tsx`
- [vitest](https://vitest.dev) for unit tests, GitHub Actions for CI
- **Two interchangeable backends** behind a thin abstraction layer:
  - `supabase` — Supabase Auth + Postgres + Row Level Security (deployed on Vercel)
  - `native` — self-contained PostgreSQL + in-app auth (deployed in a container on OpenShift/Rancher)

## Deployment modes

The same codebase runs in either mode. `NEXT_PUBLIC_BACKEND` selects the mode
(it is baked in at build time for the client, so set it before `npm run build`):

| Mode | Value | Auth | Database | Hosting |
| --- | --- | --- | --- | --- |
| Supabase + Vercel | `supabase` (default) | Supabase Auth | Supabase Postgres (RLS) | Vercel |
| Cloud-native container | `native` | In-app email/password (scrypt + signed cookie) | Self-hosted PostgreSQL via `DATABASE_URL` | OpenShift / Rancher / Docker |

In `native` mode there are **no external dependencies**: no Supabase, no email
service, and self-hosted fonts (the build is offline-capable). Accounts are
provisioned by an admin (self-signup is hidden); the first admin is created
with the seed script (below).

## Getting started

Prerequisites: Node.js 20.9+ (developed against Node 25) and npm.

### Supabase mode

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase credentials
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). New accounts are inactive
until an admin activates them (there is no bootstrap flow — grant the first
admin manually, e.g. `update profiles set role = 'admin' where email = '...';`).

### Native mode (local)

```bash
npm install
cp .env.example .env.local
# set NEXT_PUBLIC_BACKEND=native, DATABASE_URL, AUTH_SECRET in .env.local
npm run db:migrate      # apply the schema (also applied automatically on startup)
npm run db:seed         # create the first admin from ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev
```

Or run the whole stack with Docker Compose:

```bash
docker compose up --build
# then create the first admin:
docker compose run --rm app node db/seed.mjs
```

## Environment variables

| Variable | Mode | Required | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_BACKEND` | both | no¹ | `supabase` (default) or `native` |
| `NEXT_PUBLIC_SUPABASE_URL` | supabase | yes | Supabase project URL (browser-safe) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | supabase | yes | Supabase anon key (browser-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | supabase | no² | Service-role key for the admin "Add User" feature |
| `DATABASE_URL` | native | yes | PostgreSQL connection string |
| `AUTH_SECRET` | native | yes | Long random string (≥32 bytes) for signing session cookies |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | native | seed only | First-admin bootstrap for `db:seed` |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | both | no³ | The super-admin account (reset database, delete users/activity types). Native `db:seed` provisions it; for Supabase, create the account with the matching email and admin role manually. |

¹ Defaults to `supabase`. ² Optional; only admin user creation needs it. It must
never be exposed to the browser — `lib/supabase/admin.ts` is guarded with
`import 'server-only'`. ³ When unset, super-admin features stay hidden.

## Database

### Supabase

The schema and all Row Level Security policies live in
`supabase/migrations/` (applied in order). See [supabase/README.md](supabase/README.md)
for the full policy matrix and how to apply migrations:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### Native PostgreSQL

The native schema lives in `db/migrations/` (plain Postgres, no `auth` schema /
RLS — authorization is enforced in the application layer). It is applied
idempotently on app startup and via `npm run db:migrate` (tracked in a
`schema_migrations` table). Requires PostgreSQL 13+.

Key tables: `profiles` (one row per account, with `role`, `is_active`, and
`password_hash` in native mode), `projects`, `timesheets`, `leaves`,
`reminders`, and `app_settings`.

### Roles

| Role | Can do |
| --- | --- |
| `admin` | Everything — manage users/roles/activation, projects, backfill any user's time, generate reports, change the backfill window |
| `pm` | Log time + manage projects |
| `co` | Log time + view all profiles/timesheets + generate reports |
| `user` | Log and edit their own time, leave markers, reminders |

### Backfill window

`app_settings.backfill_window_days` controls how far back regular users may
create or edit timesheet entries (default `1` = today + yesterday). Entries
older than the window become read-only. Admins can always log/edit any entry.
The setting is editable in the Admin Panel → Settings.

There is one timesheet entry per user per day, enforced at the database level
by a unique `(user_id, log_date)` index; logging for a date that already has
an entry updates it in place.

## Scripts

```bash
npm run dev        # development server
npm run build      # production build (standalone output; also runs the TS check)
npm run start      # serve the production build
npm run lint       # eslint
npm test           # vitest unit tests
npm run db:migrate # apply native migrations against DATABASE_URL
npm run db:seed    # create/update the first native admin (idempotent)
```

Unit tests cover the pure logic in `lib/` (date helpers, backfill-window
validation, CSV escaping, password hashing) and the native repository's
authorization matrix — `tests/`. CI (`.github/workflows/ci.yml`) runs lint,
tests, and the production build in both modes on every push/PR.

## Container deployment (OpenShift / Rancher)

The cloud-native image is built from the repo-root `Dockerfile` (multi-stage,
`node:22-alpine`, non-root, native mode baked in). It exposes port `3000` and a
`/api/health` probe endpoint.

```bash
docker build -t vsis-timesheet .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL="postgres://user:pass@host:5432/vsis" \
  -e AUTH_SECRET="<long-random-string>" \
  vsis-timesheet
```

Kubernetes manifests (Deployment, Service, ConfigMap, Secret, Ingress,
OpenShift Route, NetworkPolicy) live in `deploy/` — see
[deploy/README.md](deploy/README.md). A `docker-compose.yml` (app + PostgreSQL)
is provided for local container runs.

## Project structure

```
app/                    UI pages, server actions, shared components
  actions.ts            'use server' mutations (window enforcement, roles)
  api/                  native REST route handlers (auth + data)
  components/ui.tsx     design-system primitives (buttons, cards, tables, toasts)
  dashboard/            timesheet dashboard + admin panels
  reports/              hours, summaries, comparisons, CSV exports
lib/
  auth/                 server + client auth (supabase & native adapters)
  db/                   server + client data access (supabase & native adapters)
  backend/              NEXT_PUBLIC_BACKEND selector
  dates.ts              pure date helpers (ISO YYYY-MM-DD)
  validation.ts         input validators + backfill-window checks
  csv.ts                CSV escaping/building/download helpers
  supabase/             typed Supabase clients + database.types.ts
db/migrations/          native PostgreSQL schema (versioned)
supabase/migrations/    Supabase SQL schema + RLS (versioned)
deploy/                 Kubernetes/OpenShift manifests
tests/                  vitest unit tests
```
