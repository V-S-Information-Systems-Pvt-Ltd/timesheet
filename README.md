# VSIS Time Sheet System

Track and manage timesheet entries for VSIS projects: users log hours against
projects, mark leave days, set personal reminders, and admins/PMs/COs manage
users, projects, and CSV reports.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- [Tailwind CSS 4](https://tailwindcss.com) with a small shared design system in `app/components/ui.tsx`
- [Supabase](https://supabase.com) for Auth, Postgres, and Row Level Security
- [vitest](https://vitest.dev) for unit tests, GitHub Actions for CI

## Getting started

Prerequisites: Node.js 20.9+ (developed against Node 25) and npm.

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase credentials
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). New accounts are inactive
until an admin activates them (there is no bootstrap flow — grant the first
admin manually, e.g. `update profiles set role = 'admin' where email = '...';`).

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL (browser-safe) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon key (browser-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | no¹ | Server-only service-role key for the admin "Add User" feature |

¹ Optional: the rest of the app works without it; only admin user creation
needs it. It must never be exposed to the browser — `lib/supabase/admin.ts`
is guarded with `import 'server-only'`.

## Database

The schema and all Row Level Security policies live in
`supabase/migrations/` (applied in order). See [supabase/README.md](supabase/README.md)
for the full policy matrix and how to apply migrations:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Key tables: `profiles` (one row per auth user, with `role` and `is_active`),
`projects`, `timesheets`, `leaves`, `reminders`, and `app_settings`.

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
npm run dev      # development server
npm run build    # production build (also runs the TypeScript check)
npm run start    # serve the production build
npm run lint     # eslint
npm test         # vitest unit tests
```

Unit tests cover the pure logic in `lib/` (date helpers, backfill-window
validation, CSV escaping) — `tests/`. CI (`.github/workflows/ci.yml`) runs
lint, tests, and the production build on every push/PR.

## Project structure

```
app/                    UI pages, server actions, shared components
  actions.ts            'use server' mutations (window enforcement, roles)
  components/ui.tsx     design-system primitives (buttons, cards, tables, toasts)
  dashboard/            timesheet dashboard + admin panels
  reports/              hours, summaries, comparisons, CSV exports
lib/
  dates.ts              pure date helpers (ISO YYYY-MM-DD)
  validation.ts         input validators + backfill-window checks
  csv.ts                CSV escaping/building/download helpers
  supabase/             typed Supabase clients + database.types.ts
supabase/migrations/    SQL schema + RLS (versioned)
tests/                  vitest unit tests
```
