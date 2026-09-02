# VSIS Time Sheet System

Track and manage timesheet entries for VSIS projects: users log hours against
projects, mark leave days, set personal reminders, and admins/PMs/COs manage
users, projects, and CSV reports.

> **End users:** see [USER_GUIDE.md](docs/guides/USER_GUIDE.md) for a
> step-by-step guide to the app — logging time, keyboard shortcuts, reports,
> leave, and admin tasks.

## Features

- **Multi-entry time logging** with a 24-hour daily cap, activity types, and a
  configurable backfill window that makes older entries read-only.
- **Logging helpers:** smart-hours quick-fill (suggests your most common hours),
  *Copy from last entry*, a recent-work autocomplete, and an optional
  Telegram-bot command copied to your clipboard on submit.
- **Recent entries table** with grouped-by-day rows, inline edit, single/bulk
  duplicate and delete, multi-select, per-user filtering (admins/COs/managers/
  team leads), and desktop **keyboard shortcuts** (`N`, `E`, `U`, `/`, `D`, `?`).
- **Reports** with date presets (today, this week, last 7 days, this/last month,
  custom range), project filters, period-over-period comparisons, and CSV export.
- **Leave markers, personal reminders, and global reminders.**
- **Role-based access** — `admin`, `pm`, `co`, `manager`, `team_lead`, `user` —
  with a user hierarchy (report-to), panel-level dashboard customization, and a
  super-admin role for destructive operations.
- **Admin panels** for users, projects, activity types, backfill, global
  reminders, leave, CSV import, and **backup & restore**.
- **Cross-Platform Mobile App (`mobile/`)** — React Native (Android, iOS, Windows)
  with bearer token auth, offline mutation queue, auto-sync engine, smart-hours
  and recent-work suggestions, Telegram-bot formatters, and multi-select bulk operations.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- [Tailwind CSS 4](https://tailwindcss.com) with a small shared design system in `app/components/ui.tsx`
- [React Native 0.84](https://reactnative.dev) + TypeScript for the standalone mobile application in `mobile/`
- [vitest](https://vitest.dev) (web) and [jest](https://jestjs.io) (mobile) for unit testing, GitHub Actions for CI
- **Two interchangeable backends** behind a thin abstraction layer:
  - `supabase` — Supabase Auth + Postgres + Row Level Security (deployed on Vercel)
  - `native` — self-contained PostgreSQL + in-app auth (deployed in a container on OpenShift/Rancher)

## Deployment modes

The same codebase runs in either mode. `NEXT_PUBLIC_BACKEND` selects the mode
(it is baked in at build time for the client, so set it before `npm run build`):

| Mode | Value | Auth | Database | Hosting |
| --- | --- | --- | --- | --- |
| Supabase + Vercel | `supabase` (default) | Supabase Auth | Supabase Postgres (RLS) | Vercel |
| Cloud-native container | `native` | In-app email/password (scrypt + signed cookie) + SMTP recovery | Self-hosted PostgreSQL via `DATABASE_URL` | OpenShift / Rancher / Docker |

In `native` mode the application does not depend on Supabase. Password recovery
requires an SMTP provider and the `APP_BASE_URL`/`SMTP_*` settings below;
self-hosted fonts keep the build offline-capable. Accounts are provisioned by
an admin (self-signup is hidden); the first admin is created with the seed
script (below).

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
| `SUPABASE_SERVICE_ROLE_KEY` | supabase | no² | Service-role key for admin actions and recovery-time mobile-session revocation |
| `DATABASE_URL` | native | yes | PostgreSQL connection string |
| `AUTH_SECRET` | native | yes | Long random string (≥32 bytes) for signing session cookies |
| `APP_BASE_URL` | native | yes for recovery | Public HTTPS origin used in reset links |
| `SMTP_HOST` / `SMTP_PORT` | native | yes for recovery | SMTP server and port (587 or 465 are common) |
| `SMTP_USER` / `SMTP_PASSWORD` | native | provider-dependent | SMTP credentials, when required |
| `SMTP_SECURE` | native | no | Set `true` for implicit TLS; port 465 enables it automatically |
| `SMTP_FROM` | native | yes for recovery | Verified sender address/name (defaults to `SMTP_USER`) |
| `MOBILE_AUTH_SECRET` | both | yes⁴ | Long random string (≥32 bytes) for signing mobile access tokens |
| `MOBILE_BEARER_AUTH_ENABLED` | both | no⁶ | Set `true` only after all mobile platforms prove OS-backed refresh-token storage |
| `WINDOWS_SIGNING_PASSWORD` | native/dev | no⁵ | Signing password for building/packaging Windows packages (`package:windows`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | native | seed only | First-admin bootstrap for `db:seed` |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | both | no³ | The super-admin account (reset database, delete users/activity types). Native `db:seed` provisions it; for Supabase, create the account with the matching email and admin role manually. |

¹ Defaults to `supabase`. ² Optional until password recovery or service-role
admin actions are enabled; recovery uses it to revoke app-managed mobile
sessions. It must
never be exposed to the browser — `lib/supabase/admin.ts` is guarded with
`import 'server-only'`. ³ When unset, super-admin features stay hidden. ⁴ Required
when mobile bearer token authentication is enabled. ⁵ Required when running `npm run package:windows` in `mobile/`. ⁶ Defaults to `false`; enable only after the secure-storage evidence gate passes.

The native recovery flow stores only a hash of each one-time reset token. Set
`APP_BASE_URL` to the exact public origin (no trailing path) and configure
SMTP before exposing `/forgot-password`. Supabase mode uses Supabase Auth's
password recovery flow; add `/reset-password` to the project's allow-listed
redirect URLs and keep the recovery page on the same origin. Configure custom
SMTP in Supabase for production deliverability and branded recovery templates.

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
`reminders`, `mobile_sessions`, and `app_settings`.

### Roles

Roles are split into two independent axes on each account:

**Permission role** (`profiles.permission_role`) — what the user can do:

| Permission role | Can do |
| --- | --- |
| `admin` | Everything — manage users/roles/activation, projects, backfill any user's time, generate reports, change the backfill window |
| `pm` | Log time + manage projects |
| `co` | Log time + view all profiles/timesheets + generate reports |
| `user` | Log and edit their own time, leave markers, reminders |

**Hierarchy role** (`profiles.hierarchy_role`) — reporting position:

| Hierarchy role | Can do |
| --- | --- |
| `manager` / `team_lead` | Log time + view/filter their team's entries and reports |
| `user` | Leaf: no direct reports |

The two are independent (e.g. `permission_role = admin` with `hierarchy_role =
manager`). The legacy `profiles.role` column is kept in sync by a trigger for
the transition.

In addition, a **super-admin** account (see `SUPER_ADMIN_EMAIL` in the
environment table) can reset the database, delete users and activity types,
and set the global **default panel order** (stored in `app_settings`).

### Backfill window

`app_settings.backfill_window_days` controls how far back regular users may
create or edit timesheet entries (default `1` = today + yesterday). Entries
older than the window become read-only. Admins can always log/edit any entry.
The setting is editable in the Admin Panel → Settings.

There can be **multiple timesheet entries per day**, capped at 24 hours total
per day (enforced by the log form and server actions). Entries inside the
backfill window stay editable; older entries become read-only (admins are never
restricted).

## Scripts

```bash
npm run dev        # development server
npm run build      # production build (standalone output; also runs the TS check)
npm run start      # serve the production build
npm run lint       # eslint
npm test           # vitest unit tests
npm run db:migrate # apply native migrations against DATABASE_URL
npm run db:seed    # create/update the first native admin (idempotent)
npm run db:concurrency-test # 24h-cap concurrency test (set TEST_DATABASE_URL first)

# Mobile application (cd mobile)
npm test                 # run jest mobile unit test suite
npm run typecheck        # TypeScript check for mobile application
npm run lint             # eslint for mobile codebase
npm run start            # start React Native Metro bundler
npm run windows          # launch React Native Windows app
npm run package:android  # build release APK -> mobile/build/android/
npm run package:windows  # build release MSIX -> mobile/build/windows/
npm run package:all      # build all mobile release binaries -> mobile/build/
```

Unit tests cover the pure logic in `lib/` (date helpers and report presets,
backfill-window validation, CSV escaping, password hashing, recent-work cache,
keyboard-shortcut guards, smart-hours suggestions) and the native repository's
authorization matrix — `tests/`. CI (`.github/workflows/ci.yml`) runs lint, a
dedicated typecheck job, unit tests, and the production build in both modes on
every push/PR.

### Data-integrity concurrency test (Phase 4)

`tests/daily-hours-concurrency.int.test.ts` verifies the hardened daily 24-hour
trigger (`db/migrations/0015_data_integrity_and_concurrency.sql`): two
individually-valid inserts into the same user/date that would jointly exceed 24h
must serialize via `pg_advisory_xact_lock` so exactly one succeeds. It is skipped
unless `TEST_DATABASE_URL` points at a migrated Postgres:

```bash
# apply migrations, then:
TEST_DATABASE_URL=postgres://... npx vitest run tests/daily-hours-concurrency.int.test.ts
```

### Bundle / backend loading (Phase 4.6)

The repository adapter is selected at server-import time in `lib/db/index.ts`
via `NEXT_PUBLIC_BACKEND` (`IS_NATIVE ? nativeRepository : supabaseRepository`);
no runtime async loader is used. The Phase 4.5/4.4 work added methods to the
existing adapters but did **not** restructure their imports, so the per-mode
bundle/server-startup footprint is unchanged. If a future change imports an
adapter only for one backend, re-measure the production build output (compare
`next build` route-level chunk sizes in both modes) before switching to a
backend-selected loader, keeping the `Repository` type stable.

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
  actions.ts            stable Server Action facade
  actions/              authorization-gated action implementations
  api/                  web and versioned mobile REST route handlers
  components/ui.tsx     design-system primitives (buttons, cards, tables, toasts)
  dashboard/            timesheet dashboard + admin panels
  reports/              hours, summaries, comparisons, CSV exports
lib/
  auth/                 server + client auth (supabase & native adapters)
  api/v1/               backend-agnostic mobile API contracts and services
  data/                 browser data client and cache
  db/                   repository contract and server-side backend adapters
  backend/              NEXT_PUBLIC_BACKEND selector
  dates.ts              pure date helpers (ISO YYYY-MM-DD) + report presets
  validation.ts         input validators + backfill-window checks
  csv.ts                CSV escaping/building/download helpers
  cache.ts              recent-work cache (localStorage, dedupe/eviction)
  shortcuts.ts          keyboard-shortcut guards + focus helpers
  smart-hours.ts        hours-suggestion heuristic
  supabase/             typed Supabase clients + database.types.ts
mobile/                 React Native client (Android, iOS, and Windows)
  src/                  mobile application source grouped by responsibility
  __tests__/            Jest unit and component tests
db/migrations/          native PostgreSQL schema (versioned)
supabase/migrations/    Supabase SQL schema + RLS (versioned)
deploy/                 Kubernetes/OpenShift manifests
docs/                   guides, architecture records, plans, and maintenance logs
e2e/                    Playwright end-to-end and accessibility tests
load/                   k6 load tests
tests/                  vitest unit tests
```

See [docs/README.md](docs/README.md) for the documentation index.
