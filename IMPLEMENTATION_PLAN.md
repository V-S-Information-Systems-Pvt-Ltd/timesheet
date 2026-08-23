# VSIS Timesheet Improvement Plan

This plan supersedes the previous plan. It keeps releases small, separates the
native and Supabase backend concerns, and puts regression coverage ahead of
behavioral changes.

## Delivery principles

- Native and Supabase are two PostgreSQL backends, not separate SQL dialects.
  Native uses the in-app migration runner; Supabase schema changes are applied
  through `supabase/migrations` and may require database RPC functions.
- Preserve current public Server Action exports and return shapes during the
  actions refactor.
- Do not make a security or data-integrity change without a focused regression
  test in the same change.
- A database constraint, index, or RPC is introduced only after checking the
  live schema/data needed for a safe rollout.

## Phase 0 — Security corrections and regression tests

Ship this phase first.

### 0.1 Enforce active accounts consistently

Create a single action-level active-user gate, such as `requireActiveActor`,
which returns the established unauthenticated/inactive error shapes. Inventory
all 46 exported Server Actions before changing them and classify each one as:
public, signed-in, active, role-gated, or super-admin. Apply the gate according
to that inventory rather than only searching for current `getActor()` or
`requireActor()` calls. This must include actions such as `getTitles`, which is
used inside the authenticated dashboard but currently resolves no actor.

Record the classification in a table-driven test or adjacent policy map so a
new action cannot silently omit its required gate. Any genuinely public action
must be explicitly documented as public and return no sensitive information.

Keep `app/api/_http.ts`'s `requireActive()` as the route-handler equivalent;
do not try to make `requireRole()` the universal gate. Make `isSuperAdmin()`
require an active actor as defense in depth.

Acceptance:

- An inactive valid session is rejected by representative user, admin, and
  super-admin actions, and by every data route.
- A normal active actor retains existing behavior and response shapes.
- Every exported action has a tested classification, including actions that
  currently resolve no actor at all.
- No direct action path uses an actor without the active-user gate, except an
  explicitly documented public/auth-only operation.

### 0.2 Fix proxy-aware rate-limit identity

Add one client-IP resolver used by login, signup, and domain-check routes.
Define separate, explicit policies for the supported deployments:

- Vercel: use the documented Vercel-provided client-IP source after verifying
  its current contract against the installed/deployed platform configuration.
- Kubernetes/OpenShift behind Nginx Ingress: document whether the ingress
  overwrites or appends forwarding headers and trust only the configured proxy
  boundary/hops.
- Local/direct mode: do not trust forwarded headers by default.

Never select an arbitrary forwarded value supplied by the client. Production
startup/configuration must fail closed or use a conservative shared fallback
key when the expected proxy policy is not configured; it must not silently
trust the left-most forwarded value.

Document the topology and the in-memory, per-instance limitation in the
README. Add unit tests for direct requests, a trusted proxy chain, and spoofed
forwarded values.

### 0.3 Unify password policy and version hashes

For native authentication, use the existing `passwordSchema` for signup,
password change, and admin user creation. Make seed validation enforce the same
minimum/complexity rule (or explicitly document a narrowly justified seed-only
exception). Supabase Auth password storage and hashing remain managed by
Supabase and are outside the scrypt-format migration.

Move password hash parsing/creation to a single versioned format, for example
`scrypt$N$r$p$salt$hash`. Verify legacy `salt:hash` values and rehash them on a
successful login or password change. Update `db/seed.mjs` alongside
`lib/auth/password.ts`; both currently implement hashing independently. Bound
accepted scrypt parameters during verification to prevent resource exhaustion.

### 0.4 Remove login timing oracle

For native authentication, after the versioned hash parser exists, verify a
missing account or account without a password hash against a fixed valid dummy
hash before returning the existing generic failure response. Test that
unknown-email and wrong-password paths call the same verification path.

## Phase 1 — Low-risk cleanup

### 1.1 Remove unused component-directory files

Remove the unused `app/components/ui/` directory only after a fresh import
check confirms that consumers resolve to `app/components/ui.tsx`, not that
directory. Run lint, typecheck, unit tests, and a production build.

### 1.2 Resolve the stale dashboard hook

`useDashboardData` does not currently cover default layouts and associated
dashboard behavior. Prefer deletion if it has no consumers. If it is retained,
first reconcile its API with the dashboard page and add hook-level tests for
fetch sequencing, optimistic updates, and layout state before wiring it in.

### 1.3 Defer adapter-error normalization

Do not classify this as dead-code cleanup. Keep current read/write error
behavior until Phase 3 defines a repository-wide typed result contract and its
caller migrations.

## Phase 2 — Split Server Actions without behavioral change

Reuse the active-user gate and authorization policy completed in Phase 0. Add
only the remaining small internal primitives needed for extraction: role/super
admin checks, rate-limit helpers, `unwrap` for `DbWrite`, and an audit-log
helper. Each must preserve the action's existing error and rate-limit
semantics.

Then extract actions into focused modules while keeping `app/actions.ts` as a
barrel that exports exactly the existing names and signatures:

```text
app/actions/
  _shared.ts
  timesheets.ts
  projects.ts
  users.ts
  settings.ts
  import-backup.ts
  superadmin.ts
app/actions.ts
```

Before the full extraction, run a small Next.js 16 build spike that imports one
extracted Server Action from an existing Client Component through the proposed
barrel. Do not assume `export *` preserves the Server Function boundary. If the
barrel is rejected or produces unstable action references, either keep explicit
async facade functions in `app/actions.ts` or migrate callers to the dedicated
action modules. Record the chosen pattern in the plan/checkpoint before the
mechanical split.

Every action module must retain the appropriate Server Action directive and
must not import client-only modules. `_shared.ts` is a server-only helper module,
not a Server Action entry point, and should be marked `server-only` rather than
given a file-level `use server` directive. Migrate validation incrementally
using the existing `parseSchema` helper; do not replace well-tested validation
merely for style consistency.

Keep the extraction itself behavior-preserving. In a separate Phase 2 follow-up
change, add audits for user creation, user deletion, role changes, and status
changes. Document whether audit failure is best-effort or must fail the
mutation; apply that decision consistently.

Acceptance:

- The Server Action boundary spike passes a Next.js production build before
  the remaining modules are extracted.
- Existing 43 `actions.test.ts` and 32 `actions-extra.test.ts` cases stay
  green without semantic rewrites.
- New tests cover inactive users, super-admin gating, exports, and each newly
  audited mutation.
- Dashboard optimistic logging, bulk edit, layouts, backup, and keyboard
  shortcuts pass smoke coverage.

## Phase 3 — Repository contracts and restore correctness

### 3.1 Define adapter error behavior

Choose a typed, method-appropriate contract for repository reads and writes.
Do not convert every read to `DbWrite`: reads need data-or-error result types.
Migrate callers method-by-method, beginning with `getDefaultLayouts`, and add
tests for both native and Supabase failure behavior.

### 3.2 Share backend-agnostic restore preparation

Extract pure restore preparation into `lib/db/restore-shared.ts`: normalized
name/email lookup keys, duplicate-key construction, daily totals, and validated
candidate rows. Keep database I/O, transactions, and backend-specific error
translation inside each adapter.

Do not add content-based global uniqueness to reminders or global reminders;
two intentional reminders may legitimately share a message and timestamp.
Introduce restore-only identity instead. Prefer a backup v2 format that exports
stable source record IDs and restores them through a nullable `restore_key`
with a unique partial index. Continue accepting v1 backups by deriving a
document-scoped fingerprint or by clearly documenting their weaker idempotency
guarantee. Normal reminder creation leaves `restore_key` null and is unaffected.
An in-memory duplicate set alone is not sufficient for repeated or concurrent
restores.

Acceptance:

- Restore tests cover projects, activity types, timesheets, leaves, reminders,
  global reminders, unknown users, a second restore, and concurrent conflicts.
- Native restore remains atomic in its existing transaction.
- Supabase restore has documented partial-failure behavior until Phase 4 adds
  an atomic RPC implementation.

### 3.3 Make backup upload limits reachable

The current Server Action accepts backup text up to 20 MB, while Next.js Server
Actions default to a 1 MB request body. Prefer a dedicated authenticated Route
Handler for backup upload/restore so the larger limit is scoped to one endpoint.
Apply origin/CSRF checks, active-admin authorization, content-type validation,
streamed or bounded reading, and the existing parser limits before calling the
repository. If a larger global Server Action limit is chosen instead, document
the memory/DoS tradeoff and test the configured limit in both deployment modes.

Acceptance:

- A backup slightly above 1 MB reaches validation and restore successfully.
- A payload above the configured 20 MB limit is rejected before JSON parsing or
  database work.
- Unauthenticated, inactive, non-admin, wrong-origin, and wrong-content-type
  requests are rejected.

## Phase 4 — Database primitives and performance

This phase starts with schema/RPC design, then uses those primitives from the
application. Native migration changes belong in `db/migrations`; equivalent
Supabase schema/RPC changes belong in `supabase/migrations`.

### 4.1 Migration-runner hardening (native only)

Add a PostgreSQL advisory lock around the complete native migration run. Add a
checksum column with an upgrade path for existing `schema_migrations` rows,
then fail clearly if an applied migration's checksum changes. Update the
duplicate runner in `db/seed.mjs` or replace it with shared logic.

Keep migrations that require `CREATE INDEX CONCURRENTLY` outside the runner's
per-migration transaction and document their manual deployment procedure.

### 4.2 Data-integrity rollout

Before adding any new constraint, run a read-only preflight against production
data. Preserve the existing positive-hours rule and add a per-entry upper bound
only as `hours_worked > 0 AND hours_worked <= 24`.

Harden the existing daily 24-hour trigger for concurrency. Its current
read-sum-check sequence does not serialize two concurrent writes for the same
user/date. Acquire a transaction-scoped advisory lock derived from the
user/date (or implement an equivalently safe database design) before computing
the total, and use the same locking rule in restore/bulk RPCs. Add an integration
test in which concurrent individually valid inserts would jointly exceed 24
hours; exactly one transaction must fail.

Measure actual index usage and duplicates before changing indexes. Add an index
on `leaves(leave_date)` only if its query pattern and plan justify it; retain
the existing `(user_id, leave_date)` index for user-scoped reads.

### 4.3 Atomic Supabase operations via RPC

Add narrowly scoped PostgreSQL functions for operations that need server-side
transactions or aggregation and cannot be expressed safely through PostgREST:

- atomic backup restore;
- bulk timesheet validation/update;
- grouped report totals;
- grouped import daily totals.

Define the execution identity and grants for each RPC:

- User-context reporting/bulk RPCs should execute with the authenticated JWT
  where practical and verify active status, role, ownership, and row scope.
- Service-role restore RPCs must not rely on `auth.uid()`. Revoke execution from
  `PUBLIC`, `anon`, and `authenticated`, grant it only to `service_role`, set a
  safe `search_path`, fully qualify referenced objects, and retain the active
  admin/super-admin decision in the trusted server boundary immediately before
  invocation.
- Any `SECURITY DEFINER` function must have an explicit owner, minimal grants,
  fixed `search_path`, and tests proving unauthorized roles cannot execute it.

Expose only the parameters/results needed by the adapter. The native adapter
should implement equivalent behavior with parameterized SQL and a transaction.

### 4.4 Restore and bulk-write efficiency

After Phase 4.3, batch native restore inserts based on PostgreSQL parameter
limits and foreign-key ordering. The native path already has a transaction;
preserve it. Have Supabase call its atomic restore RPC rather than making a
series of client inserts.

Replace the per-row bulk-edit repository round trips with one backend method.
Preserve per-row result reporting, ownership/backfill checks, daily-hour
validation, and the current once-per-batch rate-limit behavior.

### 4.5 Reporting and import queries

Add a repository method that requests grouped report totals without an exact
row count. Implement native SQL aggregation and the Supabase reporting RPC.
Do not merely move the existing JavaScript loop into the route.

For imports, use grouped daily-total retrieval through native SQL/Supabase RPC
instead of paging all timesheet rows. Compare results against the current
implementation on a representative data set.

Extend performance coverage before using `npm run load` as the acceptance
gate. The current k6 script covers only login and paginated timesheet reads.
Add reproducible scenarios or focused benchmark scripts for grouped reports,
large imports, bulk updates, and restores. Record dataset size, concurrency,
backend, hardware, p50/p95 latency, throughput, errors, and database query
counts for baseline and post-change runs.

### 4.6 Bundle loading

Measure bundle/server startup impact before changing adapter imports. If it is
material, use a backend-selected loader that keeps the repository type stable
and verify both production builds. Confirm the framework's current module and
server-boundary guidance before implementing this change.

Acceptance for Phase 4:

- Native and Supabase integration tests verify equivalent results.
- Migration tests cover a pre-checksum database, two concurrent runners, an
  altered applied migration/checksum mismatch, failure rollback, and a clean
  second run.
- Concurrent writes cannot bypass the daily 24-hour cap.
- Restore remains atomic per backend operation.
- Performance scenarios report baseline and post-change results for timesheet
  reads, reports, imports, bulk updates, and restores using the same dataset and
  concurrency settings.

## Phase 5 — CI and quality ratchets

### 5.1 Native E2E in CI

The repository already has Playwright smoke and accessibility tests. Add a
native E2E job with a PostgreSQL service, migration, an explicit E2E seed
account, production build, and Playwright execution. Pass the runtime
environment to both `next start` and Playwright. Keep Supabase E2E separate;
it requires a provisioned Supabase environment rather than the CI Postgres
service.

### 5.2 Authentication route coverage

Extend the existing signup-route pattern to login, logout, `me`, and
change-password. Include timing-dummy, password-policy, session, CSRF/origin,
and rate-limit cases where applicable.

### 5.3 Coverage and type safety

First establish a baseline. Expand coverage scope only after the newly included
modules have meaningful tests; then raise thresholds in small, enforced steps.
Add a dedicated `tsc --noEmit` CI job before enabling
`noUncheckedIndexedAccess`, fix the resulting sites, and then enable it in a
separate focused change.

## Release checkpoints

| Checkpoint | Release content | Required verification |
| --- | --- | --- |
| A | Phase 0 | Targeted security tests, lint, unit tests, both production builds |
| B | Phase 1–2 | Existing action tests, new action auth tests, dashboard smoke coverage |
| C | Phase 3 | Native and Supabase restore/error-contract tests |
| D | Phase 4 | Migration/RPC integration tests, load-test comparison, rollback plan |
| E | Phase 5 | CI E2E run, auth route suite, coverage/typecheck baseline |

No phase should modify applied migration files. Every deployment with a schema
change needs a preflight, a forward-only migration, and a documented recovery
procedure.
