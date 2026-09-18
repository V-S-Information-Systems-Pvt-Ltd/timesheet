@RTK.md

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

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

- For architecture and dependency discovery, begin with `docs/ai-context/` plus Atlas for a bounded structural map, then use Serena for live symbol/reference retrieval. Use the existing knowledge graph or semantic index when the question remains cross-cutting or semantic after those narrower steps. This repository's graph is `.ua/knowledge-graph.json`; legacy projects may use `.understand-anything/knowledge-graph.json`. Use the directory already configured for the project.
- For a task already scoped to known files, begin with those files or the current diff and consult the graph when dependencies or impact need clarification.
- Prefer context in this order: current diff/task-specific files, `docs/ai-context/`, Atlas, Serena, targeted source inspection, Understand Anything for unresolved cross-cutting semantics/impact, then broader searches or full-file reads when evidence requires them.
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

## Progressive context retrieval

Keep architecture reasoning evidence-rich and context-bounded. The compact entry point is `docs/ai-context/README.md`.

- For substantial tasks use this order: existing task-specific context/current diff → `CURRENT_STATE.md` → `ARCHITECTURE.md` → relevant `docs/ai-context/` domain file → Atlas → Serena → targeted source snippets → complete source files → Understand Anything for complex semantic/cross-cutting questions → broad repository exploration only as a last resort.
- On an unfamiliar or broad repository task, run Atlas (`atlas . --budget 2048`, adding `--focus <path>` when useful) before opening many files.
- Use Serena for live symbol definitions/bodies, implementations, references, related symbols, and diagnostics. Prefer symbol/reference retrieval over whole-file reads when it answers the question.
- Read targeted source snippets to verify behavior before editing. Expand to complete files only when narrower evidence is insufficient.
- Use Understand Anything (`.ua/knowledge-graph.json`) only when semantic, cross-cutting, onboarding/context-recovery, or dependency-impact questions remain unclear after the narrower steps. Check `.ua/meta.json` and source drift before relying on graph conclusions; do not rebuild the graph merely because HEAD differs.
- For tiny, already-localized edits, skip the full hierarchy and read the known file/diff directly.

### CLI context hygiene

- Use RTK for noisy supported CLI output when exact raw output is unnecessary; keep raw commands for forensic/audit output, binary data, or cases where RTK filtering would hide required detail.
- Bound searches and logs, avoid dumping generated/vendor directories, and summarize large results before continuing.
- Reuse retrieved evidence instead of repeatedly re-reading the same files. Record architecture-affecting conclusions in `docs/ai-context/ARCHITECTURE_DELTA.md` rather than carrying them only in chat history.
- Do not dump dependency lockfiles into model context unless dependency resolution requires them; do not pass full test/build output when a concise failure digest is sufficient; do not pass full Git history when the relevant range is known.
- Prefer `git diff` over re-reading unchanged files, specific symbols over full source files, architecture deltas over reconstruction, and deterministic extraction over LLM repository summarization when the evidence is equivalent.

## Model escalation policy

Use cheap retrieval and scout models for discovery; reserve Astra or another highest-capability architecture model for decisions that actually need architecture judgment.

Escalate only after assembling a bounded decision packet using `docs/ai-context/ARCHITECTURE_DECISION_PACKET_TEMPLATE.md`. The packet should contain verified facts, constraints, the relevant dependency slice, viable alternatives, risks, and explicit unknowns. Do not send an entire repository, broad log dump, or unfiltered graph to an architecture model.

Astra should normally receive the architecture context relevant to the decision, the precise decision required, confirmed constraints and existing decisions, compact source-referenced evidence, alternatives, known risks, unresolved questions, and the architecture delta. Use `ASTRA_ARCHITECT.md` as the reusable task prompt. It should not normally receive whole repositories/directories, lockfiles, full test/build/log output, unrelated source, or repetitive search results. If Astra requests more implementation evidence, retrieve the smallest relevant symbol/snippet with Serena or targeted source inspection.

Recommended escalation path:

1. Atlas map for structure.
2. Serena symbols/references for precise live code relationships.
3. Targeted source/tests/config to verify facts.
4. Understand Anything for unresolved cross-cutting semantics/impact.
5. Cheap scouts for parallel evidence gathering.
6. If evidence is still insufficient, use a stronger scout/research pass before escalating.
7. Astra/high-capability model only when the remaining question is an architecture trade-off or decision.

### Astra / high-capability architecture model policy

Astra is an architectural reasoning resource, not the first repository-retrieval tier. Before supplying context to Astra:

1. define the precise architectural question;
2. collect deterministic evidence with Atlas, Serena, Git, tests, and targeted source inspection;
3. use Understand Anything only when the remaining question is semantic or cross-cutting;
4. assemble `docs/ai-context/ARCHITECTURE_DECISION_PACKET_TEMPLATE.md`;
5. remove unrelated implementation detail and include source references, constraints, alternatives, risks, and unknowns.

Astra should not normally receive entire repositories or directories, lockfiles, raw logs, complete test output, or unrelated source. If it needs more evidence, retrieve the smallest relevant symbol or reference with Serena.

### Cheap scout contract

Give scouts bounded questions and likely paths/symbols. Require each finding to be labeled `FACT`, `INFERENCE`, or `UNKNOWN` and include source references. Scouts gather and challenge evidence; they do not make the final architecture decision. If scouts disagree, retrieve the underlying source and resolve the discrepancy before escalation.

### When to escalate

Good reasons include a change to a major auth/persistence boundary, a new cross-backend contract, a deployment/topology decision, a difficult concurrency/security trade-off, a multi-package compatibility decision, or multiple viable designs with material long-term cost. Ordinary bug fixes, localized refactors, known-pattern features, and mechanical migration additions should stay on the cheaper path unless evidence exposes a larger architecture choice.

### Tiny task exception

For a tiny, obvious, known-location change, read the target, edit it, and run targeted validation. Do not invoke Atlas, Understand Anything, architecture scouts, or Astra unless the task actually requires them.

## Architecture delta workflow

When an architecture baseline exists, identify the baseline commit/tag, inspect the relevant Git diff, classify only architecture-sensitive changes, and update `docs/ai-context/ARCHITECTURE_DELTA.md`. Architecture-sensitive changes include dependencies/configuration, API/public contracts, auth/security, database/schema/migrations, shared interfaces/repository abstractions, infrastructure/deployment, and cross-layer refactors. Do not make Astra re-analyze unchanged components merely because a new architecture review was requested, and do not refresh the full context pack for routine bug fixes.
