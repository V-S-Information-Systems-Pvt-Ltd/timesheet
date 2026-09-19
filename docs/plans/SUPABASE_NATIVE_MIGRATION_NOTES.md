# Supabase/native migration — execution notes and checkpoint ledger

Created at C00 per `docs/plans/SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN.md` §9.
This file is updated after every checkpoint. It contains no record bodies, credentials, or sample personal data.

## Outcome (current)

The C00 repository inventory is complete, but C00 is **BLOCKED** against its PASS criteria until live-deployment inventory and operator decisions are recorded. The column matrix and durable-data classification below are derived from the migration SQL of both providers and the current source. No production migration has been attempted; production transfer additionally requires explicit C09 authorization. C01/C01M and C02 pass their recorded gates. C03's revised exporter ran live on `ef06a23` (export 6/6; the extended live round-trip 6/6 on the same revision). A follow-up verification round then fixed two further defects in the export path (identity probing inside the snapshot transaction under restricted roles; export-side row/entity size enforcement) with offline-suite evidence only. C03 remains BLOCKED on the implementation plan's C06A and approved-Auth-metadata-coverage dependencies, which are not settled.

## Baseline

| Field | Value |
|---|---|
| Recorded at | 2026-09-19 (C00 execution) |
| Plan baseline revision | `a2cead0d3ed6e6d8fe9a67b2e70e119ffec3e5fc` |
| Working tree HEAD at C00 | `89d20effa8e2b8e5e0ebeca3e4ff7e1df3ae29a2` |
| Working tree status | clean at C00 start; after C00 only this notes file is added (`git status --short`: `?? docs/plans/SUPABASE_NATIVE_MIGRATION_NOTES.md`) |
| Application version | 1.0.3 (`package.json`) |
| Backends | `native` (self-hosted PostgreSQL, scrypt auth) and `supabase` (PostgREST + Supabase Auth), selected by `NEXT_PUBLIC_BACKEND` |

## Checkpoint ledger

| Checkpoint | Status | Evidence / notes |
|---|---|---|
| C00 | BLOCKED (repository inventory complete) | Column matrix and classification below, derived from the native and Supabase migration trees. V0 and V1 verification recorded below. The plan's PASS gate still requires live catalog inspection against both datasets, row volumes, normalized-email/UUID collision scan, reference-name conflicts, singleton settings state, orphan references, legacy `role` inconsistencies, NOT-VALID-constraint violations, deleted-actor references, precision/hierarchy shape, recoverable backup inventory (data + Auth + objects), numeric downtime/recovery budgets, bundle retention, observation window, access windows, external-object scope, pending mobile writes, SMTP/enrollment readiness, first production direction, and a reserved recovery destination. These require deployment/operator inputs and remain unanswered. |
| C01 | PASS (repository + disposable-database legs) | Bundle format/validator, explicit connectors, read-only sessions, run journal and the `validate`/`inspect`/`preflight` CLI. V2: 53 tests pass (`tests/migration-format.test.ts`, `tests/migration-cli.test.ts`). V3: typecheck, lint, boundary tests (12) and coverage gate pass. Live: read-only `inspect` against the local Supabase stack and a disposable native database (write probes rejected); live `preflight` validated a fixture bundle, rejected same-instance aliasing and blocked (exit 5) on unverifiable Auth binding. See the C01 section below. |
| C01M | PASS (repository level; live slice still C02) | Matching, ID/provenance mapping, read-only preview, versioned resolution files and the expected merged state with invariant validation. `plan`/`resolve` CLI commands. V2: 43 merge-plan tests + 40 CLI tests (114 across the four migration/boundary suites). V3: typecheck, lint, boundary tests and coverage gate pass. An independent read-only review round produced four must-fix findings; all were fixed and covered by new tests (see "C01M review round"). Destructive database behavior (constraint triggers, RLS) is **not** claimed here; that is the C02 live-slice gate. |
| C02 | PASS (core slice live; two recovery paths mock-only) | Export → plan → resolve → apply → verify in both directions with destination enrollment through a disposable Auth recovery link: `tests/migration-roundtrip.int.test.ts` 6/6 against disposable native databases plus the local Supabase stack. The Auth run-marker lost-response recovery and the durable-receipt check after an uncertain SQL commit are implemented and covered by unit suites (`tests/migration-identity.test.ts`, `tests/migration-import-safety.test.ts`) but have **not** been exercised live; a live rerun of the extended suite is the remaining evidence. |
| C03 | BLOCKED (plan dependencies: C06A and approved Auth metadata coverage) | The revised live export suite passed 6/6 on `ef06a23` with 1,001 projects and 5,224 timesheets (catalog/ledger/provenance share the row snapshot; provenance is paged and capped before the manifest; stream/rollback failures retain interruption semantics), and the extended live round-trip passed 6/6 on the same revision. A follow-up verification round then fixed two exporter defects — identity probing inside the snapshot transaction fails for restricted roles (`25P02`), and the exporter did not enforce the validator's 4 MiB row / 8 GiB entity limits — with offline suites as the only evidence for those follow-up changes. The implementation plan makes C06A and approved Auth metadata coverage part of C03; those contracts are not settled. See the review addendum and the follow-up remediation round below. |
| C04 | PASS (repository + live identity evidence) | Identity disposition: every source account is mapped, newly provisioned, historical/non-login or explicitly excluded, and the apply refuses to start while any account is undisposed, excluded with dependents, missing an email, signed in through an unusable provider, or carrying a registered second factor. Enrolment status is recorded separately from the data import. Unit `tests/migration-identities.test.ts` 10/10; live `tests/migration-roundtrip.int.test.ts` 6/6 asserts the disposition/enrolment summary, matched-account login with the original destination password, new-account creation without a credential, enrollment through a provider-issued recovery link, the destination's legacy-role trigger, and whitelist preservation; Supabase signup/RLS/recovery regression 17/17. Remaining, explicitly not claimed: MFA enrollment is detected but never exercised. |
| C05 | NOT STARTED | Depends C03, C04, C06A. |
| C06A | NOT STARTED | Design gate after C01M; needs the BLOCKED C00 operational inputs. |
| C06B | NOT STARTED | |
| C07 | NOT STARTED | |
| C08 | NOT STARTED | |
| C09 | NOT STARTED | Explicit production authorization required; not requested. |
| C10 | NOT STARTED | |

## Confirmed requirements (restated from the plan; not re-asked)

- Planned switching with both writers fenced during final planning/apply; measured downtime budget still to be recorded (BLOCKED C00 item).
- Populated destinations supported and protected; empty destinations also supported.
- Incoming passwords are not transferred; existing destination credentials keep working; new accounts enroll on the destination.
- Both deployments run the same application release; each provider's schema fingerprint is verified independently.
- Unified identity behavior through the existing auth facade/identity contracts; no new identity service.
- Keep existing destination IDs where safe; otherwise allocate and persist complete mappings.

## Durable-data classification (C00 deliverable 3)

Derived from the migration SQL of both providers. **Live catalog confirmation is a BLOCKED C00 item** — source files alone do not establish deployed state.

### Business data (in the future migration bundle)

| Table | Columns (canonical order) | Constraints a merge must re-validate | Provider differences |
|---|---|---|---|
| `profiles` | id (uuid pk), email (uniq), name, department, title, permission_role (admin/pm/co/user), hierarchy_role (manager/team_lead/engineer/user), is_active, manager_id (self-fk, set null), dashboard_layout (jsonb), admin_layout (jsonb), mobile_layout (jsonb), created_at | role CHECKs (`N 0009:21-27`, `S 20260826000000`); legacy `role` re-derived by trigger `sync_legacy_role` (`N 0009:30-46`, `S 20260826000000:26-42`) — legacy column must never be imported, it is recomputed on the destination | **N-only (exclude from bundle):** `password_hash` (`N 0001:27`), `session_version` (`N 0023:4-11`). **S-only (exclude):** `mobile_password_change_started_at` (`S 20260924000000:5`). S `profiles.id` references `auth.users(id) on delete cascade` (`S 20260810160000:29`) — destination identity must exist before profile state; the `on_auth_user_created` trigger enforces the domain whitelist and auto-activate (`S 20260825000000:30-64`) |
| `projects` | id, name (uniq), so_number, telegram_no (unique partial where not null), created_at | unique name; unique telegram_no (`N 0003:13-19`, `S 20260816000000:13-19`) | none |
| `activity_types` | id, name (uniq), is_active, telegram_no (unique partial), created_at | as above (`N 0002`, `S 20260815000000`) | none |
| `timesheets` | id, user_id fk, project_id fk (restrict), activity_type_id fk nullable (set null), log_date (date), hours_worked numeric(4,2), work_done, created_at | CHECK `hours_worked > 0 AND <= 24` (`N 0015:7-9`, `S 20260831000000:7-9`); daily-cap trigger `check_daily_hours_limit` with advisory lock (`N 0011/0015`, `S 20260823000000/20260831000000`); `(user_id, log_date)` uniqueness was dropped — multiple entries/day (`N 0005:8`, `S 20260818000000:8`) | `work_done` unbounded at DB level; the S restore RPC truncates it to 2000 chars (`S 20260914000000:86-88`) — migration export must not imitate that |
| `leaves` | id, user_id fk, leave_date, reason, created_at | UNIQUE `(user_id, leave_date)`; CHECK `char_length(reason) <= 500` NOT VALID (`N 0017:13-16`, `S 20260905010000:18-21`) — pre-existing violations possible on either side | none |
| `reminders` | id, user_id fk, message, remind_at, done, created_at | CHECK `char_length(message) <= 500` NOT VALID (`N 0017:18-21`, `S 20260905010000:23-26`) | none |
| `global_reminders` | id, message, remind_at, created_at | none | none |
| `global_reminder_dismissals` | user_id fk, reminder_id fk (composite pk), dismissed_at | none | none |
| `app_settings` | id=1 singleton, backfill_window_days, backfill_mode (days/month_start), backfill_extra_days, default_dashboard_layout, default_admin_layout, default_mobile_layout, app_name, primary_color, logo_url, updated_at | singleton CHECK id=1; mode CHECK (`N 0001/0002/0010/0019/0020`, `S 20260813000000/20260815000000/20260827000000/20260907000000/20260908000000`) | none |
| `titles` | id (**N: text** `gen_random_uuid()::text` / **S: uuid**), name (uniq), hierarchy_role, created_at | unique name; hierarchy_role CHECK (`N 0014/0021/0022`, `S 20260830000000/20260909000000`) | **PK type differs** — a cross-provider copy is a declared transformation, not a value copy. N-only functional unique index on `lower(name)` (`N 0022:4`) has no S equivalent |
| `whitelisted_domains` | id (**N: text / S: uuid**), domain (uniq), auto_activate, created_at | unique domain | same PK-type difference |
| `audit_logs` | id, actor_id fk nullable (set null), actor_email, action, target_id, detail (jsonb), created_at | none | S insert policy binds `actor_id = auth.uid()` (`S 20260824000000:20-42`) — historical import goes through service role; append-only semantics preserved |

### Internal / operational (excluded from bundle; disposition per category)

| Table | Providers | Disposition |
|---|---|---|
| `mobile_sessions` | both (`N 0017:4-25`, `S 20260904000000`) | Excluded — session safety is C06A/C06B scope; the S table is service-role-only with a password-change insert guard trigger |
| `password_reset_tokens` | N only (`N 0023:13-27`) | Excluded — destination recovery behavior is authoritative |
| `rate_limits` | both (`N 0024:16-33`, `S 20260911000000`) | Excluded (operational state); S access is service-role-only via SECURITY DEFINER RPCs |
| `idempotency_keys` | both (`N 0026:4-15`, `S 20260913010000`) | Operational state — **do not bulk-copy**; semantic mapping is a C06A contract decision |
| `idempotency_effects` | S only (`S 20260920000000:51-85`); N `0031` is an explicit no-op | Provider-specific effect evidence — not interchangeable; C06A decides |
| `migration_runs`, `migration_record_map`, `migration_identity_journal` | Both (`N 0032`, `S 20260930000000`) | Destination-local migration receipts, mappings, and identity-operation evidence; excluded from business-data bundles. C01M may use destination receipts to verify provenance, while C02/C05 must write them with the reviewed merge. Supabase tables have RLS enabled and public/anon/authenticated grants revoked. |
| Migration ledgers | `public.schema_migrations` (created by `db/migrate-runner.mjs:55-62`, not by migration SQL), `supabase_migrations.schema_migrations` | Provider infrastructure — never copied |

### Provider-owned (never copied)

`auth` (Supabase Auth; FK target of `profiles.id`, `auth.uid()` in ~40 policies/functions), `supabase_migrations`, and the app-created `private` schema holding SECURITY DEFINER idempotency trigger helpers (`S 20260920000000:92-95`). `storage`/`realtime`/`extensions`/`vault`/`pgsodium` are unreferenced in both migration trees. External objects (logo files etc.) are deployment-specific; their inventory is a BLOCKED C00 item.

### Provider deltas that shape the later design

1. `profiles.id` = `auth.users.id` on Supabase: native→supabase identity provisioning must create Auth users with preserved or explicitly mapped UUIDs before profile/business rows; supabase→native is a plain copy minus credential columns.
2. `titles.id`/`whitelisted_domains.id` text (N) vs uuid (S): the canonical contract validates UUID-shaped values and accepts both provider storage types; exact provider fingerprints reject unexplained schema drift.
3. No sequences or generated columns exist anywhere; UUID defaults only — no sequence reconciliation is needed.
4. NOT VALID CHECKs (`leaves`, `reminders`) can hide pre-existing violations — the live scan (BLOCKED) must check them before any merge claim.
5. The Supabase SECURITY DEFINER surface (report/restore/idempotency/session RPCs) is recreated by provider migrations, never copied.

## Data inventory (C00 deliverable 4) — BLOCKED

Requires read-only access to both live datasets: row volumes per table, normalized-email collisions, UUID collisions, reference-name conflicts, singleton settings state, orphan references, legacy `role` inconsistencies, NOT-VALID-constraint violations, deleted-actor references, timestamp precision and hierarchy shape. **Not executed in this environment.** No silent cleanup or account linking will be inferred; findings will be recorded here once an operator provides disposable or authorized read-only access.

## Operational inputs (C00 deliverables 5–6) — BLOCKED (operator-supplied)

- Numeric downtime and recovery budgets; bundle retention period; observation window; access windows.
- External-object scope (logo/files), pending mobile writes, SMTP/enrollment readiness, first production direction.
- Recovery destination reservation for the entire merged authority after target writes (including provisioning/reenrollment cost).
- Recoverable backup inventory for source and destination (data + Auth + objects) and the named conflict reviewers.
- Destination-owned rows/identities/configuration that must survive; schema-only bootstrap policy for empty-target tests; same-application-release verification across both deployments.

## Verification evidence (C00)

| Command | Result |
|---|---|
| V0: `rtk proxy git rev-parse HEAD` / `git status --short` / `git diff --stat` / `git diff --check` | HEAD `89d20effa8e2b8e5e0ebeca3e4ff7e1df3ae29a2`; tree clean at start; no whitespace problems; after C00 the only change is this notes file (untracked) |
| V1: `rtk proxy npm test -- tests/backup.test.ts tests/operations-domain.test.ts tests/supabase-restore.test.ts tests/backup-restore-route.test.ts` | **4 files, 38/38 tests passed** — matches the architecture assessment's 38 passes at the recorded revision; no existing failure to attribute |
| Schema inventory | Static read of both `migrations/` trees (matrix above); live catalog inspection BLOCKED |

## Deviations from the plan

None. All C00 deliverables were either completed from repository evidence or recorded as BLOCKED with their required inputs named; no policy was guessed and no deployment was touched.

## Delegation and file ownership

Implementation work is committed per checkpoint; each checkpoint updates this ledger in the same commit. The plan's checkpoint order is respected; C01M (planning semantics) is implemented before any database slice.

## Implementation at checkpoint C01

**Deliverables (all committed on `arch/dual-backend-modular-implementation`):**

| Path | Purpose |
|---|---|
| `lib/migration/format.ts` | Bundle format v1, canonical value contract, entity/column allowlist (12 entities), dependency order, provenance/plan/resolution base schemas, digests. |
| `lib/migration/validation.ts` | Offline bundle validation: symlinks, unknown files, size/row bounds, digests, canonical bytes, primary-key uniqueness, dependency order, provenance. |
| `lib/migration/schema.ts` | Pure catalog model, schema fingerprint, canonical-kind vs live-UDT compatibility. |
| `lib/migration/connections.ts` | Explicit `MIGRATION_*` env resolution, provider allowlist, project-ref extraction, Auth/database binding rules. |
| `lib/migration/journal.ts` | Exclusive run directory/artifacts, append-only JSONL journal, run lock, secret-shaped redaction. |
| `lib/migration/providers/session.ts` | Dedicated read-only PostgreSQL session (`default_transaction_read_only`, statement allowlist, write probe) and stable instance namespace/runtime fingerprint. |
| `lib/migration/providers/native.ts`, `providers/supabase.ts` | Provider consistency guards, instance inspection, Supabase Auth admin read port and Auth↔database read-only consistency proof. |
| `lib/migration/cli.ts`, `scripts/migrate-backend.ts` | `validate`, `inspect`, `preflight` commands; unambiguous exit codes 0/1/2/3/4/5. |
| `tests/migration-format.test.ts`, `tests/migration-cli.test.ts`, `tests/helpers/migration-fixtures.ts` | 53 unit tests over the contract, validator, CLI safety boundary and dry-run guarantees. |
| `tests/boundary-enforcement.test.ts` | Two new rules: application/package/mobile code cannot import migration tooling; migration tooling cannot import server-only sentinels, request-bound auth modules, `lib/db/pool`, Next.js modules or mail senders. |
| `package.json`, `.gitignore` | `npm run migration` (tsx); `/.migration-runs/` ignored. |

**Verification (executed):**

| Command | Result |
|---|---|
| `npx vitest run tests/migration-format.test.ts tests/migration-cli.test.ts` | 53/53 passed. |
| `npx vitest run tests/boundary-enforcement.test.ts` | 12/12 passed (including the two new migration rules). |
| `npm test` | 1386 passed, 56 pre-existing integration tests skipped (no `TEST_DATABASE_URL`/Supabase test env in this shell). |
| `npm run typecheck`, `npm run lint` | Pass, no new warnings. |
| `npm run test:coverage` | Exit 0; aggregate thresholds intact; `lib/migration` at 82.31% lines / 73.44% branches / 85% functions. |
| Live `inspect --source native` against disposable `vsis_migration_native_test` (31 native migrations applied) | Read-only probe rejected a write; namespace `native:7071be336042327a…`; schema fingerprint computed; zero missing tables. |
| Live `inspect --target supabase` against the local Supabase stack | Read-only probe rejected a write; namespace `supabase:3167909b3f99f5e6…`; 65 applied migrations; Auth user list reachable. |
| Live `preflight` (fixture bundle, native source → Supabase target) | bundle/schema/migrations/distinct-instance checks pass; Auth binding reported `blocked` because the local project has no users yet → exit 5 (fail-closed as designed). |

**Decisions / deviations recorded:**

1. CLI command bodies live in `lib/migration/cli.ts`; `scripts/migrate-backend.ts` is a thin entry. The plan listed the script as the composition surface; keeping logic in a module makes the commands testable without spawning processes (same interface, no behavior change).
2. Connection env names must match `^MIGRATION_[A-Z0-9_]+$`. This is stricter than "explicitly named env var" and makes "never falls back to `DATABASE_URL`" mechanically enforceable and testable.
3. Added `lib/migration/schema.ts` and `lib/migration/providers/session.ts` as small shared modules beyond the plan's file list; the plan permits consolidating helpers.
4. Canonical kind for `titles.id` / `whitelisted_domains.id` is `uuid`. The original C01 decision required a declared transformation for native text storage; C02 replaced it with a provider-specific compatibility rule that validates UUID-shaped values and retains exact schema fingerprints.
5. JSONL must be canonical bytes and end with a newline; non-canonical rows and truncation are validation errors (`E_NON_CANONICAL_ROW`, `E_TRUNCATED`).
6. `preflight` exits `BLOCKED` (5) — not pass — when a Supabase target's Auth binding cannot be verified; the plan requires uncertainty to reject before import.
7. A temporary scratch script built the live-preflight fixture bundle; it was deleted after use and is not part of the tree.

## Implementation at checkpoint C01M

**Deliverables:**

| Path | Purpose |
|---|---|
| `lib/migration/matching.ts` | Candidate discovery: prior-provenance confirmation, UUID/email/name/unique-key evidence, collisions, stale aliases. Never links or coalesces automatically. |
| `lib/migration/merge-plan.ts` | Preview generation (create/update/map/retain/exclude/unresolved per record), decision application, ID mapping, expected-merged-state materialization and invariant validation, plan/snapshot digests, staleness check. |
| `lib/migration/resolutions.ts` | Versioned decision-file schema (strict), resolved-plan schema, `resolvePlan`, `verifyResolvedPlan`, decisions template. |
| `lib/migration/providers/read.ts` | Read-only canonical reads of one deployment (entity rows via explicit per-kind casts, account/identity inventory) used by planning and later by export. |
| `lib/migration/cli.ts` | New `plan` (read-only preview + template) and `resolve` (pure, no database) commands. |
| `tests/migration-merge-plan.test.ts` | 38 tests: matching evidence, conflict choices, protected fields, security decisions, settings, expected-result invariants, staleness and tamper detection, repeated-run provenance. |
| `tests/migration-cli.test.ts` | 5 new CLI tests over `plan`/`resolve`, including a proof that `resolve` never opens a database session. |

**Verification (executed):**

| Command | Result |
|---|---|
| `npx vitest run tests/migration-*.test.ts tests/boundary-enforcement.test.ts` | 114/114 passed (format 19, CLI 40, merge-plan 43, boundary 12) after the review round. |
| `npm test` | 1435 passed, 56 pre-existing integration skips. |
| `npm run typecheck`, `npm run lint` | Pass, no warnings. |
| `npm run test:coverage` | Exit 0; `lib/migration` at 86.3% / 76.85% / 89.44% / 87.56%. |
| Boundary rules | Pass (migration modules import no server-only sentinel, request-bound auth module, pool, Next.js module or mail sender; app/script/root code cannot import the tooling). |

**Decisions / deviations recorded:**

1. The plan artifact is self-contained: `snapshot.sourceRows`, `snapshot.targetRows` and the identity inventory are bound into it, so `resolve --plan --decisions --out` is a pure step with **no database access** (tests assert that the session factory is never called) and `apply` can later prove the destination has not drifted via `snapshotDigest`. Plan files are therefore sensitive artifacts and must be protected like bundles.
2. Added `providers/read.ts` and `resolutions.ts` beyond the plan's C01M file list (the plan permits consolidating/adding small helpers); `matching.ts` and `merge-plan.ts` are as proposed.
3. Conflict policy implemented per the plan's conflict table: account and reference candidates are unresolved with allowlisted actions; account/reference candidates allow `map`/`exclude` (`create` is additionally allowed where a separate record can carry a valid unique value, i.e. account-collision, work-data UUID collision and reference rows whose unique key does not actually collide); a previously imported record whose content changed is a review item (`map`/`update`/`exclude`). Supported choices are enforced per conflict, not globally.
4. Destination-only rows are retained; records are never deduplicated by displayed values; absent source rows never imply deletion.
5. Decision files use a `PENDING-REVIEW` placeholder that `resolve` rejects, so a generated template cannot be submitted unreviewed.
6. Protected fields: `id`, `email`, `created_at`, credentials and verification facts cannot be set through field-level decisions; role axes, activation, manager links (`profiles`), `titles.hierarchy_role` and `whitelisted_domains.auto_activate` are reachable only through `security` decisions with a recorded reason. Each security value is validated after materialization.
7. Merged-state invariants cover unique keys (project/activity-type/title names, domain, non-null `telegram_no`, case-insensitive emails, case-insensitive `titles.name` for native's `lower(name)` index), foreign-key closure, manager cycles, role enums, the app_settings singleton, leave uniqueness, hours range and the per-user/day 24-hour cap over the **merged** set. JSON columns are canonicalized when read. Existing destination defects are reported, never auto-repaired.
8. `plan` requires Supabase Auth binding inputs and exits BLOCKED (5) when the binding cannot be verified; `resolve` performs no I/O to any database.
9. `--target-app-version` records the operator-declared target release (default `unverified`), because neither database stores the deployed application version; the plan records source and target migration ledgers and schema fingerprints for review. C00's same-release verification remains an operator task.
10. `expectedResultDigest` is null in a preview that still has unresolved conflicts: no honest expected state exists until they are decided.

**Explicitly not claimed at C01M:** live database merge behavior (constraint triggers, RLS, Auth provisioning), which is the C02 gate; and any production dataset.

### C01M review round (independent read-only review)

A read-only review agent compared the implementation with the C01/C01M plan sections. Findings and resolutions:

| Severity | Finding | Resolution |
|---|---|---|
| P1 | The read layer selected jsonb as `col::text` and `canonicalizeRow` demanded byte-canonical JSON, so `plan` threw on any populated destination (PostgreSQL prints `{"a": 1}`). | `providers/read.ts` now canonicalizes json columns on read (`canonicalizeJsonColumns`) while preserving numeric literals. New CLI test + live proof against the disposable database: PostgreSQL returned `{"a": [1, 2, 3], "b": 2}`, the reader produced `{"a":[1,2,3],"b":2}` (probe row deleted afterwards). |
| P2 | `resolvePlan` trusted `plan.unresolved`: a plan whose conflict list was emptied (digest recomputed) resolved silently. | `applyDecisions` now raises `E_CONFLICT_MISSING` for any entry still marked unresolved without a recorded conflict; covered by a new test. |
| P2 | Merged-state validation missed the `telegram_no` partial unique indexes. | `validateMergedState` now rejects duplicate non-null `telegram_no` on `projects` and `activity_types`; covered by a new test. |
| P2 | Staleness ignored schema and application-version drift (a migration applied to the same server left the snapshot digest unchanged). | `assertPlanFresh` now also compares the live schema fingerprint and, when known, the declared application version; covered by a new test. |
| P3 | Reference-row conflicts could not use the plan's "create separately" choice. | `reference-candidate` now allows `create`; merged-state validation rejects it when the unique value actually collides. New test. |
| P3 | Extra `app_settings` rows produced an unsatisfiable conflict (no entry to decide). | The extra rows now carry their own `exclude` entries; new test proves such a plan resolves. |
| P3 | `--operator` was read by `plan` but not accepted by the flag parser. | `operator` added to the accepted flags. |
| P3 | The read-only statement allowlist accepted `with … insert` / `explain analyze insert`. | Guard now also rejects DML/DDL keywords outside string literals (defense in depth; the session is still `default_transaction_read_only`). |
| P3 | Static boundary scan did not cover `scripts/**` or root modules. | The scan now includes every script except the CLI entry point and all root `*.ts/*.mts` modules. Known limitation recorded: a runtime-composed import specifier cannot be detected by static scanning. |

After the fixes: `npm test` 1435 passed / 56 pre-existing skips, typecheck and lint clean, coverage exit 0 with `lib/migration` at 86.3% / 76.85% / 89.44% / 87.56%.

### C01 remediation round (independent C01 review remediation)

An independent review of C01 found six gaps; all have been implemented, tested, and verified:

| Severity | Finding | Resolution |
|---|---|---|
| P1 | Release and schema compatibility were not enforced: preflight and plan accepted any nonempty migration ledger without checking application releases or comparing live schema fingerprints to supported fingerprints. | Added `CURRENT_APPLICATION_RELEASE` ('1.0.3'), `computeCanonicalSchemaFingerprint`, and `REQUIRED_MIGRATIONS` milestone checks to `lib/migration/schema.ts`. `preflight` and `plan` now verify `isSupportedApplicationRelease`, `isSupportedSchemaFingerprint`, and `checkMigrationLedger` against target, source, and bundle manifests, returning `E_RELEASE_MISMATCH` / `E_RELEASE_UNSUPPORTED` / `E_SCHEMA_UNSUPPORTED` / `E_LEDGER_INCOMPLETE`. |
| P1 | Timestamp offsets were discarded: `canonicalizeTimestampText` converted timestamps with non-UTC offsets (e.g. `+05:30`) to `...Z` without shifting hours/minutes, mutating instants by the offset amount. | Rewrote `canonicalizeTimestampText` in `lib/migration/format.ts` to parse UTC offsets (`+HH:MM`, `-HH:MM`, `+HHMM`, `+HH`, `Z`), compute exact UTC milliseconds via `Date.UTC`, preserve all 6 microsecond digits, and format ISO-8601 UTC strings (`...Z`). Covered by 8 dedicated unit tests. |
| P2 | Declared transformations waived schema type mismatches without verifying that a supported transformation exists. | Added `isSupportedTransformation` (format v1 defines identical schemas across backends, returning false). `checkEntitySchemaCompatibility` now reports `E_SCHEMA_UNSUPPORTED_TRANSFORMATION` when a transformation is declared for an unsupported entity/column and only waives `E_SCHEMA_TYPE_MISMATCH` if a supported transformation exists. |
| P2 | Row limit was checked only after buffer concatenation: streaming in `validateEntityFile` concatenated incoming chunks into `remainder` before checking `BUNDLE_LIMITS.rowBytes` (4 MB), risking unbounded memory consumption on malformed lines. | Enforced `remainder.length + slice.length > BUNDLE_LIMITS.rowBytes` *before* buffer concatenation, immediately recording `E_ROW_TOO_LARGE` and discarding chunk accumulation until the next newline. Covered by unit test. |
| P2 | Native server fallback namespace collision: when `pg_control_system()` probe failed, the fallback namespace used `[provider, projectRef, database, 'no-system-identifier']`, causing distinct native servers on the same database name to collide. | Extracted `computeDatabaseNamespace` in `lib/migration/providers/session.ts` to incorporate `target.loopback ? loopback:${port}/${db} : target.displayTarget` when system identifier probe is unavailable, isolating distinct native hosts. Covered by unit test. |
| P3 | Null manifest input threw `TypeError`: `JSON.parse("null")` produced `null`, leading to a crash when accessing `manifest.format`. | Guarded `parsedManifest === null || typeof parsedManifest !== 'object' || Array.isArray(parsedManifest)` to report `E_MANIFEST_SCHEMA`. Covered by unit test. |

After the remediation: `npm test` 1443 passed / 56 pre-existing skips (100% passing), typecheck and lint clean, both Supabase and native builds verified, coverage exit 0 with `lib/migration` at 86.28% / 77.41% / 91.07% / 87.6%.


## Implementation at checkpoint C02

**Deliverables:**

| Path | Purpose |
|---|---|
| `db/migrations/0032_migration_receipts.sql`, `supabase/migrations/20260930000000_migration_receipts.sql` | Destination-local `migration_runs` (receipt), `migration_record_map` (provenance) and `migration_identity_journal`; RLS enabled and all PostgREST roles revoked on the Supabase side. Additive to both migration tracks; never part of a bundle. |
| `lib/migration/export.ts` | Read-only exporter: one repeatable-read snapshot, canonical rows via the shared reader, exclusive file writes, manifest/provenance digests, and re-exported provenance expressed from the exporting instance's perspective. |
| `lib/migration/identity.ts` | Supabase Auth provisioning/adoption, immediate per-identity journaling in its own transaction, lost-response reconciliation by planned id, and cleanup restricted to journal-proven run-created identities. No password, hash, token or verification state ever crosses this boundary. |
| `lib/migration/import.ts` | Single destination app-data transaction: provisioning drift allowance, row creates/updates with per-kind casts, reference rewriting through the reviewed id map, mapping + receipt writes, and in-transaction reconciliation against the expected result before commit. Repeat runs with identical digests are a no-op; a reused run id with different digests is refused. |
| `lib/migration/providers/supabase.ts` | Auth admin port extended with `findUserByEmail`, `createUser` (id-preserving) and `deleteUser`; deliberately no generic update path. |
| `lib/migration/providers/session.ts` | `openWriteSession` for the destination only: writes confined to one `transaction()`, prior-value guard on updates, and a statement guard that rejects data-changing statements outside the transaction. |
| `lib/migration/cli.ts` | New `export`, `apply` and `verify` commands with the recorded plan digest, run id and exit codes. Final writer fences are C06B scope. |
| `tests/migration-roundtrip.int.test.ts` | The live V4 slice (see below), including destination enrollment and the late-transaction rollback proof. The enrollment step was added during review and still needs a live rerun. |
| `tests/migration-identity.test.ts`, `tests/migration-import-safety.test.ts` | Recovery regressions for uncertain Auth creation, cleanup ownership, and lost SQL commit responses. |

**Live evidence (executed against disposable services):**

| Case | Result |
|---|---|
| native source → populated Supabase target | Exported 64 rows; plan surfaced the expected account-candidate, reference-candidate and uuid-collision review items; apply committed in one transaction; verify reconciled every entity. |
| Destination-only protection | The destination's project, timesheet and account (id, email, password) survive; the row that owned the colliding UUID is untouched while the incoming record got an allocated id. |
| Credential continuity / enrollment | The seeded account still signs in with its original password after the merge; the new account signs in with no password (fails) and is reachable under the planned id, so it must enroll on the destination. |
| Repeat run | Second `apply` of the same run/digests returned `no-op` and wrote nothing. |
| Later source change | A new source timesheet planned against the same destination maps the previously imported rows through destination receipts (no duplicates) and creates only the new record. |
| Reverse / provenance | Supabase export carried 64 verified aliases; planning back into the native instance surfaced them as reviewed mappings (never automatic), and the reviewed resolution reused every pre-existing native row without recreating anything. |
| Empty-target apply | A second plan against the empty native target was reviewed and applied: reference rows bootstrapped by both providers were mapped after review, work rows were created, and **no credential was fabricated** (`password_hash` count 0). |
| Late-transaction rollback | Injecting a failure at the receipt insert (last statement) rolled back every row change and mapping: no receipt, no mappings, and the adopted account was left untouched. |
| Fail-closed gating | The suite skips with the missing-variable names by default and fails the run when `MIGRATION_TEST_REQUIRE=1`; hosts must be loopback (unless `MIGRATION_TEST_ALLOW_REMOTE=1`) and native database names must match the disposable allowlist. |

Commands: `npx vitest run tests/migration-roundtrip.int.test.ts --no-file-parallelism` with `MIGRATION_TEST_NATIVE_ADMIN_URL`, `MIGRATION_TEST_NATIVE_SOURCE_URL`, `MIGRATION_TEST_NATIVE_TARGET_URL`, `MIGRATION_TEST_SUPABASE_DB_URL`, `MIGRATION_TEST_SUPABASE_AUTH_URL`, `MIGRATION_TEST_SUPABASE_SERVICE_KEY`, `MIGRATION_TEST_SUPABASE_ANON_KEY`, `MIGRATION_TEST_REQUIRE=1`. The suite creates and drops its own disposable databases and removes its own rows/accounts (use `MIGRATION_TEST_KEEP=1` to inspect).

**Decisions / deviations recorded:**

1. Mappings are written under the **import receipt's** run id, not the planning run id: the destination's provenance reader joins map rows to their receipt, so a planning run id would silently break every later reverse/repeat migration. Found by the live slice.
2. Supabase Auth provisioning and the SQL merge are separate transactions, so provider-side effects are journaled immediately; the merge tolerates exactly those journaled profile rows (and their identities) as drift and abandons the run on anything else.
3. New Supabase accounts are created with `email_confirm: false` and no password. A source-side verification fact is recorded for review, never applied; enrollment happens through the destination provider. The seeded known-password account in the test is created with the provider SDK directly, because the migration port deliberately has no password path.
4. `apply` refuses a plan whose reviewed destination namespace differs from the connection, and refuses a reused run id with different digests.
5. The native `titles.id` / `whitelisted_domains.id` text-vs-uuid delta is now accepted for either source provider (the row contract still validates UUID form and the importer casts per live column type); the integer-id path gained an explicit guard instead of producing `NaN` for an invalid allocation.
6. Bundle provenance alone is not sufficient for an automatic mapping: without a destination receipt it is a review item (`untrusted-provenance`). This is stricter than "re-exported provenance maps", so the reverse leg was verified as *reviewed* mapping that still recreates nothing.
7. The late-transaction rollback proof lives in the same live file rather than a separate `tests/migration-recovery.int.test.ts` (harness reuse); the failure is injected by the test's own write-session wrapper, so no test-only hook exists in production code.
8. Verification compares the committed destination against the resolved plan's per-entity digests and checks that the run's receipt exists; the fuller reconciliation matrix belongs to C05.
9. Coverage note: `lib/migration` drops to ~73% lines in the unit-only run because export/import/identity are exercised by the live suite, which skips without the disposable services. The aggregate coverage gate still passes.

**Explicitly not claimed at C02:** fencing/retry policy (C06A/C06B), the full entity matrix and streaming diagnostics (C03), complete identity/verification handling (C04), strict reconciliation and durable recovery (C05), and any production dataset. No bulk email was sent and no production system was contacted.

### 2026-09-19 completed-checkpoint review addendum

- C01: bundle rows are rehashed when loaded after offline validation; the planning destination snapshot now reads rows, identities, and receipts in one repeatable-read transaction. Provider-specific schema fingerprints and the receipt migrations are checked. The current shell has no migration connection variables or local database CLI, so it cannot independently repeat the disposable inspection.
- C01M: bundle aliases are advisory; only destination-owned receipts joined to a committed run confirm mappings. The `publication-intent` state now retains that trust after cutover begins. Resolution rejects a second timesheet for the same user/date even when total hours are under 24, matching the database unique index. Two invalid test fixtures were corrected.
- C02: lost Auth creation responses now require the exact planned UUID, email, and `vsis_migration_run_id` Auth metadata before journaling the identity as run-created. Cleanup rechecks the marker and refuses any run with a durable receipt. An uncertain SQL commit now reads the durable receipt before any Auth cleanup; unreadable receipt state blocks cleanup, and a matching committed receipt is reconciled. Apply reads only receipts for the planned source namespace so unrelated sources do not invalidate a plan, while a new same-source mapping does. A `failed` receipt cannot return a completed no-op. These fixes require a fresh disposable live run.
- Current local checks: focused migration/boundary suite 155 passed; full unit suite 1485 passed with 62 integration skips; coverage, typecheck, lint, and both backend builds passed. The Supabase build used the explicit compile-only Auth gate bypass because no live Auth credentials are available in this shell. The expanded recovery unit suite passes 9/9. The six-case C02 live result above predates these recovery changes.
- Remaining C02 PASS evidence: rerun the extended V4 disposable suite with `MIGRATION_TEST_REQUIRE=1` against migrated native and Supabase test services. It now exercises destination enrollment with an admin-generated recovery link after proving that the migration set no password. This tests provider credential setup without sending mail; SMTP readiness remains a separate C00 input. No production connection is needed.
- Concurrency boundary for C06B: the C02 cleanup receipt check and Auth deletion are separate operations. A concurrent apply could commit between them without destination-wide fencing/locking. The C02 disposable slice does not establish concurrent-run safety; C06B must prove the destination lock and writer fences before any production use.

## Implementation at checkpoint C03

**Deliverables:**

| Path | Purpose |
|---|---|
| `lib/migration/export.ts` | Rewritten to stream: one repeatable-read, read-only transaction per export with the snapshot id (`txid_current_snapshot()`) recorded in the manifest; per-entity files written through a write stream with exclusive creation and the manifest written last; bytes/counts/digests computed while writing; `E_EXPORT_INTERRUPTED` wraps any mid-stream failure so a partial directory is never importable. |
| `lib/migration/providers/read.ts` | `readEntityBatch`: keyset-paginated canonical reads ordered by primary key, comparing UUID-shaped keys as text so the order is total and stable on both providers (native `text` vs Supabase `uuid`). |
| `lib/migration/schema.ts` | `EXCLUDED_LIVE_COLUMNS` exported so the exporter's drift diagnostics reuse the single source of truth for provider-internal columns. |
| `lib/migration/cli.ts` | `export` reports per-entity batches and the diagnostics block, and journals them with the bundle digest. |
| `tests/migration-export.test.ts`, `tests/migration-export.int.test.ts` | Offline pagination/digest/interruption coverage plus the live V4 volume, value, snapshot-isolation, interruption and diagnostics matrix. |

**Diagnostics contract:** the export never rewrites source records to fit. It reports, instead, the deployed tables outside the canonical matrix, deployed columns the bundle does not carry, canonical columns the deployment lacks, provider storage deltas that are value-compatible (e.g. `titles.id:text` on native), and entities with zero rows. Provider-internal columns (`profiles.role`, `password_hash`, `session_version`, `mobile_password_change_started_at`) are understood, not drift.

**Live evidence:** `npx vitest run tests/migration-export.int.test.ts --no-file-parallelism` with `MIGRATION_TEST_NATIVE_ADMIN_URL`, `MIGRATION_TEST_NATIVE_SOURCE_URL` (disposable `vsis_migration_c03_*`), `MIGRATION_TEST_REQUIRE=1` — 6/6. The suite creates, seeds (1,001 projects, 60 users × 87 days = 5,224 timesheets, boundary and special-character rows), exports, validates and drops its disposable database.

**Decisions / deviations recorded:**

1. Pagination compares UUID-shaped primary keys as text rather than by the column's own type. UUID string ordering differs from `uuid` ordering, but it is total, stable, provider-independent and therefore sufficient for keyset pagination; the exported order is not part of the bundle contract (rows are digested as a set per entity).
2. Diagnostics are reported in the CLI result and the run journal rather than inside the bundle: an extra file in a bundle directory would be rejected by the validator's allowlist.
3. Interruption is simulated in tests by injecting a failing query through a session wrapper; no test-only hook exists in production code.
4. The manifest's `snapshot.transactionId` records the PostgreSQL snapshot id, giving an operator a way to reason about when the exported state existed without adding a new format version.

### C03 review addendum (2026-09-19)

- The committed C03 exporter read catalog/ledger metadata before its row transaction and provenance afterward. A concurrent import could therefore put a post-snapshot mapping into a bundle containing pre-import rows. The worktree fix reads metadata, rows, and committed-receipt-backed provenance in one repeatable-read transaction. A transaction-scoped `to_regclass` probe distinguishes a missing mapping table from a table the source role cannot read.
- The committed provenance read loaded all mappings and serialized one JSON string in memory, with no export-side enforcement of the validator's 64 MiB limit. The worktree fix keyset-pages mapping rows, writes JSON incrementally, and fails before the manifest if the size limit is exceeded. The CLI now consumes the streamed alias count.
- Entity file streams now retain an error listener while the next database batch is in flight. A failed rollback after a lost connection no longer replaces the original export interruption error. Diagnostics now count source rows that violate the known shared destination checks for leave reason, reminder message, and timesheet hours without rewriting those values.
- Focused offline exporter/CLI/session tests pass 71/71, including new provenance pagination, interruption, and incompatible-value cases. The final full coverage run passed 1,496 tests with 68 skips and met aggregate thresholds; typecheck, lint, and diff checks pass. The earlier C03 live 6/6 result predates these fixes; the live suite skips in the fix author's shell because `MIGRATION_TEST_NATIVE_ADMIN_URL` and `MIGRATION_TEST_NATIVE_SOURCE_URL` are unavailable. The rerun was executed later on `ef06a23` (see "Independent verification of the landed slice").
- **Remaining PASS gates:** the rerun executed on `ef06a23` (`MIGRATION_TEST_REQUIRE=1`, 6/6), including the suite's independent source counts and order-insensitive canonical digests for every entity. Record the C06A operational-state/session/retry contract required by the implementation plan before finalizing the exporter. Target-specific value compatibility still needs destination preflight, and approved Auth metadata coverage must be reconciled with C04 rather than silently claimed by the exporter.

### Implementation review round — 2026-09-19 (post-C03 read-only review + fixes)

An independent read-only review compared the committed C01–C03 implementation with the plan and confirmed two executable planner defects, one ledger-accuracy problem and several contract gaps. All code findings below are fixed in this worktree with tests; the ledger corrections are applied to this file.

| Severity | Finding | Resolution in this worktree |
|---|---|---|
| P1 | `E_TIMESHEET_DUPLICATE_DAY` rejected any second timesheet for one user/day, but `db/migrations/0005` dropped that unique index and the plan requires equal-looking timesheets to stay separate. | Removed the false invariant; only the 24-hour cap over the merged set is enforced. The old test asserted the wrong behavior and now proves the opposite (two rows kept, plan resolves). |
| P1 | Two distinct source records could be mapped onto one destination row (silent coalescing) — preview allowed duplicate proposals, decisions never checked destination claims, materialize had no backstop. | Destination-claim uniqueness at three levels: preview emits a `destination-claimed` conflict (exclude-only) for the second contender; decision application rejects a second map/update onto a claimed row (`E_DESTINATION_CLAIMED`) and requires a recorded reason for retargeting; materialize re-checks the final id map. Coalescing is expressed only by mapping one record and excluding the other with a reason. |
| Ledger | The C02 status row claimed the live rerun covered the Auth run-marker and durable-receipt recovery paths; both exist only behind unit mocks. | Status row corrected: core slice live-proven, the two recovery paths explicitly marked mock-only with a live rerun as remaining evidence. |
| Dependency | C03 was marked PASS while its declared C06A dependency had not started. | Already corrected in this worktree (C03 BLOCKED pending live rerun + C06A); kept consistent here. |
| P2 | Case-insensitive `titles.name` uniqueness was enforced for both providers although only native has the `lower(name)` index. | `validateMergedState` now takes the destination provider and enforces the case-insensitive check for native only; covered by both-provider tests. |
| P2 | `apply` never compared the application release bound into the plan. | `applyResolvedPlan` now requires the operator-declared release (CLI `--target-app-version`, defaulting to the running tool's `CURRENT_APPLICATION_RELEASE`) to equal `plan.target.applicationVersion`, else `E_RELEASE_MISMATCH`. Covered by unit tests. |
| P2 | Decimal aggregation used lossy JavaScript numbers (plan §3 forbids it). | `addDecimal` and the hours/cap math now use exact BigInt fixed-point arithmetic; values beyond the supported scale fail closed (`E_VALUE_INVALID`). `tsconfig` target moved ES2017 → ES2020 for BigInt literals (type-check only; Next builds are unaffected). Covered by a precision test. |
| P2 | Rollback proof asserted only receipts/mappings, not the app-data rows. | The live rollback case now captures per-entity row counts before the failing apply and asserts every entity is unchanged after rollback. |
| P2 | `E_TARGET_MISMATCH`, stale-plan-before-provisioning and release enforcement had no tests. | New unit cases: wrong destination namespace fails before any transaction; a drifted baseline fails `E_STALE_PLAN` with zero Auth calls and zero transactions; release mismatch/enforcement covered. |
| P2 | Schema-matrix tests were self-referential (fingerprint derived from the same spec the tests build). | New `tests/migration-schema-matrix.test.ts` parses both migration trees and asserts every live column is contracted-or-excluded and every contract column exists on both providers. |
| P3 | Error-cap overflow produced misleading secondary count/size/digest failures; `migration_*` tables were silently exempt from drift diagnostics by prefix; statement limits were invisible in the export result; `readReceipt` used `select *`; the Supabase test database had no remote-host guard. | Cross-checks are skipped once the collector overflows; diagnostics exempt exactly the three receipt tables; `ExportResult.statementLimits` (from `SESSION_STATEMENT_LIMITS`) is surfaced in the CLI result; receipt reads use explicit columns; `MIGRATION_TEST_ALLOW_REMOTE_SUPABASE=1` is now required to run the Supabase target against a remote host. |
| Accepted (no change) | Supabase ledger prefix tolerance accepts a same-timestamp different-suffix migration; `app_settings` re-surfaces as a conflict on repeat runs unless unchanged. | Timestamps are the unique migration key so the prefix branch only tolerates suffixed fixtures; the unchanged singleton now carries over as a proposed map, and a *changed* singleton stays a reviewed conflict (fail-closed by design). |

After the fixes: focused migration suites and the boundary/mobile-guard/supabase-migrations suites pass; typecheck and lint are clean; the live suites still require the disposable services (skipped in the fix author's shell; the second reviewer executed them live on `ef06a23`, see below). The plan artifacts and digests are unaffected by these changes only for freshly generated plans; previously saved preview artifacts must be regenerated.

### Independent verification of the landed slice (second reviewer)

The review slice above was verified on the settled tree, and the live gates were executed rather than skipped:

| Finding | Resolution |
|---|---|
| `npm run typecheck` failed with two errors in `tests/migration-merge-plan.test.ts` (an `ExpectedResult` cast and a possibly-null `resolvedPlan`); the unit suite hid them because vitest does not typecheck. | Fixed in the test (cast through `unknown`; explicit null narrowing). |
| **`plan` produced a plan that `resolve` rejected** (`E_PLAN_SCHEMA`): the new `destination-claimed` kind existed in `ConflictKind`/`conflictActions` but was missing from the resolution JSON schema's enum. In-process unit tests cannot see this; the live CLI round trip does. | Added `destination-claimed` to `unresolvedConflictSchema` in `resolutions.ts`. |
| The reverse live leg assumed every conflict allows `map`, while `destination-claimed` deliberately allows only `exclude`. | The live test now maps when allowed and otherwise takes the first allowed action, recording a reason either way. |

After the fixes, on revision `ef06a23`: typecheck and lint clean, unit suite 1512 passed / 68 skipped, live round-trip 6/6 and live export 6/6 against the disposable native databases and the local Supabase stack. The live round-trip suite drives five `plan` invocations, each with an explicit `--target-app-version` (populated Supabase target, later-source-change plan, reverse leg, empty native target, rollback proof).

### Follow-up remediation round — 2026-09-19 (verification findings)

A read-only verification of the section above reproduced the local suites (1,512 passed / 68 skipped; typecheck and lint clean) and raised five findings. All are resolved in this worktree:

| Severity | Finding | Resolution |
|---|---|---|
| P1 | `session.identity()` ran inside the exporter's repeatable-read transaction; a restricted source role cannot execute `pg_control_system()`, and PostgreSQL leaves the transaction aborted after the permission error, so the following catalog queries failed with `25P02`. | Both sessions now probe under a transaction-scoped savepoint (`vsis_system_identifier_probe`) and roll back to it on failure, so the snapshot survives a denied probe. The read session is covered by `tests/migration-session.test.ts` (denied probe inside and outside a transaction). |
| P1 | The exporter tracked entity bytes but never enforced the validator's 4 MiB row / 8 GiB entity limits, so oversized source data produced a manifest that validation then rejected. | `streamEntity` fails closed with `E_ROW_TOO_LARGE` / `E_ENTITY_TOO_LARGE` before the manifest is written; the provenance cap keeps its own `E_PROVENANCE_TOO_LARGE` code instead of being wrapped as an interruption. `ExportRequest.limits` lets tests exercise the bounds. Covered by `tests/migration-export.test.ts`. |
| P2 | This ledger was internally inconsistent: it claimed the revised live export passed while marking the rerun pending, called the committed fixes "uncommitted", pinned no revision, and omitted the C03 plan dependency on approved Auth metadata coverage. | Corrected here: evidence is pinned to `ef06a23`; the status row, remaining-work item and outcome statement now agree that the live rerun executed on that revision and that C03 stays BLOCKED on C06A plus approved Auth metadata coverage. |
| P3 | The proposed conflict-kind schema test could not have caught the reported regression (`destination-claimed` missing from the resolution schema): the schema was private and the test listed kinds manually. | `CONFLICT_KINDS` in `lib/migration/merge-plan.ts` is now the single source for `ConflictKind` and the resolution schema enum, with an `Exclude`-based assertion plus per-kind parse coverage in `tests/migration-merge-plan.test.ts`. |
| P3 | Verification text stated four `plan` invocations in the live round-trip suite; the suite contains five, each with `--target-app-version`. | Corrected above (five: populated Supabase target, later-source-change plan, reverse leg, empty native target, rollback proof). |

The two exporter fixes land after `ef06a23`, so the live 6/6 evidence above does not cover them; their evidence is the focused offline suites only, and a live rerun is still expected with the eventual C03 PASS once C06A and approved Auth metadata coverage are settled. A rerun on the current revision (with the restricted-role `25P02` and row/entity-limit fixes in the tree) passed `tests/migration-export.int.test.ts` 6/6 and `tests/migration-roundtrip.int.test.ts` 6/6, so the follow-up changes are live-verified even though the checkpoint's PASS still depends on C06A.

## Implementation at checkpoint C04

**Deliverables:**

| Path | Purpose |
|---|---|
| `lib/migration/identities.ts` (new) | Pure identity-disposition module. One disposition per source account (`mapped`, `provision`, `historical`, `excluded`), per-account enrolment status, the ids that may be handed to the Auth provider, and the blockers that must stop an apply. |
| `lib/migration/import.ts` | `apply` now runs the disposition before any provider call and fails on any blocker; provisioning is filtered through the disposition's `provisionIds`, so a historical reference or an excluded account can never reach the provider; the reviewed source verification fact is carried for review instead of being dropped; the result records the disposition/enrolment summary. |
| `lib/migration/providers/read.ts` | Supabase identity inventory now also reads the sign-in providers attached to each account (aggregated from `auth.identities`) so an OAuth-only source account is visible to review. |
| `lib/migration/resolutions.ts` | The plan-snapshot schema accepts the optional `providerIdentities` fact (older plans simply lack it). |
| `lib/migration/cli.ts` | `apply --json` surfaces `identityDispositions`. |
| `tests/migration-identities.test.ts` (new) | 9 tests: dispositions and enrolment separation, inactive/administrator/unverified accounts, historical deleted actors, undisposed accounts, exclusions with and without dependents, missing email, incomplete mapping, OAuth-only blockers, and matched accounts that keep their identity. |

**What the blockers are:**

1. `E_IDENTITY_UNDISPOSED` — a source account, or an account referenced by imported rows, has no reviewed map/create/exclude decision.
2. `E_EXCLUDED_WITH_DEPENDENTS` — an excluded account is still referenced by rows this run imports; the exclusion cannot stand until its dependents are resolved.
3. `E_IDENTITY_UNMAPPED` / `E_IDENTITY_NO_EMAIL` — a mapping without a destination identity, or a new account that could not enroll.
4. `E_IDENTITY_UNSUPPORTED_PROVIDER` — the account signs in through a provider other than email; creating a password account would downgrade its assurance, so it needs an explicit reenrollment decision or an exclusion.
5. `E_HISTORICAL_PROVISIONED` — defense in depth: an id with no source account must never appear in the provisioning list.

**Enrolment is recorded separately from the data import:** `existing-account` (a matched account keeps the destination credential), `enroll-on-destination` (a new account enrolls through the provider; nothing is transferred), `not-an-account` (historical reference — never a login). The apply result and journal carry the counts, the provisioned ids and the historical ids. The status string avoids the word "credential" because the run output's redaction rules correctly mask such keys; naming it `existing-account` keeps the fact readable without weakening redaction.

**Live evidence (this revision):** `tests/migration-roundtrip.int.test.ts` 6/6 (disposition summary `mapped: 1, provision: 1, historical: 0`, `existing-account: 1`, `enroll-on-destination: 1`, provisioned exactly the approved new account; the matched account still signs in with its original destination password before and after the merge; the new account cannot sign in with any guess and enrolls through a provider-issued recovery link), `tests/migration-export.int.test.ts` 6/6, unit suite 1526 passed / 68 skipped, typecheck and lint clean.

**Remaining C04 scope (not claimed above):**

1. **The deleted-actor path is unit-covered, not live.** The schema makes a stale live reference impossible today: `audit_logs.actor_id` is `references public.profiles(id) on delete set null`, and every other profile reference is `not null`, so a reference to a nonexistent profile cannot be inserted. The rule still matters for a deployment or bundle where that constraint was absent, which is what the unit test covers.
2. **Domain-whitelist behavior is asserted, not exercised end to end**: the live suite proves the whitelisted domain row survives the merge with `auto_activate = false` and that the reviewed active state is applied, but it does not run a signup through the application's own gate. That gate is covered by `tests/supabase-live-registration.int.test.ts` (4/4 on this revision).
3. **Second-factor *enrollment* is not executed**, only detected: an account with `auth.mfa_factors` rows now blocks provisioning (`E_IDENTITY_MFA_UNSUPPORTED`), but no test enrolls a factor and re-runs the migration.

**Verification performed for this checkpoint (this revision):**

- `tests/migration-identities.test.ts` 10/10 (dispositions, enrolment separation, inactive/administrator/unverified accounts, historical references, undisposed accounts, exclusions with/without dependents, missing email, OAuth-only blocker, second-factor blocker, matched-account update).
- `tests/migration-roundtrip.int.test.ts` 6/6 (disposition/enrolment summary; matched account signs in with its original destination password before and after the merge; new account cannot sign in with a guessed password and enrolls through a provider-issued recovery link; destination `sync_legacy_role` trigger keeps `role` consistent with the permission/hierarchy axes for both imported profiles; whitelisted domain row survives with `auto_activate = false`).
- Backward compatibility: `tests/supabase-live-registration.int.test.ts` 4/4 (signup gate), `tests/supabase-live-rls.int.test.ts` + `tests/supabase-live-recovery.int.test.ts` 13/13 (RLS and recovery), and the native auth flows through the unit suite.
- Repository: typecheck and lint clean; unit suite 1527 passed / 68 skipped; `tests/migration-export.int.test.ts` 6/6.

## Remaining work / next eligible checkpoint

State after C03:

1. **C01, C01M and C02 are PASS. C03 is BLOCKED** on its implementation-plan dependencies: C06A and approved Auth metadata coverage are not settled. The revised exporter's live rerun and the extended live round-trip both passed 6/6 on `ef06a23`; this remediation round's follow-up fixes are covered by offline suites only.
2. **Next eligible checkpoint:** C04 (identity/profile completeness) — depends only on C02, which passes. C05 follows a renewed C03 PASS, C04 and C06A.
3. **C06A** (retry/session/recovery policy) remains a design gate that needs the BLOCKED C00 operational inputs (writer/retry inventory: pending mobile writes, SMTP/enrollment readiness, observation window). The concurrency boundary recorded in the C02 addendum (cleanup receipt check vs Auth deletion are not one operation) is explicitly C06B scope.
4. **C06B, C07, C08** remain NOT STARTED. C09/C10 require explicit production authorization and are not requested.
5. Operator inputs still outstanding from C00: data volumes, numeric downtime/recovery budgets, backup inventory, external-object scope, pending mobile writes, SMTP/enrollment readiness, first production direction, reserved recovery destination.
6. Disposable resources used by the live gates: `vsis_migration_c02_source` / `vsis_migration_c02_target` (created and dropped by the round-trip suite), `vsis_migration_c03_export` (created and dropped by the export suite), the long-lived `vsis_migration_native_test` from C01, and the local Supabase stack. Each suite removes its own rows, receipts, mappings and accounts.

**Outcome statement:** migration tooling through C03 is implemented and committed (`3964600`, `193582f`, `ef06a23`). C02 retains its live two-direction evidence; the revised exporter's live matrix and the extended live round-trip both passed 6/6 on `ef06a23`, and the follow-up remediation round's exporter/session fixes are covered by offline suites on top of that revision. C03's PASS claim stays suspended until C06A and approved Auth metadata coverage are settled. No production system has been contacted, no bulk email was sent, no credential was transferred, and no source dataset has been retired.
