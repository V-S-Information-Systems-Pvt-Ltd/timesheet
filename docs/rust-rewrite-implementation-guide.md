# Rust Rewrite Implementation Guide — VSIS Timesheet

Status: worker execution guide derived from the [rewrite proposal](plans/RUST_REWRITE_PLAN.md). Prepared on 2026-10-07 against commit `0fc5f63f03116a3b79153fddbe0ac055001af076`.

This document specifies implementation work; creating it does not start the rewrite, change a deployment, retire Supabase, or authorize destructive operations. Statements such as “locked” and “choose yourself” in the source proposal describe that proposal's assumptions. The current user request is to prepare this guide. A later implementation assignment should name the work package being authorized.

The intended destination remains the proposal's: native PostgreSQL, Rust/Axum, server-rendered Maud HTML with htmx, one deployed application binary, and the existing React Native client. Compatibility corrections below are required to reach that destination while preserving current behavior.

## 1. How the worker should use this guide

1. Read the repository `AGENTS.md`, RTK instructions, and the current worktree diff. Activate Serena and read its manual if not already done.
2. Start with W00. Revalidate this guide's baseline against the current source; counts and paths are navigation aids, not permanent contracts.
3. Complete one assigned package at a time, including its failure cases and exit gate. Keep one write-capable implementation owner; use bounded read-only investigation when needed.
4. Read current source and tests before porting behavior. Preserve unrelated user changes. Do not delete the existing app while building replacement slices.
5. Report changed files, tested revision, passed/failed/skipped checks, unresolved findings, and the next package that is ready. A skipped correctness-critical integration test prevents deployment qualification even if local implementation can continue.

The default sequence is W00 → W01 → W02 → W03 → W04 → W05 → W06 → W07 → W08 → W09 → W10 → W11 → W12 → W13 → W14. W15 is optional and separately scoped. Independent read-only investigation and fixture preparation may overlap; implementation ownership remains explicit.

| Proposal phase | Worker packages | Completion evidence |
| --- | --- | --- |
| P0, optional Supabase retirement | W15 | Native destination and deployed-consumer evidence; separate retirement decision |
| P1, foundation | W00–W03 | Buildable workspace, compatible migrations, native domain/concurrency tests |
| P2, authentication | W04–W05 | Legacy-compatible auth, recovery, persistent budgets, durable replay tests |
| P3, mobile API | W06–W08 | Complete v1 manifest, HTTP parity, unchanged-client qualification |
| P4, browser and SSR | W09–W11 | Browser transport parity, full-page/fragment behavior, E2E and accessibility |
| P5, cutover | W12–W14 | Operational qualification, rehearsed rollback, staged retirement |

## 2. Corrections to apply before implementation

These are source-backed constraints on the proposal, not completed changes.

| Proposal assumption | Verified current behavior | Required implementation treatment |
| --- | --- | --- |
| Reuse native SQL with `sqlx::migrate!()` directly | There are 41 native SQL files. The runner tracks full filenames and SHA-256 in `public.schema_migrations`; two filenames have prefix `0017`. | Preserve the existing history protocol by default. Do not run an unadopted SQLx migrator against an existing database. See W02. |
| Move SQL into root `migrations/` and strip provider objects | Root `migrations/` already contains the private operator workspace. Applied native migrations are immutable. | Keep `db/migrations/` as the canonical application SQL location. Do not edit, rename, or strip applied SQL. |
| Lock the day's existing rows to enforce the cap | Native migration `0015` uses a transaction advisory lock for user/date, including an empty day, and a database trigger enforces 24 hours. | Preserve that trigger and lock protocol; row-only locking is insufficient. Test additional bulk/date-change races. |
| Mobile receives one opaque session ID | Login returns access and refresh credentials, access expiry, session ID, and actor. Refresh rotates credentials. | Preserve the complete login/refresh/logout contract. Opaque credentials are a later representation change, not removal of refresh. |
| Rollback is always a proxy flip | Next validates JWT access tokens/cookies and scrypt passwords. It cannot consume arbitrary Rust opaque tokens or Argon2 hashes. | Keep JWT-compatible issuance and scrypt writes during the Next rollback window. Stage format upgrades after that window, or explicitly implement and test a Next compatibility bridge. |
| Type generation proves API parity | `@vsis/contracts` includes Zod schemas, taxonomy constants, and helper functions. Runtime status/header/validation behavior also matters. | Generate DTO types into a controlled subdirectory while retaining runtime exports. Require HTTP and database parity tests in addition to TypeScript checks. |
| Browser data/auth moves from legacy paths after mobile | Current production browser source already uses v1. Legacy routes/actions remain rollback aliases. | Port cookie-enabled v1 alongside bearer v1. Track legacy aliases and deployed consumers separately. |
| All errors have a string `{ error }` | v1 ordinarily uses `{ data, error }`, with structured error codes; browser/legacy handlers have their own response shapes. | Preserve each endpoint's exact envelope, status, and headers. Do not impose a new global error format. |
| In-memory governor replaces rate limiting | Existing budgets include persistent reservations, daily limits, refund rules, and `Retry-After`. Both servers coexist during rollout. | Preserve database-backed correctness budgets. Governor may supplement burst control; it cannot silently replace persistent quotas. |
| Idempotency is a response-cache extractor | Runtime includes local claims, committed-unknown recovery, imported retry history, ID mappings, and fresh-key admission tied to fence generation. | Port the complete durable protocol in W05 before advertising durable replay. |
| Backup is a JSON database dump | UI backup v2 contains selected work/reference data, supports v1 parsing, and matches users by email. It excludes credentials/accounts. | Preserve application-backup semantics and keep full PostgreSQL backups as a separate operational procedure. |
| Existing `proxy.ts` already routes to Rust | Its current function implements runtime maintenance ingress. | Introduce an explicit route ownership mechanism without weakening maintenance behavior. Validate the installed Next guide before changing its proxy. |
| Drop Node by replacing the web binary | Deployment seed/cleanup jobs currently execute Node; mobile and test tooling also use Node. | Replace runtime jobs before removing Node from the server image. Retain Node in the mobile/development toolchain. |

Current source also includes classification v2, historical rows, global-reminder banners, bounded dashboard reads, and mobile queue/session-transition fixes. These are baseline requirements, even though the proposal does not enumerate them.

Authoritative entry points:

- [Current state](ai-context/CURRENT_STATE.md), [architecture](ai-context/ARCHITECTURE.md), [architecture delta](ai-context/ARCHITECTURE_DELTA.md), and [browser transport matrix](ai-context/PHASE3_TRANSPORT_CONTRACT_MATRIX.md).
- [Migration runner](../db/migrate-runner.mjs), [native integrity trigger](../db/migrations/0015_data_integrity_and_concurrency.sql), and [native timesheet adapter](../lib/db/native/timesheets.ts).
- [v1 HTTP guards](../app/api/v1/_http.ts), [native password formats](../lib/auth/password.ts), [web JWT implementation](../lib/auth/jwt.ts), and [mobile token implementation](../lib/auth/mobile-tokens.ts).
- [Contract exports](../packages/contracts/src/index.ts), [identity schemas](../packages/contracts/src/identity.ts), [portable retry](../lib/idempotency/portable-retry.ts), and [backup parser](../lib/backup.ts).

## 3. Target structure and implementation boundaries

Use five workspace crates initially. The names below are proposed new package names; they do not exist at the guide's baseline.

```text
Cargo.toml
Cargo.lock
rust-toolchain.toml
crates/
  db/       # package vsis-db: domain types/services, SQL, migrations, durable ledgers
  auth/     # package vsis-auth: credentials, sessions, guards, identity/recovery
  api/      # package vsis-api: JSON DTOs, routes, endpoint policy/response mapping
  web/      # package vsis-web: HTML routes, Maud views, fragments, form adapters
  server/   # package vsis-server: composition, configuration, runtime and CLI
db/migrations/             # existing canonical SQL history
packages/contracts/src/
  generated/               # proposed generated wire types, alongside runtime schemas
mobile/                    # existing React Native application
docs/rust-rewrite/         # proposed execution manifests, packets and evidence
```

Allowed direction: `server → {api, web}`, `api/web → {auth, db}`, and `auth → db`. The `db` crate must not import auth, HTTP, or presentation code. API and web must not depend on each other. Direct transport dependencies on `db` mean its public domain service/types boundary, not permission to scatter SQL through handlers.

Place shared business validation and operations in `db::services` using the existing narrow domain-port decomposition. It receives trusted actor/mutation context and calls scoped persistence functions. Put identity lifecycle operations in `auth`. Both HTML and JSON adapters call the same services. This keeps the proposed crate count while avoiding duplicate business rules in two transports.

Keep actor/domain types independent of wire DTOs. Use explicit mapping between PostgreSQL rows, domain results, API DTOs, and view models. Do not generate public types from raw database rows: password hashes, token hashes, session versions, migration provenance, and internal audit fields must not leak.

Use a single PostgreSQL pool per process, shared configuration, a clock abstraction for date/expiry tests, and narrow injectable mail/token facilities where failure testing requires them. No global service locator or new repository dispatcher is required.

### Library and build rules

Retain the proposal's library defaults: Axum/Tokio, SQLx, Maud/htmx, serde, ts-rs, scrypt plus Argon2, HMAC/SHA-256, lettre, UUIDs, thiserror, and Jiff. Pin an actual compatible toolchain and dependency set in W01; commit `Cargo.lock`. Do not copy an assumed version or feature list from this document.

- SQLx compile-time macros require a matching schema or committed offline query metadata. Runtime-built queries do not acquire compile-time verification automatically. Use static checked queries where practical; test parameterized dynamic reporting SQL against PostgreSQL. See [SQLx query documentation](https://docs.rs/sqlx/latest/sqlx/macro.query.html).
- SQLx's embedded migrator has its own tracking/checksum behavior and needs build invalidation when migration files are added. It is not automatically compatible with the existing runner. See [SQLx migration documentation](https://docs.rs/sqlx/latest/sqlx/macro.migrate.html).
- If using Jiff with SQLx, prove the selected versions' PostgreSQL integration in W01; an adapter such as `jiff-sqlx` may be needed. Use a deliberate date/decimal representation at database boundaries. See [Jiff SQLx integration](https://docs.rs/jiff-sqlx/latest/jiff_sqlx/).
- ts-rs emits TypeScript declarations. Runtime schemas/helpers remain a separate supported surface. See [ts-rs documentation](https://docs.rs/ts-rs/latest/ts_rs/).
- Follow the selected Axum version's extractor and route syntax. Normalize extraction failures through the endpoint's established error mapper. See [Axum extractors](https://docs.rs/axum/latest/axum/extract/index.html).
- Vendor a pinned htmx release and pin the Tailwind standalone build artifact. Configure CSS discovery to include Rust view sources. Test generated styles instead of assuming React class discovery covers Maud. See [htmx documentation](https://htmx.org/docs/).

## 4. W00 — Freeze the baseline and resolve transition protocols

**Ownership:** documentation, fixtures, and inventory only. No application deletion or production writes.

**Read:** `docs/ai-context/`, `package.json`, `mobile/package.json`, `vitest.config.mts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `deploy/`, and current source for each contract being captured.

**Deliverables:** create the following execution artifacts when implementation begins:

- `docs/rust-rewrite/BASELINE.md`: exact SHA, starting diff, dependency/runtime versions, representative dataset, benchmark environment, and existing failing/skipped checks.
- `docs/rust-rewrite/ROUTE_MANIFEST.md`: one row per path/method, including exported method aliases and shared handler re-exports. Record bearer/cookie/public/machine-secret mode, role/resource scope, request schema, response shape, headers, feature flags, rate budget, write fence, idempotency, and current tests.
- `docs/rust-rewrite/BEHAVIOR_MATRIX.md`: domain invariants, UI flows, actor cases, and test ownership.
- `docs/rust-rewrite/TRANSITION_PACKET.md`: completed using [the decision packet template](ai-context/ARCHITECTURE_DECISION_PACKET_TEMPLATE.md) and [Astra architecture guidance](../ASTRA_ARCHITECT.md).
- `docs/rust-rewrite/FINDINGS.md`: compact ledger with ID, failure scenario, source, resolution, verification, and remaining blocker.

The baseline has 66 v1 route files, 11 legacy data route files, 9 legacy auth route files, and 3 other API route files. Route files are not endpoint counts: a file may export multiple methods. Generate the method inventory from current source and resolve aliases rather than treating these numbers as completion criteria.

The transition packet must cover activation, steady operation, completion, retries, stale artifacts, process crashes, and concurrent transitions for all of:

1. Filename/checksum migration history shared with Next.
2. Web cookie and mobile credential compatibility during rollback.
3. Scrypt issuance and deferred Argon2 upgrades.
4. Local/imported replay history, fresh-key tickets, and fence generations.
5. Route ownership, existing browser sessions, jobs, and old deployed clients.

Default decisions for that packet are specified in W02, W04, W05, and W13. Escalate a concrete remaining auth/migration/concurrency or compatibility question with bounded evidence; do not invent a protocol by patching isolated symptoms.

Identify whether the intended destination is already a qualified native database. “No data migration” is valid only for that destination. The guide does not establish production provider, applied versions, secret values, or database qualification from Git. If native destination readiness is missing, use the established operator workflow; do not turn the Rust app into an ETL tool.

Build fixtures for anonymous, inactive, user, PM, coordinator, admin, and configured superadmin actors; cross-user resources; both role axes; legacy/classified timesheets; cap-edge days; imported retry history; reminder banners; and backup v1/v2. Use synthetic credentials and isolated databases.

**Exit gate:** every runtime surface has an owner; the transition packet defines rollback eligibility; correctness-critical unknowns are listed with a specific resolution step; baseline test/load results are recorded without presenting skipped tests as passed.

## 5. W01 — Build the workspace and test harness

**Ownership:** new Cargo/toolchain files, crate skeletons, Rust test support, and additive CI preparation.

**Tasks:**

1. Create the five crates and a `vsis-server` binary. Add configuration validation at startup for pool limits, listening address, auth mode/secrets, proxy trust, mail configuration, and feature flags. Do not expose secrets in logs or health responses.
2. Select explicit dependency features and compatible versions. Prove JSON, UUID, PostgreSQL numeric/date/timestamp, TLS, and Jiff conversions with a small real-database integration test.
3. Add `/api/health/live` for process liveness and `/api/health` for readiness/schema/database checks, preserving existing observable contracts where callers rely on them. A database outage must not cause a liveness restart loop.
4. Create an Axum `oneshot` test harness and isolated PostgreSQL fixture harness. Wire `TEST_DATABASE_URL` explicitly; a Rust test attribute does not automatically consume the project's existing variable.
5. Make required CI integration mode fail if its database prerequisite is absent. Local environment-gated skips must be visible.
6. Add a contract-fixture runner that can exercise Next-native and Rust separately against equivalent isolated seed data. Never shadow production writes to both servers.
7. Add request IDs, structured logs, bounded request sizes/timeouts, graceful shutdown, and pool closure. Redact credentials, bearer tokens, recovery links, and sensitive payload fields.

Use the existing native schema without applying a new migrator in this package. The skeleton must remain independently runnable beside Next on another port.

**Exit gate:** workspace format/lint/test/check pass; health behavior covers success and database/configuration failure; the same schema fixture is available to both parity targets; no existing production workflow is removed.

## 6. W02 — Port migrations and native persistence infrastructure

**Read:** `db/migrate-runner.mjs`, `lib/db/migrate.ts`, `lib/db/pool.ts`, `db/seed.mjs`, `db/migrations/`, `tests/migrate.test.ts`, `tests/db-migrations.test.ts`, and `tests/pool.test.ts`.

**Default protocol:** implement the current filename-keyed runner through SQLx connections. Continue using `public.schema_migrations`, the same SHA-256 calculation over SQL text, filename ordering, and advisory lock ID `8675309`. Do not initialize `_sqlx_migrations` and replay the native history. SQLx remains the query/pool library; use of its built-in migrator is optional and requires a separately proven adoption mapping.

**Tasks:**

1. Inventory every native filename and recorded checksum on an isolated copy of the destination. Preserve both `0017_bound_leave_reminder_text.sql` and `0017_mobile_sessions.sql` as distinct filenames.
2. Preserve existing SQL text and schema objects. Embed or package `db/migrations/` without colliding with the operator workspace under root `migrations/`.
3. Acquire the existing global session advisory lock on a dedicated connection. Ensure it remains held for the run and is explicitly released or the connection is discarded on every exit path. Never return a locked connection to the general pool.
4. Apply each pending file and its history insert atomically, one transaction per file. Fail on non-null checksum mismatch. Mirror the current legacy-null-checksum adoption behavior only with recorded baseline evidence; a null history checksum does not prove that the live schema matches the file.
5. Preserve migration directory override behavior if used operationally; accept it only from trusted configuration. Add build invalidation for new embedded files.
6. During coexistence, allow the existing runner to remain the release migration authority until Rust runner parity is established. Both startup paths must coordinate on the same lock/history. Readiness must fail on an incompatible schema.
7. Port pool connection/TLS/timeouts and database errors. Use parameter binding and stable public error mapping; SQL details stay in internal logs.
8. Add new schema changes as new native migrations. Allocate the next unused filename from the current tree when the package begins; do not assume the guide's count still applies.

Do not normalize line endings or modify existing files merely to make embedding convenient. Compare checksums using the exact release artifact and record the policy for future files. Windows/Linux checkout differences can otherwise invalidate existing history.

**Required tests:** fresh database; fully migrated database; partial history; legacy null checksum; changed checksum rejection; failure halfway through one migration; restart after failure; concurrent Next/Rust migration attempts; additions after embedding; and both `0017` files. Assert no existing data loss or duplicate application.

**Exit gate:** a copy of an already-migrated native destination starts safely with both runners; a fresh database reaches the same schema; migration failures leave the failing file/history unapplied; a full database snapshot and restore rehearsal exist before any deployment schema change.

## 7. W03 — Port domain services, scoped SQL, and timesheet invariants

**Read:** `lib/db/types.ts`, `lib/domain/*`, narrow `*-port.ts` contracts, native adapters, `packages/core/src/`, and the associated domain/native tests. Start with timesheets, then reference, people, workspace, leave/reminders, reporting, and operations.

**Tasks:**

1. Port `Actor`, independent permission/hierarchy roles, typed results, timesheet inputs, report buckets, and application validation. Keep legacy `role` synchronization in PostgreSQL. Do not collapse the two role axes.
2. Match scoped native SQL, including own-user writes, manager/PM visibility, and administrative/superadmin boundaries. Use current adapter behavior rather than inferring scope from role labels.
3. Preserve the database daily-hours trigger and its advisory-lock key. All Rust writes must hit the same invariant as Next writes. Application checks provide useful field errors but do not replace the database cap.
4. Port create/edit/delete/duplicate/yesterday/last/batch behavior. Preserve batch size limits, row-level outcomes, one budget reservation per batch, refunds, and the distinction between an acknowledged commit and optional read-back.
5. Preserve classification v2: historical rows remain historical; nullable project IDs and Type/Activity detail rules remain valid; stored entry type controls editing; reserved-name/project eligibility rules remain enforced.
6. Preserve the `TIMESHEET_CLASSIFICATION_V2` rollout gate, `X-Timesheet-Format: 2` marker, and `CLIENT_UPDATE_REQUIRED` behavior. In W05, prove that committed replay recovery occurs before rejecting an old client's format.
7. Port date/backfill rules using civil `YYYY-MM-DD` dates. Current `todayISO()` uses local calendar date. Record the intended server timezone and test around midnight/DST; do not silently switch to UTC business dates or infer production timezone from the developer machine.
8. Preserve positive finite hours and the 24-hour cap with an exact decimal representation at SQL boundaries. Avoid binary-floating comparison drift and preserve existing JSON number behavior.
9. Preserve ordering, pagination, filter aliases, invalid-ID isolation, count suppression, and separately scoped month aggregates. Dashboard rendering must not expand to unbounded history.

### Concurrency protocol

Retain `trg_check_daily_hours` from native migration `0015`. A `SELECT ... FOR UPDATE` over existing timesheet rows does not protect the first insertion on an empty day. Any new Rust lock acquisition must coordinate with the exact existing key, rather than introducing a lock namespace invisible to Next.

Test concurrent inserts, same-row updates, date moves, duplicates, bulk changes spanning several days/users, and import alongside ordinary writes. For multi-key operations, specify deterministic lock ordering and bounded deadlock/serialization retry behavior. If prelocking is required to satisfy a discovered race, include a mixed Next/Rust writer test and an additive migration/shared-protocol change when necessary.

Preserve current partial-result semantics. Do not replace a per-row batch result with an all-or-nothing transaction merely because it is easier. Retry a transaction only when rollback is established; resolve uncertain commits through durable replay before executing again.

**Port or retain coverage from:** `tests/daily-hours-concurrency.int.test.ts`, `tests/timesheet-domain.test.ts`, `tests/timesheet-classification-domain.test.ts`, `tests/timesheet-classification.int.test.ts`, `tests/timesheet-classification-persistence.test.ts`, `tests/timesheet-bulk-id-boundary.test.ts`, `tests/browser-timesheet-batch-update.test.ts`, and `tests/batch-duplicate-reauthorize.test.ts`.

**Exit gate:** scoped reads/writes and classification tests pass on PostgreSQL; exactly one competing 15-hour insertion succeeds on an empty day; no tested interleaving exceeds 24 hours; mixed legacy/classified records and batch outcomes match the baseline.

## 8. W04 — Port authentication with a compatibility window

**Read:** `lib/auth/native.ts`, `password.ts`, `jwt.ts`, `mobile-tokens.ts`, `mobile-session-store.ts`, registration/recovery modules, `app/api/v1/_http.ts`, `app/api/_native-browser-auth.ts`, `lib/http/origin.ts`, `lib/ip.ts`, and identity/client tests.

### Stage A: compatibility required for route-flip rollback

Implement Rust verification and issuance of the existing native web JWT cookie and mobile access/refresh lifecycle first. Preserve relevant signing algorithm, claims, issuer/audience checks, expiry, session version, mobile session/family records, and revocation semantics from current source. Credential representation is part of the coexistence protocol even if it is not a public DTO type.

Keep new passwords and rehashes in the existing supported scrypt format while an unmodified Next image is a rollback target. Implement Argon2 verification/issuance separately, with upgrades disabled until W13's transition gate. Supporting Argon2 in Rust alone does not make Next login compatible.

**Password tasks:**

1. Support both `scrypt$N$r$p$<salt>$<derived-key-hex>` and legacy `<salt>:<derived-key-hex>`.
2. Match Node's actual salt bytes: it passes the stored salt string to scrypt as text. Do not assume the hex-looking salt should be hex-decoded before derivation.
3. Preserve password encoding and parameter/output lengths with fixed Node-generated vectors, including non-ASCII passwords. Bound parsed hash parameters and malformed inputs before expensive work.
4. Run CPU/memory-intensive hashing outside async request execution, with bounded concurrent work. Verify latency and memory under login burst load.
5. For rehash-on-login, update conditionally against the hash/session state that was verified. A slow rehash must not overwrite a concurrently changed password. Preserve revocation on password change/reset.

**Session/guard tasks:**

- Preserve login fields `accessToken`, `refreshToken`, `accessTokenExpiresAt`, `sessionId`, and `actor`; preserve `deviceName`/`platform` inputs and normalized email.
- Preserve refresh-token rotation, expiry, reuse/revocation handling, logout, logout-all, and current-session behavior. Test concurrent refresh, refresh versus logout-all, and password change versus login/refresh.
- Resolve the current profile after authentication. Keep signed-in, active-account, permission, hierarchy, resource scope, and superadmin checks distinct; inactive own-profile/session reads have explicitly different policies.
- An explicit `Authorization` header selects bearer handling. Invalid bearer credentials must never fall back to a valid cookie. Cookie admission remains opt-in and independent of the mobile feature flag.
- Preserve production origin checks for unsafe cookie requests before identity/data access. Add per-session CSRF tokens for new SSR forms; retain established cookie JSON contracts rather than suddenly requiring a new field from existing browser callers.
- Preserve fail-closed write-fence behavior separately from runtime maintenance ingress. Inventory identity/recovery writers and their existing fence exemptions explicitly; do not put all auth routes behind a blanket layer that changes recovery/logout behavior.
- Preserve trusted-proxy IP handling and quota reserve/refund semantics. Keep persistent budgets shared between Next and Rust. Test spoofed forwarding headers and unreadable quota/fence storage.

### Stage B: final opaque-session design, activated later

Implement the proposed DB-backed mode behind an explicit, documented configuration gate. Do not enable it while the route-flip rollback target only understands JWTs.

Use cryptographically random credential secrets, distinct access/refresh purpose, and stored digests instead of storing plaintext bearer secrets. A non-secret database session ID is not sufficient as the credential design. Keep the mobile pair/expiry/sessionId fields unchanged. A web signed cookie binds its credential to session/purpose/key version; verify its tag with a constant-time library operation and look up current database state.

The reviewed schema must represent access expiry, refresh expiry/rotation/family, revocation, current credential/version, session kind, and profile session-version linkage. A table containing only `(id, user_id, expires, revoked)` does not encode the current mobile lifecycle.

Port database transactions for rotation and revocation, including both legacy and opaque sessions during overlap. Record key rotation, cleanup/retention, and the legacy-acceptance deadline in the transition packet. Reject malformed credentials without logging them or attempting alternate authentication modes.

### Registration and recovery

Port only the native implementation, preserving domain whitelist/account activation, field validation, concurrent create behavior, generic non-enumerating recovery responses, response timing/no-store headers, single-use/expiry rules, and atomic password/session-version updates. Mail failures must not expose tokens or account existence. Use a test SMTP sink; test delivery failure, expired/used tokens, weak passwords, and races.

**Coverage sources:** `tests/password.test.ts`, `tests/native-auth-session.test.ts`, `tests/mobile-session-store.test.ts`, `tests/mobile-refresh-route.test.ts`, `tests/mobile-request-auth.test.ts`, `tests/auth-change-password-timing.test.ts`, `tests/password-change-race.int.test.ts`, `tests/password-recovery.int.test.ts`, `tests/password-recovery-routes.test.ts`, `tests/admin-create-concurrency.int.test.ts`, `tests/csrf.test.ts`, and `tests/rate-limit.test.ts`.

**Exit gate:** Rust-issued Stage A credentials and password hashes work after switching to Next and vice versa; all role/origin/revocation/fence tests pass; recovery races pass on PostgreSQL; opaque/Argon2 activation remains explicitly gated until rollback eligibility changes.

## 9. W05 — Port durable idempotency, portable retry, and write admission

**Read:** `lib/idempotency.ts`, `lib/idempotency/`, `lib/idempotency-fresh-key.ts`, the idempotency ticket route, write-gate modules, native migrations `0026`, `0029`, `0030`, `0032`, `0035`, and the current fingerprint/classification migrations.

**Tasks:**

1. Preserve actor/operation/key scoping, request fingerprints, claim ownership, in-flight/conflict responses, durable response recording, effect stamps, and committed-unknown classification.
2. Preserve imported `migration_retry_history`, `migration_record_map`, and `migration_runs` reads. Match namespace selection, source/destination actor and resource-ID translation, fingerprint versions, committed/uncertain outcomes, and ambiguous-match rejection.
3. Reauthorize a stored/imported replay using current actor/resource policy. A cached success must not reveal a resource after access is revoked.
4. Preserve fresh-key ticket binding to actor, operation, expiry, and migration fence generation. Old queued writes with unproven effects must fail closed rather than become new mutations under a fresh key.
5. Preserve the current decision ordering: recover a proven committed replay before applying compatibility checks intended for a fresh mutation. Keep conflict, in-flight, uncertain, authorization, and client-update outcomes distinguishable.
6. Coordinate claims, business writes, and response/effect recording. The default port preserves the established protocol and recovery states. Consolidation into a single transaction is a later bounded change that must prove mixed Next/Rust ledger compatibility and all existing replay behavior.
7. Simulate a business commit followed by result-recording failure/process death. Retrying that request must not create another timesheet. A stale zero-status claim is not evidence that no write happened.
8. Preserve replay retention and the mobile 90-day replay boundary, including its cleanup margin. Cleanup must not delete the only evidence needed by supported queued work.
9. Expose `durableIdempotency` only after the supported paths are durable and verified. Preserve existing browser behavior: independent browser submissions must not be coalesced or assigned invented retry keys.

Do not remove operator-origin tables/functions merely because the Rust runtime no longer talks to Supabase. Runtime imported-history compatibility remains necessary while supported clients can replay that history. Operator package code stays isolated from application imports.

**Required cases:** new key; same-key replay; different payload; different actor/operation; simultaneous duplicate sends; restart in flight; committed response lost; effect stamp with missing cached response; imported committed history; uncertain history; ambiguous namespace; translated IDs; changed role; classification fingerprint; expired/fence-stale fresh ticket; and cleanup at the retention boundary.

**Coverage sources:** `tests/idempotency.test.ts`, `tests/idempotency.int.test.ts`, `tests/idempotency-stamp-recovery.test.ts`, `tests/idempotency-fresh-key.test.ts`, `tests/idempotency-fresh-key.int.test.ts`, `tests/idempotency-effect-classification.test.ts`, `tests/migration-retry-history.test.ts`, `tests/migration-retry-live.int.test.ts`, and `tests/mobile-write-gate-auth-context.test.ts`.

**Exit gate:** restart/failure injection proves no repeated committed effect; imported-history/fresh-ticket tests pass; Next and Rust can interpret each other's ledger effects during coexistence; unavailable database/fence/history evidence produces the established refusal rather than a fresh write.

## 10. W06 — Port the complete versioned API and its wire contracts

**Read:** `app/api/v1/`, `lib/api/v1/contracts.ts`, `lib/api/v1/services/`, `packages/contracts/src/`, `packages/client/src/`, and each route's focused tests.

Implement route groups in the table's order. A group is complete only when every current exported method and policy branch in the W00 manifest is accounted for. These are path groups, not proposed replacement names.

| Group | Current `/api/v1` paths relative to the prefix | Main acceptance concerns |
| --- | --- | --- |
| Identity | `auth/login`, `auth/refresh`, `auth/me`, `auth/logout`, `auth/logout-all`, `auth/signup`, `auth/change-password` | W04 lifecycle, fields/statuses, feature flag, failed-login budgets, inactive behavior |
| Browser identity | `auth/browser/login`, `logout`, `me`, `signup`, `domain-check`, `forgot-password`, `reset-password`, `change-password`, `revoke-mobile-sessions` | Cookie/origin policy, generic recovery, signed-in versus active checks; independent of bearer flag |
| Bootstrap and personal state | `config`, `capabilities`, `reference`, `people`, `profile`, `dashboard`, `layout`, `layout/web`, `settings/backfill` | DTO field mapping, role scope, active/all reference modes, separate layout ownership, bounded reads |
| Timesheets | `timesheets`, `timesheets/:id`, `timesheets/:id/duplicate`, `timesheets/yesterday`, `timesheets/last`, `timesheets/batch-update`, `timesheets/batch-delete`, `timesheets/batch-duplicate` | W03/W05 invariants, classification gate, filter aliases, server-resolved date/latest targets, partial results |
| Leave/reminders | `leaves`, `leaves/:id`, `reminders`, `reminders/:id`, `reminders/global`, `reminders/global/:id/dismiss` | Actor/date scope, repeat dismissal, due/undismissed filtering, banner field, ownership |
| Reports | `reports`, `reports/export` | Grouping/filter defaults differ by auth transport; authorized aggregation, CSV/empty behavior |
| Administration: reference/people | `admin/projects`, `admin/projects/:id`, `admin/activity-types`, `admin/activity-types/:id`, `admin/users`, `admin/users/:id`, `admin/titles`, `admin/titles/impact` | Narrow mutations, role-axis rules, hierarchy cycles/title validity, dependencies, browser/bearer policy differences |
| Administration: workspace | `admin/leaves`, `admin/leaves/:id`, `admin/global-reminders`, `admin/global-reminders/:id`, `admin/branding`, `admin/layout`, `admin/settings/backfill` | Admin/superadmin distinctions, clears/defaults, layout scope, reminder presentation |
| Administration: operations | `admin/timesheets/import`, `admin/backup`, `admin/backup/restore`, `admin/users/:id/timesheets` | Import partial outcomes and reservations; backup versions; body limits; atomic restore |
| Superadmin | `admin/superadmin/reset`, `admin/superadmin/users/:id`, `admin/superadmin/whitelist`, `admin/superadmin/whitelist/:id` | Configured superadmin, destructive modes, self-delete/dependency guards, audit behavior |
| Retry and maintenance | `idempotency-tickets`, `cron/cleanup` | W05 admission; scheduler-secret policy; cleanup fence and retention; current GET/POST cron aliases |

In the browser-identity row, all names following the first path share the `auth/browser/` prefix. Dynamic `:id` notation above corresponds to current `[id]` directories; it is inventory notation, not Axum syntax.

### Handler implementation recipe

For each method:

1. Record its current success and failure cases from the manifest and source. Decide authentication mode before parsing actor-specific input. Preserve maintenance/origin/guard ordering where it is observable or prevents unauthorized work.
2. Parse path/query/body with bounded sizes and the current normalization/strictness. Preserve missing/null/empty distinctions and field-level errors. Do not assume a generated Rust struct reproduces Zod behavior.
3. Resolve the approved actor/machine context and current role/resource/fence policy. Use explicit policies/extractors; their existence alone does not prevent a newly added route from skipping them, so maintain route-policy inventory coverage.
4. Invoke the shared domain operation. Keep SQL, budget charging, and business rules outside route-specific presentation code.
5. Map the result into the exact endpoint envelope/status/headers. Handle JSON/query/path rejection, unsupported methods, and body-limit errors through that same contract boundary.
6. Add happy-path, invalid-input, unauthorized/forbidden, and dependency-failure cases. Mutations also need database effect assertions, budgets, replay, and uncertainty cases relevant to that operation.

Preserve read defaults and browser/bearer distinctions from the transport matrix. Examples: report grouping defaults, empty-export status/headers, and activity-type deletion authority are not identical for the two caller modes. Shared service code must retain the explicit transport policy rather than erase these differences.

For CSV exports, preserve column order, escaping, encoding, filename/content headers, authorized filters, classification details, and the empty-result contract. Keep exports streaming/bounded where current behavior requires it. Unauthorized actors must not receive aggregate or CSV data through a privileged pool shortcut.

### Type generation without breaking runtime consumers

1. Define Rust request/response DTOs with explicit serde names and ts-rs mapping. Represent UUID/date values and optional/null fields exactly as the existing wire contract.
2. Generate into `packages/contracts/src/generated/`, retaining the package name and entry point. Keep its existing Zod schemas, constants, taxonomy, and runtime helpers.
3. Add compile-time assertions between generated DTOs and supported TypeScript surfaces, including the mobile-local contract declarations. Preserve existing exports or migrate every importer in a bounded patch.
4. Create a deterministic export command and a CI stale-output check. Generate to a temporary output location for comparison so routine verification does not silently rewrite committed files.
5. Test actual serialized fixtures and validation outcomes on both targets. TypeScript compilation does not prove auth, status, headers, refresh rotation, idempotency, or PostgreSQL effects.
6. Ensure generated public output has no raw database/secret fields. Test older payloads and absent additive fields explicitly.

**Coverage sources:** `tests/mobile-contract-parity.test.ts`, `tests/vsis-client.test.ts`, `tests/route-gate-inventory.test.ts`, the relevant `tests/mobile-*-route.test.ts`/browser route suites, and client/package tests.

**Exit gate:** every v1 path/method is implemented or has an explicit documented compatibility disposition; HTTP parity and effect assertions pass; contracts regenerate deterministically; root/mobile TypeScript and client tests pass without replacing runtime schema exports.

## 11. W07 — Complete administration, reporting, import, and backup semantics

This package closes the larger service behaviors exposed by W06. Do not call the API complete merely because its router contains these paths.

**Tasks:**

1. Port reference/people/workspace operations through their narrow service contracts. Preserve hierarchy cycle checks, title-role alignment, role-change/self-edit guards, null clears, dependency refusals, default layouts, branding, and whitelist normalization.
2. Port native grouped reporting and daily/month totals as actor-scoped parameterized SQL. Keep `ReportBucket`/DTO mapping, historical/classification filters, grouping, date bounds, stable ordering, and export behavior. Do not resurrect the removed unscoped daily-total RPC.
3. Port import validation and the current 2,000-row limit. Preserve one reservation/refund lifecycle, per-row outcomes, classification interpretation, daily-cap failures, and exception/uncertain-commit handling.
4. Preserve application backup v2 field names and v1 parsing/defaults. Preserve user matching by email, reference matching, deduplication, unknown-user/cap skips, result counters, and repeat-restore behavior.
5. Keep restore in one transaction with the established table-lock and authorization protocol. Bound the route to the current 20 MB request limit and parser row limits. Invalid input or an injected database failure must not leave a partial restore.
6. Preserve classification and `display_as_banner` through backup parsing/export/restore. Operator portable bundles have separate version/byte contracts; do not silently add banner fields to those formats.
7. Keep audit event names and established mandatory/best-effort behavior. Test whether audit failure rolls back or only records an operational failure for each operation; do not globally change the transaction policy.
8. Port scheduled cleanup of sessions, rate windows, and replay records with its explicit machine credential, fail-closed configuration, write gate, and retention bounds. Ordinary user bearer credentials cannot authorize cleanup.

Current UI backup export uses separate reads and is not a consistent full-database snapshot. Preserve its public work-data format; any move to snapshot-consistent export must be a recorded improvement with tests. Full PostgreSQL backups must include accounts, credentials, ledgers, mappings, settings, and schema, and have their own restoration rehearsal.

**Coverage sources:** `tests/people-domain.test.ts`, `tests/reference-domain.test.ts`, `tests/workspace-domain.test.ts`, `tests/reporting-domain.test.ts`, `tests/reporting-portability-classification.test.ts`, `tests/mobile-admin-reports-export-route.test.ts`, `tests/backup.test.ts`, `tests/restore.int.test.ts`, `tests/operations-restore.int.test.ts`, `tests/browser-admin-operations-routes.test.ts`, and `tests/scheduled-maintenance-write-gate.test.ts`.

**Exit gate:** role/resource refusals and destructive failure cases pass; application-backup v1/v2 round trips and repeat restore pass; concurrent restore/write and injected rollback tests pass; cleanup cannot run through an ordinary-user or unconfigured secret path.

## 12. W08 — Qualify the unchanged mobile client

**Read:** `mobile/src/api/`, `mobile/src/auth/session-controller.ts`, secure storage and offline queue/sync modules, `packages/client/src/api-client.ts`, mobile Jest tests, packaging scripts, and `.github/workflows/mobile-release.yml`.

The target is the existing client against a new server. Use its configured base-URL mechanism; do not hard-code the Rust URL into `@vsis/client` or rewrite screens to accommodate an API mismatch.

**Qualification matrix:**

| Scenario | Required result |
| --- | --- |
| Fresh login, cold restore, access expiry | Existing token-pair/refresh lifecycle works; actor/capabilities match |
| Two requests receive 401 together | Existing single-flight refresh/retry remains valid; no session-family corruption |
| Refresh fails due to network/5xx | Stored credentials survive according to current client policy |
| Refresh rejected/revoked, logout-all, password reset | Current client clears/rejects the session appropriately |
| Account switch/logout while reads or writes are in flight | Old-session results do not publish into the new actor's state |
| Offline create/update/duplicate/batches | Existing queue and idempotency keys replay exactly once |
| Prior commit uncertain, client-format rejection, fresh-key replacement | Uncertainty survives restart; replacement is refused until recovery proves safety |
| Imported historical retry and ID remapping | Existing success/conflict/manual-resolution outcomes remain distinguishable |
| Queue timestamp invalid or older than 90 days | Automatic and manual replay share the current refusal boundary |
| Legacy and classified rows, banner reminders, layout edits | Current read/edit/display and discard-guard behavior remains correct |
| HTTP response body stalls | Current timeout/abort and uncertainty behavior remains valid |

Run mobile lint, typecheck, Jest, and Windows tests. Qualify Android and Windows release packaging through the existing scripts; qualify iOS in an available supported host before declaring that platform verified. Preserve Metro/Babel shared-package configuration and the Windows/Android pipeline.

Run a staging build against Rust with synthetic accounts and a seeded database. Capture install/run evidence separately from package creation; a built APK/MSIX is not an installed-app smoke test. Preserve a previously released client build for backward-compatibility testing.

**Exit gate:** the supported released client and current client pass server contract/auth/replay tests; platform checks are explicitly passed or unavailable; no mobile behavior change is hidden under “base URL only.” A required unavailable platform check remains a release qualification gap.

## 13. W09 — Port browser v1 and legacy compatibility aliases

**Read:** `lib/auth/client.ts`, `lib/data/client.ts`, `app/api/v1/auth/browser/`, `app/api/data/`, `app/api/auth/`, `app/actions.ts`, and the browser transport matrix/tests.

**Tasks:**

1. Qualify the existing Next browser UI against Rust-owned cookie-enabled v1 resources before replacing its HTML. This proves the current browser contract independently of the SSR rewrite.
2. Preserve signed-in inactive session/profile behavior, active mutation gates, same-origin writes, structured errors, browser-specific report defaults, download behavior, and explicit independent submissions.
3. Reproduce legacy `/api/data` and `/api/auth` aliases where deployed consumers, scripts, or rollback require them. Inventory their exact differences; alias to the same service with the correct old response mapping.
4. Keep legacy Server Actions hosted by Next while old clients/rollback can invoke them. They are framework protocol endpoints, not generic JSON form posts that can be forwarded to an Axum handler unchanged.
5. Treat source-zero callers as source evidence only. Collect deployed-consumer evidence before removing aliases or framework protocol support.

The current k6 script still logs in through `/api/auth/login` and reads v1 timesheets with `vsis_session`. Retain that alias during comparisons or make one recorded harness change used against both baseline and Rust. Do not compare different authentication paths without recording the difference.

**Coverage sources:** `tests/browser-auth-v1-routes.test.ts`, `tests/browser-auth-v1-aliases.test.ts`, `tests/browser-timesheet-action-routes.test.ts`, `tests/browser-timesheet-batch-update.test.ts`, browser admin route suites, `tests/identity-boundary.test.ts`, and `tests/boundary-enforcement.test.ts`.

**Exit gate:** existing browser flows work through Rust v1 while Next still renders pages; rollback aliases remain available where needed; explicit bearer never falls back to cookie; legacy deletion candidates have evidence rather than assumptions.

## 14. W10 — Build the SSR shell and timesheet/dashboard slice

**Read:** `app/layout.tsx`, `app/globals.css`, `app/components/`, `app/dashboard/page.tsx`, dashboard seed/paging modules, time-entry/classification/backfill/entries/bulk-edit components, and dashboard E2E tests.

Current top-level pages are `/`, `/dashboard`, `/reports`, `/change-password`, `/forgot-password`, `/reset-password`, and `/maintenance`. Administration is largely inside dashboard panels/tabs. Preserve these URLs and navigation semantics; do not invent separate admin URLs and omit the current deep links.

**Tasks:**

1. Create Maud layout, navigation, authenticated/unauthenticated shell, theme/branding tokens, font/static assets, error/empty/loading states, and maintenance rendering.
2. Port login/signup/recovery entry flows needed to reach the dashboard. Keep their existing HTTP identity service contracts; SSR form adapters invoke the same auth implementation.
3. Render the bounded recent-entry table, selected tab/page/filter state, separate month totals, profile/capability state, due reminders, and banner dismissal. Never preload all timesheet history to simplify templates.
4. Add new HTML form/fragment routes in an explicitly inventoried namespace. Do not change v1 JSON routes to return HTML based on an accidental header.
5. Port log, yesterday, backfill, edit/delete/duplicate, batch edit/delete/duplicate, and server-resolved latest-entry actions through shared services. Preserve field errors and successful/partial/failed outcomes.
6. Use post/redirect/get for ordinary forms and htmx fragments for enhancement. Define both paths deliberately. If fragment validation uses a non-2xx status, configure and test htmx error swapping; its default behavior must not hide the field errors.
7. Give full pages and partial responses distinct tested rendering contracts. Set suitable `Vary: HX-Request` and private/no-store behavior; test history restoration and direct navigation so a fragment cannot be cached as a whole page.
8. Handle expired sessions during htmx requests with a full navigation/login outcome instead of inserting a login page inside a table. Prevent post-success client errors from encouraging duplicate resubmission.
9. Use a small external JS module where needed for accessible dialogs, focus restoration, pending controls, theme, clipboard, layout editing, and dirty-form navigation. SSR does not eliminate these local interaction states.
10. Preserve Type/Activity form rules and historical-row editing. Client hints are optional feedback; server validation remains authoritative.

Maud escapes ordinary text; inspect every raw/pre-escaped HTML use and restrict it to trusted generated markup. Brand settings require validation appropriate to CSS/URL contexts as well as HTML escaping. See [Maud escaping](https://maud.lambda.xyz/text-escaping.html).

Keep the existing security-header/CSP intent while adapting it to htmx and static JS. Do not weaken script policy merely to use inline event attributes. Test the selected htmx configuration under the actual production CSP.

For deployment routing, `/dashboard` is one top-level page. Domain-by-domain implementation does not automatically permit domain-by-domain traffic switching inside that page. The default is to finish the required dashboard panels on an isolated Rust staging host before switching the whole path. Incremental embedded fragments require a separately specified composition/rollback adapter.

**Coverage sources:** `e2e/timesheet-mutations.spec.ts`, `e2e/bounded-dashboard.spec.ts`, `e2e/dashboard-ssr.spec.ts`, `e2e/pending-nav.spec.ts`, `e2e/a11y.spec.ts`, and classification/navigation/dialog tests.

Reuse behavioral assertions and accessible selectors. Replace only assertions tied to React hydration/RSC implementation with equivalent SSR/htmx checks; do not delete the represented behavior simply because the old test imports Next helpers.

**Exit gate:** full HTML contains bounded data before JS; required flows work with ordinary forms and enhanced fragments; keyboard/focus/error behavior and CSP pass; paging/filters/deep links survive navigation; no private fields appear in HTML.

## 15. W11 — Complete the web surfaces and non-v1 routes

Port remaining surfaces in this order: reference management → people/hierarchy/profile → reports → personal/global leave/reminders → settings/layout/branding → import/backup → superadmin.

| Surface | Required behavior to preserve |
| --- | --- |
| Reference | Project name/S.O./Telegram fields, active/all activities, title operations, dependencies and policy differences |
| People/team | Permission/hierarchy axes, manager/title relationships, cycles, activation/self-edit/delete guards, actor-scoped team views |
| Reports | Filter/date/group/paging state, Type/Activity classification, authorized totals, export links, empty states |
| Leave/reminders | Date validation, actor scope, due filtering, banner/tile distinction, persistent per-user dismissals |
| Profile/settings/layout | Nullable clears, separate personal/workspace/admin ownership, backfill settings, pending/dirty-change guards |
| Branding | Validated CSS tokens, local fonts/assets, safe logo rendering/preview, refresh after successful changes |
| Import/backup | Validation previews/results, partial import, v1/v2 restore, size limits, audit and atomicity |
| Superadmin | Configured authority, explicit destructive mode, confirmations, self-delete refusal, exact result/error semantics |
| Telegram helper | Existing command generation/clipboard behavior, project/activity fallback, date and description formatting |

Use tables and CSS bars for report visualizations initially. Preserve the information, labels, filters, totals, and accessible text. Add SVG only for a recorded chart requirement; do not substitute decorative bars for data users currently need.

Also account for all three non-v1 API routes: `/api/health`, `/api/health/live`, and `/api/branding/logo`. The logo endpoint supports configured public display and superadmin preview, with different caching. Port its actual SSRF defenses: HTTPS-only URLs, public-address validation/pinned resolution, redirect revalidation, bounds/timeouts, allowed image bytes/content types, SVG rejection, ETag/304, and preview authorization/no-store. Preserve current 2 MB and three-redirect bounds unless a separately tested requirement changes them.

Static assets and metadata paths must remain available during maintenance. Preserve runtime maintenance's no-store behavior, page redirects without original query secrets, API 503 envelope, and `Retry-After`. Maintenance ingress and the migration write fence have different boundaries; exercise both.

**Coverage sources:** `e2e/smoke.spec.ts`, `e2e/reports-paging.spec.ts`, `e2e/password-recovery.spec.ts`, `e2e/ui-polish.spec.ts`, `e2e/a11y.spec.ts`, `tests/branding-logo-proxy.test.ts`, `tests/maintenance-proxy.test.ts`, `tests/maintenance-layout.test.ts`, `tests/telegram.test.ts`, and the relevant domain/route suites.

**Exit gate:** every baseline page/panel/asset/route has a completed disposition; E2E and accessibility pass against Rust; logo preview cannot access private addresses; maintenance and write fencing preserve their separate refusal behavior.

## 16. W12 — Prepare production operations and measure the result

**Read:** `Dockerfile`, Docker Compose configuration, `deploy/README.md`, deployment/service/route/network-policy/configuration manifests, OpenShift overlays, seed/smoke/cleanup jobs, benchmark and k6 scripts.

**Tasks:**

1. Add a Rust container build beside the existing image first. Pin its builder/toolchain and produce the release binary plus required assets/migrations.
2. Prove musl/TLS compatibility on the actual target. If using scratch/distroless, include the required certificate trust, DNS/timezone support, static assets, and runtime configuration. The proposal's image-size figures are targets to measure, not guaranteed outputs.
3. Preserve non-root/arbitrary-UID OpenShift operation, no privilege escalation, read-only runtime assumptions, listening port, health/startup probes, and resource/network constraints.
4. Provide Rust operational CLI entry points for migration, idempotent initial-admin seeding, and scheduled cleanup. Keep HTTP cron authentication and shared cleanup policy intact. Update jobs that currently execute `node`; do not ship a Node command into a Node-free image.
5. Preserve admin bootstrap semantics and avoid resetting an existing admin password during an idempotent seed. Test missing configuration, existing account, new account, and concurrent invocation.
6. Preserve metrics/logging, graceful shutdown, bounded connection acquisition, TLS verification, mail delivery, and configuration errors. Do not publish credentials in diagnostics or invent a public debug endpoint.
7. Rehearse a full PostgreSQL backup/restore and deployment rollback on an isolated destination. UI JSON backup alone cannot restore auth/ledger state.
8. Run correctness tests before comparing performance. Benchmark equivalent data, authentication, HTTP paths, pool limits, host resources, concurrency, and warm/cold conditions.

### Performance evidence

Use `npm run benchmark:http` with `BENCHMARK_URL` for live HTTP comparisons; the benchmark's internal-service mode does not measure the Rust server. Use `npm run load` with `BASE_URL`, `E2E_EMAIL`, and `E2E_PASSWORD` for the existing k6 scenario. Check its endpoint/auth compatibility before interpreting numbers.

Record request counts, p50/p95/p99, failed/error outcomes, throughput, idle/steady/peak application RSS, CPU, pool saturation, cold start, image size, web asset size, and representative page/fragment sizes. Account for password-hash work and cached/warm paths consistently. Keep raw reports outside chat and summarize them in the execution evidence.

Before optimization, write a numeric RAM budget defining “materially lower” from the measured native baseline. Preserve the proposal's equal-or-better p95 requirement at comparable admitted throughput and correctness. The current k6 thresholds are p95 below 2,000 ms and failed-request rate below 1%; meeting those alone does not prove improvement over baseline. Treat infrastructure savings estimates in the proposal as hypotheses.

**Exit gate:** container and jobs run on the intended platform; readiness, mail, TLS, seed, cleanup, snapshots, and rollback pass; load evidence satisfies the recorded memory/latency targets without dropping work or weakening quotas/security.

## 17. W13 — Cut over in compatible stages

Prepare the routing/configuration/runbook changes as reviewable artifacts. Deployment execution follows the later authorized rollout scope and the repository's established workflow.

**Default route ownership sequence:**

1. Isolated Rust staging host with Stage A auth; all fixtures and unchanged-client checks.
2. Mobile identity and bearer v1 groups, including refresh/replay prerequisites, owned together under a recorded compatibility plan.
3. Cookie-enabled v1 and required browser aliases, with the existing Next HTML still serving.
4. Complete top-level Rust web paths as their required slices become ready, retaining static assets and compatibility endpoints.
5. All application traffic on Rust, still issuing Next-compatible credentials/hashes during the declared rollback observation window.
6. Close the Next rollback window; activate opaque issuance and Argon2 upgrades only after the transition gate below.

Browser and mobile already share v1 resource paths. By default, transfer a complete path/method only after both supported authentication modes qualify. “Mobile first” describes qualification order; it does not create a separate mobile URL tree. Splitting a shared path by authentication mode requires an explicit reviewed gateway rule and must preserve bearer non-fallback and cookie admission policy.

Do not treat wildcard routing as a substitute for the path/method manifest. Record ownership of authentication, refresh, logout, reads, writes, replay tickets, exports, branding, health, and jobs at every step. Keep resource operations/retry protocol coherent; random per-request split of stateful auth or mutation/replay paths requires its own proven compatibility design.

### Routing and rollback requirements

- Choose and document the actual gateway/ingress mechanism. If modifying Next `proxy.ts`, read the installed `node_modules/next/dist/docs/` guide and preserve maintenance behavior; current proxy code is not already a Rust router.
- Retain host, origin, query, method/body, cookies, authorization, response cookies, redirects, CSV streaming, request IDs, and trusted-IP semantics through forwarding. Strip spoofable internal forwarding headers at the trusted edge.
- Test exact path boundaries and assets. Avoid accidental prefix matches, loops, leaked internal URLs, and mismatched forwarded-origin checks.
- Never automatically retry/fail over a mutation to Next after a Rust timeout. It may already have committed. Recover by the same durable protocol and key.
- Before reversing ownership, stop admission where necessary, drain in-flight requests/jobs, and inspect durable uncertainty/fence state. Runtime maintenance alone does not drain writers or fence direct database clients.
- Use additive compatible migrations throughout this window. Rollback restores route/image ownership while retaining valid data; it does not normally reverse schema or restore a stale database snapshot.
- Rehearse credentials created by each server, password changes, session revocation, queued mobile writes, partial batches, and restart during cutover in both directions.

### Opaque/Argon2 activation gate

The default guide defers these changes so an unmodified Next image remains usable earlier. At activation:

1. Declare that direct rollback to the old Next auth implementation is no longer supported. Retain a tested previous Rust image that understands the new schema/credentials.
2. Prove both password formats in Rust, hash-update race safety, opaque rotation/revocation, and legacy-to-new session transition on the released mobile client.
3. Stop issuing legacy credentials only after the new issuance path is verified. Keep legacy verification/refresh transition for the recorded supported lifetime; test old sessions and offline clients rather than forcing an accidental logout.
4. Define the legacy token retirement deadline from actual configured lifetimes and supported client behavior. Delete verification only after that evidence gate. Preserve scrypt verification for existing accounts that have not rehashed; inactive accounts do not upgrade just because time elapsed.
5. Test changed-password/rotated-session state against the rollback Rust image. Turning off the new issuance flag does not make already stored Argon2 hashes or opaque tokens consumable by Next.

An alternative is to add opaque/Argon2 compatibility to Next before activation. That changes implementation scope and requires the same cross-version tests; do not assume that bridge exists.

**Exit gate:** ownership manifest is complete, route-flip rollback has been rehearsed for Stage A, new-mode rollback is separately proven, credentials and retry state survive transitions, and observation evidence supports each advancement.

## 18. W14 — Retire obsolete runtime code and close the rewrite

**Prerequisites:** W13 observation/compatibility gates, deployed-consumer evidence, operational replacement of Node jobs, and explicit implementation scope for removals.

**Tasks:**

1. Capture the last working Next release/tag/image and operator recovery documentation. Preserve applied native SQL, audit/provenance data, and full-database snapshots.
2. Remove obsolete Next web/API/action runtime and Supabase runtime dependencies only after all their routes/consumers have a verified disposition. Preserve mobile, `@vsis/core`, `@vsis/client`, contract runtime schemas, and their build/test toolchain.
3. Remove the backend switch and parity-only server code when native-only runtime is qualified. Keep compatibility fixtures/evidence needed to test supported old clients and imported history.
4. Replace obsolete root scripts, lint/typecheck/test configuration, Docker tracing/assets logic, documentation, and CI jobs. Keep npm workspace tooling required by shared packages/mobile; a Rust server does not imply deleting every package manifest.
5. Retire legacy auth/token implementation only according to W13's lifetime gate. Keep native scrypt verification and imported retry compatibility while existing data/clients require them.
6. Keep `migrations/tool` as an isolated operator workspace until its own retirement criteria are met. Removing Supabase runtime does not authorize deleting provider data, receipts, or recovery tooling.
7. Update `docs/ai-context/ARCHITECTURE_DELTA.md` for implemented architecture changes, with baseline/diff and source-backed contracts. Refresh navigation incrementally when supported; no full graph rebuild for a routine slice.
8. Run the settled verification matrix once against the final patch; repeat broad checks only if later changes invalidate them. Record remaining platform/environment gaps plainly.

**Final completion criteria:** the production application runs through the Rust binary; no retired route/job is still required; supported web/mobile behavior and retry/auth semantics pass; native migration/data history remains valid; operational and performance evidence passes; the intended opaque-session destination is achieved or its remaining compatibility grace is explicitly tracked rather than declared deleted prematurely.

## 19. W15 — Optional native-only/Supabase retirement track

This optional package is outside the default Rust implementation sequence. The proposal's P0 recommendation does not by itself authorize deleting Supabase or its deployment state.

Use current native-destination and Supabase-retirement decision records and the private operator workflow. Establish destination readiness, writer/consumer inventory, retained recovery material, and runtime imported-history support. Only then scope provider-code/configuration removal and run native qualification.

If this work happens before Rust, capture a new native-only baseline and use it for efficiency comparisons. Do not claim a Rust efficiency win from a provider change made only on one side of the comparison. It may be efficient to do W15 first, but it is not a prerequisite to preparing or implementing Rust in isolation.

## 20. Verification commands and evidence rules

Existing manifests/configuration remain authoritative. The Rust commands below describe the workflow to create in W01; the Cargo workspace does not exist at the guide's baseline.

### Existing application/shared-package checks

```powershell
npm run lint
npm run typecheck
npm test -- tests/mobile-contract-parity.test.ts tests/vsis-client.test.ts
npm run db:concurrency-test
npm run db:password-recovery-test
```

Use focused test files for each active package. On the settled coexistence patch, run full unit/coverage gates and the CI-equivalent native/Supabase builds while both backends remain supported. The CI workflow defines compile-only placeholder settings; never copy those values into a deployment. Record coverage gates and environment-gated integration suites separately.

### New Rust checks

```powershell
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
cargo test --locked --workspace --all-targets
cargo check --locked --workspace --all-targets
cargo build --locked --release -p vsis-server
```

Add focused PostgreSQL tests for migration adoption, daily-hour interleavings, refresh/password recovery, restore atomicity, and replay recovery. CI-required mode must fail when the isolated database is missing; local skip output must identify what was not exercised. Mocked SQL tests cannot prove locks/transactions.

For checked-query metadata, use the pinned SQLx CLI's supported `prepare`/check workflow against the test schema. A typical command is `cargo sqlx prepare --workspace --check -- --all-targets`; validate its syntax/features against the pinned release. Commit the `.sqlx` output and separately compile in offline mode. Do not generate metadata from a production database or treat runtime dynamic queries as compile-time checked.

Create deterministic contract-export/check commands in the new workflow and record their exact invocation in `BASELINE.md`. After generation, root/mobile typecheck and client/runtime-schema tests must still pass.

### Mobile checks

```powershell
npm --prefix mobile run lint
npm --prefix mobile run typecheck
npm --prefix mobile test
npm --prefix mobile run test:windows
```

Use the existing Android/Windows packaging scripts on supported hosts when qualifying releases. Keep unsigned-package, signed-package, and installed-app smoke results distinct. Report unavailable iOS/other host-dependent checks explicitly.

### Rust web E2E and accessibility

The existing Playwright config accepts `E2E_BASE_URL`; setting it bypasses the default Next standalone server. Point it at an already running seeded Rust test server and set the required test credentials through the normal environment workflow.

```powershell
npm run e2e
npm run a11y
```

During coexistence, preserve the original Next tests and add/adapt a Rust target where assertions depend on RSC/hydration. At retirement, remove Next-only launch/import dependencies from the harness while retaining behavioral tests. Check native-test feature/env gates so a silently skipped file is not counted as Rust qualification.

### Evidence record

For every package, record:

| Field | Required content |
| --- | --- |
| Revision | Commit/diff and relevant dirty-file state actually tested |
| Scope | Package IDs, files, paths/methods, and invariants completed |
| Checks | Exact command, target/backend, result/count, and relevant failures |
| Environment | Isolated DB schema/fixture identity, runtime/tool versions, mail sink/platform |
| Gaps | Skipped/unavailable/failing checks and whether they block implementation or deployment |
| Compatibility | Legacy/new credential, client, migration, retry, and rollback evidence |
| Remaining findings | Unresolved ledger IDs and smallest next action |

Do not present the TypeScript compile, crate build, green mocked handler tests, or package generation alone as end-to-end proof. Final qualification needs real PostgreSQL concurrency/recovery, HTTP contracts, released-client behavior, E2E/accessibility, and the operational/load evidence relevant to the assigned phase.

## 21. Ready-to-use worker assignment

Use this template to dispatch a bounded package. Fill in its scope rather than asking a worker to “rewrite everything.”

```text
Implement package Wxx from docs/rust-rewrite-implementation-guide.md.

Objective:
<one concrete completed behavior>

Baseline and ownership:
<SHA and starting worktree changes>
Write scope: <explicit files/directories>
Preserve unrelated work. Do not expand shared ownership without coordination.
Do not spawn further agents.

Required context:
<relevant guide section, source symbols, fixture/decision packet, unresolved finding IDs>

Contracts to preserve:
<path/method/envelope, actor/resource policy, transaction/replay semantics,
 compatibility/rollback stage, and client/runtime-package exports>

Acceptance checks:
<focused success/failure tests, real-DB tests, build/contract/platform checks>

Exit gate:
<package gate and deployment blockers>

Return:
Files changed; behavior implemented; exact verification and tested state;
passed/failed/skipped checks; unresolved findings; ownership returned.
Do not deploy, retire providers, or delete unrelated runtime surfaces as part of this package.
```

The first assignment should be W00, followed by the W01 workspace/test harness. These produce the reviewable contracts and evidence needed before persistence/auth migration work begins.

## Appendix A — API wire quick reference (UNVERIFIED navigation aid)

> **This appendix is not a contract.** It was assembled from a prior exploration pass, not
> re-verified field-by-field against source at this commit. W00's `ROUTE_MANIFEST.md` and the W06
> source reading are authoritative. Confirm every name, type, status, and header against current
> source before relying on it; if this appendix and the source disagree, **the source wins** and
> this appendix should be corrected or deleted. Auth/crypto specifics (scrypt salt-as-text, cookie
> and mobile-token formats) are **deliberately excluded** — see W04, which carries the exact traps.

### A.1 Response envelopes

- **`/api/v1`** success: `{ "data": <T>, "error": null }` (2xx; create typically **201**).
- **`/api/v1`** error: `{ "data": null, "error": { "code": "STRING_CODE", "message": "…", "fieldErrors"?: { "field": ["…"] } } }` — `fieldErrors` on validation failures only.
- **Legacy `/api/data` and `/api/auth`**: plain `{ "error": "<string>" }` on failure (no `data`, no `code`); raw object on success — **not** the v1 envelope. Preserve both shapes (guide §2 correction row).

### A.2 Status codes (verify per endpoint)

`401` unauthenticated · `403` forbidden · `400` validation · `404` not found · `409` conflict ·
`429` rate limited · `500` server · `503` write-fence/maintenance · `204` empty report export.
`422` reportedly unused.

### A.3 Headers

- Request: `Authorization: Bearer <accessToken>` (when present, always the credential — no silent
  cookie fallback); session cookie only on `allowCookie` routes; `idempotency-key` or
  `x-idempotency-key` on writes; `x-request-id` echoed (generated ≤128 chars if absent).
- Response: `x-request-id` (always); `x-response-time` (`"123ms"`, dashboard); `retry-after`
  (`"60"` on fence 503; seconds on 429); `X-Total-Count` (reports/export); `Cache-Control:
  no-store` (config, export).

### A.4 Error codes the mobile client branches on (non-exhaustive)

From `identity.ts` `IDENTITY_ERROR_CODES`: `INVALID_CREDENTIALS`, `ACCESS_TOKEN_EXPIRED`,
`REFRESH_TOKEN_REUSED`, `SESSION_REVOKED`, `RATE_LIMITED`, `MOBILE_API_DISABLED`,
`UPGRADE_REQUIRED`, `VALIDATION_ERROR`, `INTERNAL_ERROR`.

### A.5 Core DTO field names (confirm against `packages/contracts`)

Casing is **not uniform** — `snake_case` on timesheet entries, `camelCase` on actor/profile. Set
serde renames per field; no blanket rule.

- **MobileActorDto**: `id, email, role, permissionRole, hierarchyRole, name|null, department|null, title|null, managerId|null, isActive, capabilities?: {canViewTeam, canManageProjects, canManageActivities, canManageUsers, canManageSettings, canManageWorkspaceCustomization?}`.
- **PersonProfileDto**: `id, email, name, role, permissionRole, hierarchyRole, department|null, title|null, managerId|null, isActive, dashboardLayout:unknown|null, adminLayout:unknown|null, mobileLayout:unknown|null, createdAt`.
- **TimesheetEntry**: `id, user_id, user_email?, project_id|null, project_name?, activity_type_id|null, activity_name?, entry_type?, activity_code?, activity_other?, ticket_number?, log_date, hours_worked, work_done, created_at`.
- **Project**: `id, name, so_number?, telegram_no?, is_timesheet_project?, created_at`.
- **LeaveEntry**: `id, user_id, leave_date, reason, created_at`.
- **Reminder**: `id, user_id, message, remind_at, done, created_at`.

### A.6 Frozen request body shapes (confirm against source + W03/W06)

- `POST /timesheets` accepts **both** the V2 form (`entryType, activityCode, projectId?, activityTypeId?, ticketNumber?, activityOther?, hoursWorked, workDone, logDate, userId?`) and the **legacy** form (`projectId, activityTypeId, hoursWorked, workDone, logDate, userId?`). A `#[serde(untagged)]` enum keyed on presence of `entryType` is the clean port.
- `POST /timesheets/batch-update`: `{ "entries": [ {id, projectId?, activityTypeId?, entryType?, activityCode?, ticketNumber?, activityOther?, hoursWorked, workDone, logDate} ] }`, length 1–500.
- `POST /leaves`: `{ "rows": [ {userId, leaveDate, reason?} ] }` (1–366) **or** a bare array.
- `PATCH /admin/users/:id` and `/profile` are **presence-aware**: absent = unchanged, `null` = clear, present = set. Use `Option<Option<T>>` with `#[serde(default)]` (or a `serde_json::Value` patch) — don't collapse missing and null.
- Admin **project** create/patch return the `Project` on the bearer path but `{success:true}` on the cookie path — preserve both.
