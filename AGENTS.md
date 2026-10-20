@RTK.md

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# VSIS Timesheet

Next.js 16 App Router timesheet app on self-hosted PostgreSQL with in-app scrypt authentication. Native is the only backend; the former Supabase backend and the one-off migration tool have been retired.

## Working rules

- This guidance applies across coding agents, editors, shells, and package managers. Resolve workflow invocations from the relevant package manifest, lockfile, and configuration.
- Keep changes within the requested task. Reviews and explanations are read-only unless implementation is also requested.
- Inspect the working tree before and after changes. Distinguish existing changes from your own, preserve unrelated work, and remove only scratch files created for the current task.
- Preserve identifiers, paths, public contracts, and established conventions. Communicate in the user's language.
- Report the outcome, changed files, and verification concisely. Distinguish checks that passed from those skipped, unavailable, or failing.

## Context retrieval

Read as little as needed. Source code is authoritative over every index and doc.

1. Tiny, already-localized task: open the target file or `git diff` directly and stop here.
2. Otherwise read `docs/ai-context/CURRENT_STATE.md`, then only the one domain file in `docs/ai-context/` that matches the task (see its `README.md`).
3. For symbols, callers, and impact, use your agent's code index (Serena in Codex, jCodeMunch in Claude Code) or Atlas (`atlas . --budget 2048`) before reading whole files. Read targeted snippets, then full files only if needed.
4. `.ua/knowledge-graph.json` (Understand Anything) is for broad onboarding, cross-cutting, or impact questions only. Before relying on it, compare `gitCommitHash` in `.ua/meta.json` against `git diff --name-only <hash> HEAD` for the paths you care about; treat changed paths as unverified. Refresh it incrementally only when asked.
5. Skip `node_modules`, `.next`, `coverage`, `test-results`, `.claude/worktrees`, lockfiles, and generated output in searches.

Output hygiene: prefer `rtk <cmd>` for noisy CLI output (see `RTK.md`). Report a concise failure digest, not full logs. Do not reprint successful build route tables.

Escalation and delegation: keep ordinary fixes local. For a material auth, persistence, concurrency, or deployment decision, fill in `docs/ai-context/ARCHITECTURE_DECISION_PACKET_TEMPLATE.md` and use `ASTRA_ARCHITECT.md`. Delegate only when asked. Give each agent a bounded packet (objective, files, acceptance checks) and ask it to label claims `FACT`, `INFERENCE`, or `UNKNOWN`. Verify agent claims against source.

Architecture delta: when a change affects dependencies, public or API contracts, auth, schema or migrations, shared interfaces, or deployment, add a short dated entry at the top of `docs/ai-context/ARCHITECTURE_DELTA.md`. Keep that entry to 10 lines or fewer. Skip this step for routine fixes.

## Architecture

- The browser reaches the server only through `/api/v1` via `lib/data/client.ts` and `lib/auth/client.ts`. The Server Action facade (`app/actions*`) and the legacy `/api/auth` and `/api/data` routes have been removed; `tests/boundary-enforcement.test.ts` keeps them from returning.
- `lib/db/types.ts` defines shared persistence types and actor guards including `Actor`, `DbWrite`, `DbResult<T>`, `BulkTimesheetUpdate`, and `ReportBucket`.
- Domain composition modules in `lib/db/` (`timesheets`, `reference`, `people`, `workspace`, `operations`, `leave-reminders`, `reporting`, and `rate-limits`) export the native adapters directly; there is no global repository dispatcher. Adapters in `lib/db/native/` enforce authorization through parameterized SQL.
- `lib/db/pool.ts` owns the native `pg` pool through `query` / `getPool`; migrations run once on pool initialization. `lib/db/migrate.ts` and `db/seed.mjs` share `db/migrate-runner.mjs`; do not duplicate migration logic.
- Request-time imported-history compatibility (`public.migration_retry_history`, fresh-key tickets, `public.migration_write_gate`) lives in `lib/idempotency/portable-retry.ts`, `lib/idempotency-fresh-key.ts` and `lib/db/write-gate.ts`; the tool that populated them has been removed, but the tables and code stay until a dedicated cleanup migration retires them.
- Profiles have independent role axes: `permission_role` (admin|pm|co|user) and `hierarchy_role` (manager|team_lead|engineer|user). A database trigger synchronizes the legacy `role` column.
- `lib/auth/index.ts` is the server authentication facade; `lib/auth/client.ts` is the browser facade. Authentication uses scrypt hashes (bcrypt hashes imported from Supabase are still verified and upgraded on login) and signed session cookies in `native.ts`, `password.ts`, and `jwt.ts`. `lib/ip.ts` resolves proxy-aware client IPs for rate limits.
- Browser authentication endpoints are in `app/api/v1/auth/browser/` (handlers in `app/api/_native-browser-*.ts`), and shared cookie HTTP guards are in `app/api/_http.ts`. The versioned API is in `app/api/v1/`; its `_http.ts` validates bearer tokens, stored sessions, and actor state.
- `mobile/` contains the mobile application and its separate package workflows.
- Shared UI lives in `app/components/`: `ui.tsx` is the design system, alongside `cn.ts`, `dialog.tsx`, and `toast.tsx`. There is no `app/components/ui/` convention.
- Migrations use `db/migrations/NNNN_*.sql`.

## Security and implementation contracts

- Gate every route through the guards in `app/api/v1/_http.ts` / `app/api/_http.ts`. Return the established error shape instead of throwing to clients. Apply rate limiting once per batch.
- Resolve identity and current profile state through the authentication facade. Keep signed-in, active-account, and role checks distinct; a valid session alone does not authorize data access.
- Database writes return `DbWrite` (`{ error: string | null }`); reads return data or throw through the `Repository` contract. Application features must use this boundary rather than opening database clients directly.
- Do not use a privileged shortcut for a read-only aggregate that would expose other users' rows.
- Any `SECURITY DEFINER` function needs explicit owner, grants, `search_path`, and security tests.
- Add migrations instead of editing applied migrations, including migrations already merged to `main`.
- Report aggregates are scoped in SQL by actor (`lib/db/native/reporting.ts`). The unscoped `get_timesheet_daily_totals` was removed after callers moved to `sumHoursForUserDates`; do not reintroduce it.
- Use Conventional Commits: `<type>(<scope>): <desc>`, as described in `CONTRIBUTING.md`.

## Verification and project workflows

Use `package.json` (or the relevant package manifest), `vitest.config.mts`, `playwright.config.ts`, and `.github/workflows/ci.yml` as the authoritative workflow definitions.

- Select checks by change impact. Behavior changes need focused tests covering success and at least one failure mode; repository or authentication changes need regression coverage. Documentation-only edits normally need content, path, and diff checks.
- Use `vi.hoisted` when Vitest mock factories reference top-level values. The `server-only` alias points to `tests/helpers.ts`, allowing server modules in unit tests.
- Coverage includes `lib/**`, `app/api/**`, and `packages/**/src/**`, excluding generated database types. Current aggregate gates are 60% for lines, functions, and statements, and 50% for branches; security-sensitive files have additional thresholds in `vitest.config.mts`.
- Database integration tests require `TEST_DATABASE_URL` pointing to a migrated PostgreSQL database. Report skipped database tests explicitly. Use the existing concurrency and password-recovery integration workflows when those behaviors change.
- Playwright uses the production standalone server configured in `playwright.config.ts`. Prepare the production build and seeded `E2E_EMAIL` / `E2E_PASSWORD` credentials first. Use the accessibility workflow for affected UI flows and k6 for relevant performance work.
- Database migrations and seeding enter through `db/migrate.ts` and `db/seed.mjs`. Seeding is idempotent and creates the initial administrator from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- Production builds include TypeScript checking. There is no build-time backend switch; `NEXT_PUBLIC_BACKEND` is no longer read.
- CI covers lint, unit tests, coverage, type checking, the production build, a Docker image build, PostgreSQL integration tests, Playwright, and separate mobile lint/type/test checks. Run the relevant checks locally and disclose anything that could not be verified.

