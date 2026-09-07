# Dual-backend modular architecture implementation plan

**Planning baseline:** committed tree `969e8cc` (`docs: add modular server and shared client architecture plan`). The checkout used to write this plan is older; implementation must begin from `969e8cc` or a descendant and must not absorb unrelated uncommitted work by assumption.

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

Slices 04–08 may proceed independently after 03. Slices 09 and 10 may proceed in parallel with the timesheet chain. Overlap in compatibility composition files is a merge-coordination concern, not a blocking edge.

## Files to modify

### Shared package and build boundaries

- Add `packages/core`, `packages/contracts`, and `packages/client`, each with explicit public exports and no private cross-package imports.
- Update root package/workspace metadata, TypeScript, Vitest coverage, ESLint/import restrictions, Docker/standalone asset copying, and CI archive/build inputs.
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

Run slice-specific tests first, then the standing gates before marking a slice complete. Expected result for every command is exit code 0 with no unexpected skips; database/platform skips leave the corresponding gate open.

```powershell
npm run lint
npm run typecheck
npm test
npm run test:coverage
$env:NEXT_PUBLIC_BACKEND = 'supabase'; npm run build
$env:NEXT_PUBLIC_BACKEND = 'native'; npm run build
npm run e2e
npm run a11y
Push-Location mobile
npm run lint
npm run typecheck
npm test
npm run package:android
npm run package:windows:unsigned
# On a configured macOS runner:
npm run ios
Pop-Location
```

Database-affecting slices additionally run their named integration tests with `TEST_DATABASE_URL` against migrated disposable PostgreSQL and equivalent scenarios against local Supabase through authenticated RLS requests. Platform-source or package-resolution changes require Android, iOS, and Windows build/package smoke evidence; Jest alone is insufficient.

## Assumptions

| Assumption | Planning status | Invalidation response |
|---|---|---|
| Implementation starts from `969e8cc` or a descendant containing the timesheet domain service and bearer-to-RLS work referenced by the design. | Verified in Git history; this planning checkout is an older ancestor. | Rebase the plan against the actual start commit before editing code; do not recreate already-landed work or overwrite in-flight changes. |
| Root npm workspaces can coexist with the separate mobile installation and local `file:` dependencies without loading a second React/native runtime. | Unverified until slice 01 installs and builds all platforms. | Stop slice 01 if the supported Metro/package layout cannot enforce mobile-local runtime resolution; do not merge installations as a workaround. |
| Existing `/api/v1` resources can accept cookie authentication without changing mobile bearer semantics or public response envelopes. | Plausible from separate current bearer and cookie helpers; runtime parity is unverified. | Stop slice 03 if strict bearer precedence, origin protection, and request-scoped RLS cannot all be preserved. |
| Native PostgreSQL and Supabase can implement the same domain ports without weakening SQL authorization, RLS, transactions, or concurrency enforcement. | Partially verified by the existing `Repository` facade and dual adapters; narrow-port parity is unverified. | Keep provider mechanics separate; stop only the affected domain if its shared service would weaken an invariant. |
| Disposable native PostgreSQL, local Supabase, and Android/iOS/Windows build surfaces will be available before affected slices are declared release-ready. | Unverified environmental dependency. | Leave the corresponding evidence gate open and do not count skipped integration/platform checks as success. |

## STOP conditions

Stop only the affected slice, record evidence in `NOTES.md`, and request a plan decision if:

- the implementation baseline is not `969e8cc` or a descendant, or a later change invalidates a documented contract or security boundary;
- Metro cannot consume the shared source packages without duplicate React/React Native resolution or an unsupported native build layout;
- cookie support on `/api/v1` cannot preserve explicit-bearer precedence, CSRF protection, and request-scoped Supabase RLS identity;
- a domain port cannot preserve both adapters' authorization, transaction, concurrency, or error semantics without a schema/provider change outside this plan;
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
