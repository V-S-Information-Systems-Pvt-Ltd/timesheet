<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Model tuning: DeepSeek

- Terse replies: state change + file + verification only; skip plan recaps and read-backs.
- Batch independent tool calls (`grep`/`glob`/`ls` first, then targeted reads); never `read_file` in a loop.
- Next.js 16: verify APIs in `node_modules/next/dist/docs/`; do not assume training data.
- Never translate or rename identifiers, file paths, commands, or commit scopes; answer in the user's language.
- Check `git status` before starting and before finishing; remove scratch/probe files; final diff = intended changes only.
- Re-read the target hunk before editing; verify with a targeted `npx vitest run tests/<file>`.

# VSIS Timesheet

Next.js 16 App Router timesheet app with two interchangeable backends: **supabase** (default, RLS) and **native** (self-hosted Postgres, in-app scrypt auth). Select via `NEXT_PUBLIC_BACKEND` at build time.

## Commands

- dev / build / start: `npm run dev`, `npm run build` (`next build` incl. TS check), `npm run start`
- lint / typecheck / tests: `npm run lint` (eslint), `npm run typecheck` (`tsc --noEmit`), `npm test` (vitest run)
- e2e / a11y: `npm run e2e` / `npm run a11y` (Playwright); performance: `npm run load` (k6)
- native DB: `npm run db:migrate` (tsx db/migrate.ts), `npm run db:seed` (plain-Node db/seed.mjs), `npm run db:concurrency-test` (needs `TEST_DATABASE_URL`)
- tests live in `tests/*.test.ts`; DB integration tests use `TEST_DATABASE_URL` (skipped when unset).

## Architecture

- `app/actions.ts` — barrel re-export of Server Actions; real logic in `app/actions/` (`_shared.ts` helpers, `timesheets.ts`, `projects.ts`, `users.ts`, `settings.ts`, `superadmin.ts`, `import-backup.ts`). Preserve existing action names/signatures.
- `lib/db/repository.ts` — backend-agnostic `Repository` interface (types: `Actor`, `DbWrite`, `DbResult<T>`, `BulkTimesheetUpdate`, `ReportBucket`).
- `lib/db/index.ts` — `repo` dispatch: `IS_NATIVE ? nativeRepository : supabaseRepository`. `lib/db/native.ts` (SQL-param authz) & `lib/db/supabase.ts` (thin PostgREST client, RLS-leaning).
- `lib/db/pool.ts` — native `pg` pool (`query`/`getPool`). `lib/db/migrate.ts` wraps the shared plain-JS runner `db/migrate-runner.mjs` (also used by the seed).
- `lib/auth/` — `native.ts` (scrypt + signed cookie), `supabase.ts`, `password.ts` (versioned `scrypt$N$r$p$salt$hash`), `jwt.ts`, `client.ts`, `index.ts` facade. `lib/ip.ts` proxy-aware rate-limit IP.
- `app/api/` — native REST route handlers; `_http.ts` helpers (`originCheck`, `requireActive`, `serverError`). Auth routes under `app/api/auth/`, data under `app/api/data/`.
- `app/components/` — shared UI (`ui.tsx` = design system; `cn.ts`, `dialog.tsx`, `toast.tsx`), not `app/components/ui/`.
- Migrations: native `db/migrations/NNNN_*.sql`; Supabase `supabase/migrations/<ts>_*.sql`. Dual-backend changes update both.

## Conventions

- Server Actions: gate every action with `requireActiveActor` / `requireRole` / super-admin check from `app/actions/_shared.ts`; return `{ error }` shapes, never throw to the client. Rate-limit once per batch.
- DB writes return `DbWrite` (`{ error: string | null }`); reads return data or throw, via the `Repository` interface — never open a `pg` client directly except in `lib/db/*`.
- Both adapters must behave identically (native gates in SQL; supabase relies on RLS + actor checks). Keep authz parity — do not route a read-only aggregate through the service-role client when it exposes other users' rows.
- RPC/SQL security: read-only grouping RPCs are `SECURITY INVOKER` (RLS applies) and granted only to the intended roles; never `SECURITY DEFINER` without owner/grants/search_path + tests.
- Don't edit an applied migration (`db/migrations/` merged to `main`); add a new one. Supabase changes go through `supabase/migrations` and `supabase db push`.
- Tests: happy path + ≥1 failure mode; new repo/auth behavior gets a regression test. Use `vi.hoisted` for vi.mock factories referencing top-level values.
- Commit messages: Conventional Commits `<type>(<scope>): <desc>` (see CONTRIBUTING.md).

## Notes

- Supabase has a shared `get_timesheet_daily_totals` RPC (service_role only) and RLS-scoped `get_grouped_report_totals`; grants are guarded by `tests/supabase-migrations.test.ts`.
- Native `db/seed.mjs` and `lib/db/migrate.ts` both call the single runner in `db/migrate-runner.mjs` — don't re-implement migration logic elsewhere.
