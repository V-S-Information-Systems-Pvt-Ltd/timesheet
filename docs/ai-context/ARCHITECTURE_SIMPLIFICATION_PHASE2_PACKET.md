# Phase 2 decision packet — isolate migration tooling and portable retry runtime

## Decision Required

How should operator migration tooling be separated from request-time retry compatibility without changing migration, fencing, replay, authorization, or fail-closed behavior?

## Why This Decision Is Needed

Phase 2 of `docs/plans/ARCHITECTURE_SIMPLIFICATION_PLAN.md` requires independent ownership and retirement gates for operator tooling and runtime compatibility. Acceptance requires `npm run migration` to remain compatible, migration tests to retain explicit lint/type/unit/integration/coverage gates, and request-time portable retry behavior to preserve activation, completion, recovery, stale-key, refusal, and concurrency outcomes. This phase does not retire any capability or alter database schemas.

## Current Architecture

- `lib/migration/**` is a self-contained operator subsystem with relative internal imports and direct dependencies only on Node APIs, `pg`, `zod`, and `@supabase/supabase-js`.
- `scripts/migrate-backend.ts` is a thin process adapter over `lib/migration/cli.ts`.
- `lib/idempotency.ts` owns both ordinary provider idempotency and the request-time portable retry protocol. Portable history, mapping, translation, local-history precedence, reauthorization, and fresh-key admission are currently coordinated inside that file.
- Migration integration steps currently live inside the broader `e2e-matrix` CI job, while migration implementation files are included in the application `lib/**` coverage scope.

## Relevant Existing Decisions

- `docs/plans/ARCHITECTURE_SIMPLIFICATION_PLAN.md`, Phase 2.
- `docs/plans/C06A_RETRY_SESSION_RECOVERY_CONTRACT.md` defines the portable retry protocol.
- `docs/ai-context/ADR_NATIVE_DESTINATION.md` records native as the destination while preserving supported migration/recovery obligations.
- `docs/ai-context/CONSTRAINTS.md` requires additive migration history, the shared native migration runner, and both-backend build compatibility.

## Constraints

- Operator tooling must never become request-bound or import application database pools, auth facades, domain services, Next.js modules, or cookie-bound Supabase clients.
- Runtime portable retry must never import the operator package.
- Missing configuration and database lookup failures must continue to fail closed; no no-op fallback is permitted.
- `npm run migration -- <command>` remains the operator entry point.
- Existing migration and runtime tests retain their assertions and required live gates.
- Applied native and Supabase migrations remain untouched.

## Evidence

### Repository map evidence

- Atlas ranks `lib/migration/format.ts`, `merge-plan.ts`, `providers/session.ts`, and `cli.ts` as the migration subsystem's central nodes; their import graph is internal to that subsystem.
- Atlas identifies `lib/idempotency.ts` as a separate application-runtime node and `lib/idempotency-fresh-key.ts` as its runtime admission dependency.

### Relevant symbols

- `lib/idempotency.ts: withIdempotency` — calls portable history resolution, payload classification/translation, and fresh-key admission before the ordinary provider claim path.
- `lib/idempotency.ts: resolvePortableRetry` — enforces imported/local history precedence, uncertain/in-flight/conflict outcomes, replay authorization, and namespace ambiguity.
- `lib/idempotency.ts: classifyPortablePayload` — distinguishes destination-era, translated source-era, unresolved, and review-required payloads.
- `lib/idempotency.ts: runSupabaseStampedDelivery` — owns effect/legacy-ledger behavior that must remain shared with the main runtime rather than move into operator tooling.

### Relevant implementation observations

- `FACT` — migration source imports are relative internally and use only `pg`, `zod`, `@supabase/supabase-js`, and Node APIs (`lib/migration/**`).
- `FACT` — boundary tests already forbid application imports of migration tooling and forbid request-bound dependencies inside it (`tests/boundary-enforcement.test.ts`).
- `FACT` — portable retry logic reads runtime tables for both providers and mutates the caller-owned payload before execution (`lib/idempotency.ts`).
- `FACT` — CI migration live gates are embedded in `e2e-matrix`; root coverage includes `lib/**` (`.github/workflows/ci.yml`, `vitest.config.mts`).
- `INFERENCE` — moving operator files mechanically is low semantic risk, but moving runtime retry code without a cohesive orchestration boundary would weaken protocol ownership.
- `UNKNOWN` — production migration deployment state is environment-specific and is not inferred from this refactor.

## Architecture Delta

Phase 1 retired the broad repository facade and established narrow provider composition. Phase 2 starts from the current uncommitted `arch/architecture-simplification` delta and changes ownership/paths only; it adds no schema or public HTTP contract change.

## Known Risks

- A partial runtime extraction could bypass imported-history checks, fresh-key admission, reauthorization, or payload translation.
- A path-only package move could silently remove migration code from coverage without a replacement gate.
- CI duplication could make migration tests optional or run destructive suites against an unintended database.
- Package aliases could accidentally make operator code importable from application runtime.

## Alternatives

### Option A — chosen

Create private workspace package `tools/migration`, move operator source and its tests/configuration into it, preserve the root CLI command, and give it dedicated lint/type/unit/integration/coverage CI. Extract runtime portable retry into `lib/idempotency/portable-retry.ts`; let it own protocol ordering while receiving callbacks for ordinary local-ledger/effect behavior that remains in `lib/idempotency.ts`. Enforce both directions with boundary tests.

Benefits: explicit ownership, no runtime/operator dependency, preserved protocol, independently removable tooling. Costs: package/CI configuration and mechanical import movement. Rollback is a Git revert because no data/schema changes occur.

### Option B — package move only

Move `lib/migration/**` but leave portable retry embedded in `lib/idempotency.ts`. This improves filesystem ownership but leaves the runtime compatibility protocol difficult to audit and retire independently, so it does not complete Phase 2.

### Option C — move all migration-named runtime code into the tool package

This creates a request-time dependency on operator infrastructure and couples application deployment to a package intended for later retirement. It violates the existing boundary and is rejected.

## Unresolved Questions

- None block implementation. Production retirement timing remains governed by Phase 4 gates R1–R3 and is explicitly out of scope.

## Scout Synthesis

No delegated scout was required. Deterministic Atlas and Serena evidence agrees with current source: operator tooling is structurally separable, while portable retry is a request-time protocol that must stay application-owned.

## Requested Astra Output

The existing Phase 2 plan already resolves the material architecture choice, and the source packet exposes no conflicting alternative or unresolved persistence decision. No additional Astra escalation is required before the behavior-preserving implementation. Closure review must verify package boundaries, protocol parity, dedicated CI gates, both builds, coverage, and live database suites.
