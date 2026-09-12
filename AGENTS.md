<!-- BEGIN:nextjs-agent-rules -->

# Next.js version guidance

This project uses Next.js 16, whose APIs, conventions, and file structure may differ from other versions. Before changing Next.js code, consult the relevant guide in the installed package's `node_modules/next/dist/docs/` directory, resolved from this file's directory. In a monorepo, the package may be nested below the repository root. Follow the installed version's guidance and heed deprecation notices.

This block is generated and restored during development-server startup; its generator is `node_modules/next/dist/server/lib/generate-agent-files.js`. Avoid editing or removing the generated block unless the generator or framework configuration is being changed intentionally.

<!-- END:nextjs-agent-rules -->

# VSIS Timesheet

Next.js 16 App Router timesheet app with two interchangeable backends: **supabase** (default, RLS) and **native** (self-hosted PostgreSQL, in-app scrypt authentication). `NEXT_PUBLIC_BACKEND` selects the backend at build time.

## Working rules

- This guidance applies across coding agents, editors, shells, and package managers. Resolve workflow invocations from the relevant package manifest, lockfile, and configuration.
- Keep changes within the requested task. Reviews and explanations are read-only unless implementation is also requested.
- Inspect the working tree before and after changes. Distinguish existing changes from your own, preserve unrelated work, and remove only scratch files created for the current task.
- Preserve identifiers, paths, public contracts, and established conventions. Communicate in the user's language.
- Report the outcome, changed files, and verification concisely. Distinguish checks that passed from those skipped, unavailable, or failing.

## Codebase context and token-efficiency policy

Use persistent repository knowledge to navigate; verify implementation details in the current source.

### Discovery and scope

- For architecture and dependency discovery, consult the existing knowledge graph or semantic index first. This repository's graph is `.ua/knowledge-graph.json`; legacy projects may use `.understand-anything/knowledge-graph.json`. Use the directory already configured for the project.
- For a task already scoped to known files, begin with those files or the current diff and consult the graph when dependencies or impact need clarification.
- Prefer context in this order: graph/index, architecture documentation, targeted symbol/file search, relevant source inspection, then broader searches when evidence requires them.
- Query relevant graph nodes, summaries, and relationships without loading the whole graph. Identify files, symbols, modules, callers, dependencies, routes, persistence boundaries, configuration, architectural layers, and tests needed for the task.
- Read the relevant source before editing. Source code is authoritative when it disagrees with the index; an absent graph edge does not prove that a dependency is absent.
- Scope discovery to the relevant application, package, or subsystem while retaining necessary runtime and API dependencies. Respect the configured analysis exclusions, currently `.ua/.understandignore`.
- Exclude dependencies, generated output, build artifacts, caches, coverage, and vendored code from broad scans. Focused inspection is appropriate when needed for framework documentation, generated contracts, or debugging.
- Reuse retrieved context and batch independent searches. Expand the working set only when the available evidence is insufficient.

### Graph freshness and maintenance

- Before relying on graph-derived context, inspect its metadata and analysis commit. Resolve the recorded commit before comparing it with the current revision.
- Check project-scoped committed changes since analysis, plus staged, unstaged, and untracked changes. Ignore generated graph artifacts when assessing source drift. A different commit hash alone does not establish staleness.
- If the graph is stale, missing, corrupted, or has unverifiable metadata, note relevant limitations and inspect current source through targeted searches and architecture documentation. Index availability must not block progress.
- Prefer supported incremental updates after meaningful source changes. Rebuild the full index only when none is usable, it is corrupted, major structural changes make incremental updates unreliable, indexing configuration materially changes, or a full rebuild is explicitly requested.
- Keep shared graph artifacts under version control, excluding `intermediate/` and `diff-overlay.json` in the selected graph directory. Use Git LFS for graph JSON files of 10 MB or larger.

### Implementation and review

1. Establish the task boundary and acceptance criteria using existing context.
2. Inspect the relevant current source, implement the scoped change, and perform the verification described below.
3. Review your changes against the starting worktree, including affected contracts and dependencies; report results and remaining limitations.

For reviews, start from the diff and prefer available diff-aware graph or dependency-impact analysis. Trace affected callers, downstream consumers, API contracts, persistence boundaries, authentication and authorization, security-sensitive components, and transaction or concurrency behavior. Inspect the relevant tests and broaden the review only where impact remains uncertain.

### Coordination and delegated work

When multiple agents are available, the coordinator supplies bounded objectives, acceptance criteria, relevant graph context, likely files, and dependency boundaries. Assign distinct file ownership where practical.

Delegated agents start with that supplied scope, inspect directly relevant dependencies, and use the graph for missing context. Report unexpected cross-component dependencies before expanding shared file ownership. Return concrete findings, changed files, and verification evidence; avoid unrelated refactoring and repeated architecture discovery.

## Architecture

- `app/actions.ts` re-exports Server Actions implemented in `app/actions/`: `_shared.ts`, `timesheets.ts`, `projects.ts`, `users.ts`, `settings.ts`, `superadmin.ts`, and `import-backup.ts`. Preserve existing action names and signatures.
- `lib/db/repository.ts` defines the backend-neutral `Repository` contract and types including `Actor`, `DbWrite`, `DbResult<T>`, `BulkTimesheetUpdate`, and `ReportBucket`.
- `lib/db/index.ts` dispatches `repo` to `nativeRepository` or `supabaseRepository`. `lib/db/native.ts` enforces authorization through parameterized SQL; `lib/db/supabase.ts` uses PostgREST, actor checks, and RLS.
- `lib/db/pool.ts` owns the native `pg` pool through `query` / `getPool`; migrations run once on pool initialization. `lib/db/migrate.ts` and `db/seed.mjs` share `db/migrate-runner.mjs`; do not duplicate migration logic.
- Profiles have independent role axes: `permission_role` (admin|pm|co|user) and `hierarchy_role` (manager|team_lead|engineer|user). A database trigger synchronizes the legacy `role` column.
- `lib/auth/index.ts` is the server authentication facade; `lib/auth/client.ts` is the browser facade. Native authentication uses scrypt hashes and signed session cookies in `native.ts`, `password.ts`, and `jwt.ts`; `supabase.ts` resolves Supabase identity and profile state. `lib/ip.ts` resolves proxy-aware client IPs for rate limits.
- Browser authentication endpoints are in `app/api/auth/`, native data routes in `app/api/data/`, and shared HTTP guards in `app/api/_http.ts`. The mobile API is in `app/api/v1/`; its `_http.ts` validates bearer tokens, stored sessions, and actor state.
- `mobile/` contains the mobile application and its separate package workflows.
- Shared UI lives in `app/components/`: `ui.tsx` is the design system, alongside `cn.ts`, `dialog.tsx`, and `toast.tsx`. There is no `app/components/ui/` convention.
- Native migrations use `db/migrations/NNNN_*.sql`; Supabase migrations use `supabase/migrations/<ts>_*.sql`. Schema changes affecting both backends require both migration sets.

## Security and implementation contracts

- Gate every Server Action through `requireActiveActor`, `requireActor(allowedRoles)`, or `requireSuperAdmin` from `app/actions/_shared.ts`. Return the established `{ error }` shape instead of throwing to clients. Apply rate limiting once per batch.
- Resolve identity and current profile state through the authentication facade. Keep signed-in, active-account, and role checks distinct; a valid session alone does not authorize data access.
- Database writes return `DbWrite` (`{ error: string | null }`); reads return data or throw through the `Repository` contract. Application features must use this boundary rather than opening database clients directly.
- Preserve backend behavior and authorization parity. Do not use a service-role client for a read-only aggregate that would expose other users' rows.
- Read-only grouping RPCs use `SECURITY INVOKER` and grants limited to intended roles. Any `SECURITY DEFINER` function needs explicit owner, grants, `search_path`, and security tests.
- Add migrations instead of editing applied migrations, including native migrations already merged to `main`. Apply Supabase schema changes through the established migration and deployment workflow.
- Preserve the RLS-scoped `get_grouped_report_totals` RPC and its grant checks in `tests/supabase-migrations.test.ts`. Migration `20260917000000` removed the unscoped `get_timesheet_daily_totals` after callers moved to `sumHoursForUserDates`; do not reintroduce it.
- Use Conventional Commits: `<type>(<scope>): <desc>`, as described in `CONTRIBUTING.md`.

## Verification and project workflows

Use `package.json` (or the relevant package manifest), `vitest.config.mts`, `playwright.config.ts`, and `.github/workflows/ci.yml` as the authoritative workflow definitions.

- Select checks by change impact. Behavior changes need focused tests covering success and at least one failure mode; repository or authentication changes need regression coverage. Documentation-only edits normally need content, path, and diff checks.
- Use `vi.hoisted` when Vitest mock factories reference top-level values. The `server-only` alias points to `tests/helpers.ts`, allowing server modules in unit tests.
- Coverage includes `lib/**`, `app/api/**`, and `app/actions.ts`, excluding generated database types. Current aggregate gates are 60% for lines, functions, and statements, and 50% for branches; security-sensitive files have additional thresholds in `vitest.config.mts`.
- Database integration tests require `TEST_DATABASE_URL` pointing to a migrated PostgreSQL database. Report skipped database tests explicitly. Use the existing concurrency and password-recovery integration workflows when those behaviors change.
- Playwright uses the production standalone server configured in `playwright.config.ts`. Prepare the production build and seeded `E2E_EMAIL` / `E2E_PASSWORD` credentials first. Use the accessibility workflow for affected UI flows and k6 for relevant performance work.
- Native database migrations and seeding enter through `db/migrate.ts` and `db/seed.mjs`. Seeding is idempotent and creates the initial administrator from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
- Production builds include TypeScript checking. Application changes must remain compatible with both `supabase` and `native` builds, especially when shared contracts or backend selection change.
- CI covers lint, unit tests, coverage, type checking, both backend builds, a Docker image build, PostgreSQL integration tests, Playwright, and separate mobile lint/type/test checks. Run the relevant checks locally and disclose anything that could not be verified.
