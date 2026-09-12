# Dual-backend modular architecture implementation plan

**Planning baseline:** committed tree `969e8cc` (`docs: add modular server and shared client architecture plan`). Validation on 2026-09-08 used `6985ad5`, and revalidation on 2026-09-12 used `98baca8`; both are verified descendants. Record the actual implementation-start commit and preserve unrelated uncommitted work.

**Architecture source:** `C:/dev/timesheet/docs/plans/dual-backend-modular-architecture.md` at `969e8cc`.

**Implementation notes:** keep [NOTES.md](NOTES.md) current throughout execution.

## Context

Web and React Native currently duplicate contracts, calculations, client decisions, validation, and orchestration. Browser data access chooses Supabase or native behavior, while large backend adapters expose many domains through one repository. The target is one modular server and three platform-neutral packages without changing the existing Next.js deployment, application locations, databases, authentication providers, RLS model, public action signatures, `/api/v1` URLs, or released mobile wire shapes.

This is a migration program, not one pull request. Each slice below must leave the repository releasable and must prove one end-to-end behavior before obsolete code is removed.

## Approach

1. Establish `@vsis/core`, `@vsis/contracts`, and `@vsis/client` through a smart-hours/timesheet tracer bullet used by both applications.
2. Complete timesheets as the reference server module: explicit actor, narrow persistence port, explicit clock, shared validation and write-budget ownership, and transport-only adapters.
3. Move browser timesheet traffic onto the shared HTTP client and `/api/v1`, adding strict cookie/bearer authentication selection and request-scoped Supabase RLS binding. Keep Server Components and Server Actions on direct service calls.
4. Migrate each remaining domain end to end. Add the service and provider ports, route all transports and clients through them, prove parity, then remove only that domain's replaced implementation.
5. Finish with shared platform-neutral client logic and enforce dependency/import boundaries after all callers have a valid replacement.

Within every wide adapter refactor, use expand/migrate/contract: add domain ports beside `Repository`, migrate one operation and provider at a time while green, and remove old methods only when searches and parity tests show no remaining callers.

## Key decisions

- Use root npm workspaces for `packages/*`; keep `mobile/package-lock.json` and mobile's installation independent through local `file:` dependencies.
- Keep the existing `lib/domain/timesheets.ts` boundary instead of introducing a parallel application-layer framework. Add sibling domain modules only as their slices begin.
- `@vsis/contracts` owns canonical Zod schemas and inferred inputs/DTOs. Client validation is advisory; domain services validate authoritatively.
- `@vsis/client` accepts injected `fetch`, base URL, and authentication behavior. Native secure token storage and refresh serialization remain mobile-owned.
- An explicit `Authorization: Bearer` header always selects bearer authentication. An invalid bearer token returns an authentication error and never falls back to cookies. Cookie-authenticated mutations retain origin protection.
- Select credentials before applying the mobile bearer feature gate: disabling mobile bearer access must not disable browser-cookie resource requests. Cookie requests use the existing web actor/session checks without requiring a mobile session. Keep existing mobile authentication lifecycle contracts unchanged; slice 10 owns their extraction.
- Supabase ordinary-user access always uses the validated request identity and RLS. Existing privileged operations may keep narrowly scoped service-role access; service-role access is not a replacement for a user-scoped adapter.
- Server Components and Server Actions call application operations directly; they never call this server's HTTP API.
- Keep `Repository`, `/api/data`, action signatures, and existing DTO shapes as compatibility surfaces during migration. Remove or shrink them only after their callers migrate and contract tests pass.
- Keep SQL authorization, RLS, constraints, transactions, provider error mapping, and row-to-DTO mapping server-side. Shared packages never import database rows.
- Device-local date presentation remains platform-owned. Server business dates and business-rule date arithmetic remain authoritative and shared.
- Do not create a generic repository framework. Domain ports may deliberately duplicate provider-specific mechanics where lifecycles or security models differ.

## Dependency rules

`@vsis/core` may depend only on platform-neutral runtime/library code. `@vsis/contracts` may depend on `@vsis/core` and Zod. `@vsis/client` may depend on both earlier packages. None may import Next.js, React Native, database clients, application files, native modules, storage implementations, or secrets.

Web/native renderers, navigation, storage, authentication persistence, and platform integrations may consume shared packages but never become dependencies of them. Server transports authenticate and parse requests, application services own orchestration and policy, and provider adapters own persistence behavior.

## Slices

| ID | Outcome | Blocked by |
|---|---|---|
| [01](slices/01-shared-timesheet-tracer.md) | Shared smart-hours and timesheet contract run in both apps | none |
| [02](slices/02-timesheet-application-owner.md) | Timesheet operations have one application owner | 01 |
| [03](slices/03-backend-neutral-browser-timesheets.md) | Browser timesheet access is backend-neutral | 01, 02 |
| [04](slices/04-reference-data-module.md) | Reference-data behavior is shared end to end | 03 |
| [05](slices/05-people-module.md) | People and hierarchy behavior is shared end to end | 03 |
| [06](slices/06-leave-reminders-module.md) | Leave and reminder behavior is shared end to end | 03 |
| [07](slices/07-reporting-module.md) | Reporting behavior is shared end to end | 03 |
| [08](slices/08-workspace-module.md) | Workspace behavior is shared end to end | 03 |
| [09](slices/09-operations-module.md) | Operational workflows use application coordinators | none |
| [10](slices/10-identity-boundary.md) | Identity lifecycle has an explicit infrastructure boundary | 01 |
| [11](slices/11-boundary-enforcement.md) | Shared-client adoption is complete and enforced | 03–10 |

Slices 04–08 may proceed independently after 03. Slices 09 and 10 may proceed in parallel with the timesheet chain. Before other domain ports exist, slice 09 uses narrow compatibility adapters over current repository operations, preserving the existing whole-restore transaction. Slice 05 may use the existing identity facade until slice 10 replaces its internals. Overlap in compatibility composition files is a merge-coordination concern, not a blocking edge.

## Files to modify

### Shared package and build boundaries

- Add `packages/core`, `packages/contracts`, and `packages/client`, each with explicit public exports and no private cross-package imports.
- Update root package/workspace metadata, TypeScript, Vitest coverage, ESLint/import restrictions, Docker/standalone asset copying, and CI archive/build inputs. Extend the Vitest coverage `include` paths to `packages/**` in the slice that first moves code there (slice 01), so shared business logic in `@vsis/core` and `@vsis/contracts` is subject to the same 60% lines/functions/statements gate CI already enforces for `lib/**`; shared-package coverage gaps leave the slice's evidence gate open.
- Preserve the aggregate 50% branch threshold and retarget security-sensitive per-file thresholds at the time code moves; measuring an empty compatibility re-export is insufficient. In particular, moved `lib/validation.ts` logic retains its 95% lines/functions/statements and 90% branches gates. Merely extending coverage `include` does not establish a separate threshold for each package; add explicit package-path gates to enforce the slice 01 requirement.
- Update mobile package metadata, TypeScript, Jest, Babel/Metro, and packaging scripts so external package sources are visible while React and React Native resolve from `mobile/node_modules`.

### Server application and persistence boundaries

- Evolve `lib/domain/timesheets.ts`; add sibling modules for reference data, people, leave/reminders, reporting, workspace, and operations.
- Add narrow provider implementations under domain-specific native and Supabase adapter files. Keep `lib/db/repository.ts`, `lib/db/native.ts`, `lib/db/supabase.ts`, and `lib/db/index.ts` as compatibility composition surfaces until contraction.
- Reduce `app/actions/*`, `app/api/data/*`, `app/api/v1/*`, and `lib/api/v1/services/*` to authentication/parsing/response mapping plus direct application-service calls.
- Keep identity-provider mechanics in `lib/auth/*` and request-scoped Supabase identity construction in `lib/supabase/*`.

### Client adoption

- Replace canonical declarations in `mobile/src/api/contracts.ts` and backend selection in `lib/data/client.ts` with public shared-package imports or compatibility re-exports.
- Move only equivalent, platform-neutral logic out of web and mobile. Keep React state setters, navigation, secure storage, offline queue formats, file export, and device integrations local.

## Rollout and rollback

- Merge slices in dependency order, but release each as a reviewable increment. A slice is not complete while required backend or platform evidence is skipped.
- Introduce additive package exports, service ports, endpoints, and compatibility adapters before moving callers. Contract obsolete paths only in the slice that proves all callers have migrated.
- Preserve `/api/v1`, `/api/data`, Server Action signatures, mobile response shapes, and old-client behavior during the supported compatibility window.
- If a slice needs schema support, add new native and Supabase migrations; never edit applied migrations. Make schema changes backward-compatible with the previous application artifact.
- Roll back through the prior application artifact. Leave additive schema in place unless a separately reviewed forward-safe migration removes it. Do not use duplicate production writes for comparison.
- Capture baseline and post-migration error rate and latency for migrated endpoints using existing logging/telemetry; do not add an observability platform for this work.

## Risk controls

| Risk | Blast radius | Control |
|---|---|---|
| Shared-package resolution loads duplicate React/native runtimes | All mobile builds and runtime hooks | Prove one package tracer on Android, iOS, and Windows before wider adoption; retain mobile-local runtime resolution and stop on duplication. |
| Authentication expansion changes credential precedence or leaks request identity | Every `/api/v1` caller and Supabase RLS query | Make bearer selection explicit, apply origin checks only to cookie mutations, inject identity per request, and test concurrent actors before moving browser callers. |
| Domain extraction breaks durable idempotency or replays an outcome after authorization changed | Keyed offline mutations in timesheets, leave, and reminders | Preserve same-transaction effect evidence and database-computed payload fingerprints for stamped writes, ledger-only response replay for duplicate/batch operations, fail-closed recovery, replay reauthorization, and exactly-once write-budget charging; run the stamp-recovery and batch-reauthorization suites before moving each affected write. |
| Identity extraction allows refresh to resurrect a revoked session or misreports partial password-change failure | Web/mobile password and session lifecycle | Preserve bounded begin/complete guards, serialization with refresh rotation, revoke-before-provider-write ordering, provider-session cleanup, and state-specific failure responses; require live PostgreSQL race and recovery evidence. |
| Application extraction changes authorization, transactions, budgets, or error semantics | One migrated business domain | Characterize first, migrate one operation/provider/transport at a time, retain compatibility adapters, and require allow/deny plus failure parity before contraction. |
| Large compatibility facades create merge conflicts or mixed old/new execution | Repository composition and transport entry points | Use expand/migrate/contract per domain; coordinate overlapping facade edits, but do not serialize independent slices solely for file overlap. |
| Released mobile clients encounter removed fields/routes or changed offline behavior | Installed clients that cannot upgrade atomically with the server | Keep URLs and wire shapes stable, use compatibility re-exports/adapters, deploy server support before clients, and remove only after the compatibility window is documented. |
| Provider-specific queries regress latency or completeness | Migrated endpoint/domain only | Preserve explicit optimized queries, record pre/post latency and error observations, and roll back the application artifact without destructive schema rollback. |

## Out of scope

- Independent services, queues, distributed transactions, or separate scaling/release units: no current scaling, ownership, or release requirement needs them.
- ORM adoption, generic repository generation, or deriving one provider's migrations from the other: these obscure provider-specific authorization and transaction behavior.
- Package-manager migration, framework upgrades, or merging root/mobile installations: unrelated risk to the package-sharing objective.
- A cross-platform component framework, shared navigation, or shared storage abstraction: rendering and device lifecycles remain intentionally platform-specific.
- Changes to database topology, existing authentication providers, RLS policy model, schemas, or application locations unless a slice identifies an unavoidable compatibility defect and stops for a plan amendment.
- Production dual writes, speculative extension points, or a new telemetry platform.

## Global verification

Run slice-specific tests first, then the standing gates before marking a slice complete. Check each command's exit status before continuing. Database/platform skips and early returns leave the corresponding gate open even if the runner reports a passing test. `tests/parity-tracer.test.ts` currently uses `it.skipIf(!process.env.TEST_DATABASE_URL)` for its real-database case; a passing file with that case skipped is not database evidence.

Run the two browser build/test groups in separately configured sessions against disposable native PostgreSQL and local Supabase with seeded `E2E_EMAIL`/`E2E_PASSWORD` and any required pending-user fixtures. Set `CI=true` so Playwright cannot reuse a stale server; require its port to be free, stopping only test servers owned by this run. The actual `playwright.config.ts` launches `.next/standalone/server.js`, so build locally with `VERCEL` unset and test each backend before its build output is replaced. Preserve/restore the invoking shell's environment after verification.

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run test:coverage
# Session configured for disposable Supabase and seeded browser fixtures:
$env:CI = 'true'
$env:NEXT_PUBLIC_BACKEND = 'supabase'
npm run build
npm run e2e
npm run a11y
# Separate session configured for disposable native PostgreSQL and fixtures:
$env:CI = 'true'
$env:NEXT_PUBLIC_BACKEND = 'native'
npm run build
npm run e2e
npm run a11y
docker build -t vsis-timesheet:plan-check .
Push-Location mobile
npm ci
npm run lint
npm run typecheck
npm test
npm run package:android
npm run package:windows:unsigned
# On a configured macOS runner with CocoaPods and signing provisioned:
npx react-native build-ios --mode Release
Pop-Location
```

Persistence/authentication-affecting slices (including adapter-only changes) additionally run their named integration tests against migrated disposable PostgreSQL and equivalent scenarios against local Supabase through authenticated RLS requests. Set both `TEST_DATABASE_URL` and `DATABASE_URL` to the same verified disposable native database: the tracer only copies the former when the latter is absent. Never infer the target from `TEST_DATABASE_URL` alone. Existing `supabase-repository-authz.test.ts` and `supabase-restore.test.ts` mock the clients/RPCs; affected slices must add or identify a real authenticated integration harness and record its exact command and allow/deny, concurrency, or rollback results. Unit mocks cannot close that gate.

Platform-source or package-resolution changes require Android, iOS, and Windows release build/package evidence plus a launch exercising the shared calculation/contract with Metro stopped. A development `npm run ios` alone does not prove bundled sources. Record the platform, build command, artifact, and launch result; missing macOS/SDK access leaves the gate open. After the Docker build, boot the resulting image against the disposable native target and exercise a migrated operation; likewise exercise the standalone artifact without source-package paths supplied from the checkout.

## Assumptions

| Assumption | Planning status | Invalidation response |
|---|---|---|
| Implementation starts from `969e8cc` or a descendant containing the timesheet domain service and bearer-to-RLS work referenced by the design. | Verified at `6985ad5` on 2026-09-08 with `git merge-base --is-ancestor 969e8cc HEAD` (exit 0). | Rebase the plan against the actual start commit before editing code; do not recreate already-landed work or overwrite in-flight changes. |
| Root npm workspaces can coexist with the separate mobile installation and local `file:` dependencies without loading a second React/native runtime. | Unverified until slice 01 installs and builds all platforms. | Stop slice 01 if the supported Metro/package layout cannot enforce mobile-local runtime resolution; do not merge installations as a workaround. |
| Existing `/api/v1` resources can accept cookie authentication without changing mobile bearer semantics or public response envelopes. | Plausible from separate current bearer and cookie helpers; runtime parity is unverified. | Stop slice 03 if strict bearer precedence, origin protection, and request-scoped RLS cannot all be preserved. |
| Native PostgreSQL and Supabase can implement the same domain ports without weakening SQL authorization, RLS, transactions, or concurrency enforcement. | Partially verified by the existing `Repository` facade and dual adapters; narrow-port parity is unverified. | Keep provider mechanics separate; stop only the affected domain if its shared service would weaken an invariant. |
| Durable idempotency for keyed offline writes is part of the compatibility contract across transport, application, and persistence boundaries. | Verified at `98baca8`: `lib/idempotency.ts`, `lib/idempotency-key.ts`, `lib/idempotency-effect.ts`, and the Supabase adapter jointly own stamped-effect recovery, ledger-only duplicate/batch replay, payload conflicts, replay authorization, and budget outcomes. | Stop the affected slice if its new boundary cannot preserve the operation's existing stamped-effect or ledger-only replay model, database-authoritative fingerprint comparison where applicable, replay reauthorization, and exactly-once charging. |
| Password/session extraction must preserve the current bounded guard and partial-failure semantics rather than treating provider Auth and application sessions as one atomic store. | Verified at `98baca8` in the web revoke route, mobile password-change route, mobile session store, and native/Supabase migrations; live provider parity remains an implementation gate. | Stop slice 10 if the new identity boundary cannot serialize refresh against password changes, expire abandoned guards, clean temporary provider sessions, or report which state changed after a partial failure. |
| Disposable native PostgreSQL, local Supabase, and Android/iOS/Windows build surfaces will be available before affected slices are declared release-ready. | Unverified environmental dependency. | Leave the corresponding evidence gate open and do not count skipped integration/platform checks as success. |

## STOP conditions

Stop only the affected slice, record evidence in `NOTES.md`, and request a plan decision if:

- the implementation baseline is not `969e8cc` or a descendant, or a later change invalidates a documented contract or security boundary;
- Metro cannot consume the shared source packages without duplicate React/React Native resolution or an unsupported native build layout;
- cookie support on `/api/v1` cannot preserve explicit-bearer precedence, CSRF protection, and request-scoped Supabase RLS identity;
- a domain port cannot preserve both adapters' authorization, transaction, concurrency, or error semantics without a schema/provider change outside this plan;
- a keyed mutation cannot preserve immutable effect evidence, payload-conflict detection, replay reauthorization, fail-closed recovery, or exactly-once budget accounting;
- identity extraction cannot preserve password-change guards, refresh serialization, abandoned-guard recovery, provider-session cleanup, or truthful partial-failure responses;
- preserving a released action, URL, DTO, offline queue, or mobile response requires a breaking change;
- a command might target a live database or production deployment when a disposable/test target cannot be proven.

Missing credentials, SDKs, simulators, or runners leave the relevant evidence gate open; they do not authorize weaker substitutes.

## Acceptable finish

The migration is complete when canonical contracts have one definition, equivalent business operations have one application implementation, browser application data access no longer selects a database backend, persistence is composed from domain-specific adapters, dependency rules are enforced, and all required dual-backend and platform gates pass. The final `NOTES.md` entry must state how execution ended and link the evidence that the motivating web/mobile divergence was removed without changing supported public contracts.

## Plan review notes — 2026-09-06

| Dimension | Initial draft | Reviewed plan | Resolution |
|---|---:|---:|---|
| Completeness | 4/5 | 5/5 | Added program rollback, per-slice failure/STOP behavior, compatibility contraction, and a finish condition. |
| Feasibility | 4/5 | 5/5 | Made package sharing the first cross-platform tracer and isolated unverified Metro, RLS, provider-port, and runner assumptions behind evidence gates. |
| Scope | 5/5 | 5/5 | Kept the approved eleven outcomes; excluded services, ORM/generation, framework/package-manager migration, shared UI/storage/navigation, dual writes, and speculative infrastructure. |
| Testability | 5/5 | 5/5 | Each slice has observable acceptance criteria, targeted commands, and required provider/platform evidence; global dual-backend and release gates are explicit. |
| Risk | 4/5 | 5/5 | Added blast radius and controls for runtime duplication, request identity, behavior drift, compatibility, merge coordination, and provider-query regressions. |
| Assumptions | 4/5 | 5/5 | Marked each assumption verified, partially verified, or unverified and paired it with an invalidation response. |

Load-bearing local claims were checked against `969e8cc`: the existing timesheet domain service still falls back to the global repository; browser data access still selects a backend and directly uses Supabase; `/api/v1` currently builds a bearer-scoped Supabase client; and root/mobile lockfiles remain separate. No implementation tests were run for this documentation-only change; `git diff --check` is the artifact verification gate.

## Plan validation — 2026-09-08

This assessment supersedes the earlier readiness scores. Reviewed the working plan, all eleven slices, architecture source, and relevant code/configuration at `6985ad5`; preserved the pre-existing coverage and baseline-notes additions. Changed documentation only.

| Dimension | Before | After | Resolution or remaining evidence |
|---|---:|---:|---|
| Completeness | 4/5 | 5/5 | Clarified early slice 09 compatibility wiring and preservation of its whole-restore transaction; slice 05 can retain the existing identity facade. |
| Feasibility | 4/5 | 4/5 | Existing services, request binding, separate installations, and installed build commands verified. Shared-package builds and live provider parity remain unproven. |
| Scope | 4/5 | 5/5 | Removed root/mobile runtime-version equality as a requirement; preserve mobile-local resolution without framework upgrades or a new build dependency. |
| Testability | 3/5 | 5/5 | Fixed PowerShell quoting; added Docker, separate backend browser runs, release artifact launches, explicit package/security coverage gates, and real integration evidence requirements. |
| Risk | 4/5 | 5/5 | Added cookie-versus-bearer feature-gate cases, database-target equality, early-return detection, and whole-restore transaction preservation. |
| Assumptions | 4/5 | 5/5 | Corrected stale checkout ancestry and documented actual Playwright launch behavior, mock-test limits, and outstanding runtime evidence. |

Evidence:

- `git merge-base --is-ancestor 969e8cc HEAD` returned 0; `git rev-parse --short HEAD` returned `6985ad5`.
- `package.json` has React 19.2.4 and no React Native dependency; `mobile/package.json` has React/test-renderer 19.2.3 and React Native 0.84.1. `vitest.config.mts` has aggregate 60/60/60/50 thresholds and higher security-sensitive file gates. `Dockerfile` currently installs before copying workspace sources. These facts informed slice 01 corrections.
- `lib/domain/timesheets.ts` still defaults to the global repository; `lib/data/client.ts` still selects providers; `app/api/v1/_http.ts` gates bearer access before parsing credentials; `lib/supabase/bearer.ts` binds a request-scoped client. The retained ordinary-user RLS boundary also agrees with the [official Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security). No provider API or schema changes were implemented.
- `npx vitest run tests/smart-hours.test.ts tests/mobile-contract-parity.test.ts tests/mobile-request-auth.test.ts tests/parity-tracer.test.ts --reporter=dot` exited 0: four files, 32 reported passing tests. The real-database tracer printed `TEST_DATABASE_URL not set — real-backend tracer NOT RUN (not green)` and returned early. This is unit-level evidence only.
- All 75 referenced test paths exist. All 12 PowerShell blocks parse after the slice 11 correction; local Markdown links resolve; `git diff --check` passes.

**Remaining gate:** proceed with slice 01 to prove package sharing, but do not treat this program as fully validated or release-ready. Shared-source clean installs, Docker/standalone execution, Android/iOS/Windows release launches, and real native/Supabase parity need implementation evidence. This review did not run those gates. Record results in `NOTES.md`; absent evidence keeps the affected slice open.

## Plan revalidation — 2026-09-12

Revalidated the plan and all eleven slices against `98baca8`, including code added since the 2026-09-08 review for durable idempotency recovery, replay reauthorization, and guarded password/session changes. Updated documentation only.

| Dimension | Before | After | Resolution or remaining evidence |
|---|---:|---:|---|
| Completeness | 4/5 | 5/5 | Slices 02 and 06 now name every durable-idempotency invariant; slice 10 now covers bounded password-change guards, refresh serialization, provider cleanup, and truthful partial failures. |
| Feasibility | 4/5 | 4/5 | The current implementations and focused unit suites support the boundaries, but shared-package builds and live provider/platform parity remain unproven. |
| Scope | 5/5 | 5/5 | The additions preserve current behavior inside existing slices and introduce no new service, framework, package, or migration outcome. |
| Testability | 4/5 | 5/5 | Added focused stamp-recovery, replay-reauthorization, Supabase password-change, revoke-session, store, race-integration, and recovery-integration gates; corrected the tracer skip description. |
| Risk | 4/5 | 5/5 | Added blast radius, controls, acceptance criteria, and STOP conditions for idempotency drift and password/refresh races. |
| Assumptions | 4/5 | 5/5 | Recorded the current multi-layer ownership of durable idempotency and the non-atomic provider/session password-change contract with invalidation responses. |

Evidence:

- `git merge-base --is-ancestor 969e8cc HEAD` returned 0 at `98baca8`; the current timesheet service still permits the global repository fallback, `/api/v1` still gates bearer access before credential parsing, and Supabase bearer calls remain request-scoped.
- `lib/idempotency.ts`, `lib/idempotency-key.ts`, `lib/idempotency-effect.ts`, and `lib/db/supabase.ts` jointly implement immutable effect recovery, database-computed payload comparison, fail-closed conflict handling, replay reauthorization hooks, and budget release behavior.
- The web revoke route, mobile password-change route, and mobile session store implement bounded begin/complete guards, refresh serialization, provider-session cleanup, and state-specific partial-failure results.
- `npx vitest run tests/smart-hours.test.ts tests/mobile-contract-parity.test.ts tests/mobile-request-auth.test.ts tests/idempotency-stamp-recovery.test.ts tests/batch-duplicate-reauthorize.test.ts tests/mobile-change-password-supabase-route.test.ts tests/revoke-mobile-sessions-route.test.ts --reporter=dot` exited 0: seven files and 73 tests passed.
- Local Markdown links resolve, all PowerShell blocks parse, all referenced test paths exist, and `git diff --check` passes after these edits.

**Remaining gate:** slice 01 may begin, but the program is not release-ready until shared-source clean installs, Docker/standalone execution, Android/iOS/Windows release launches, and real native/Supabase parity provide runtime evidence. Record that evidence in `NOTES.md`; a skipped provider or platform check keeps the affected slice open.

<!-- UNRESOLVED: Feasibility remains 4/5 until the shared-package tracer and real provider/platform gates supply runtime evidence. Documentation changes cannot establish that evidence. -->
