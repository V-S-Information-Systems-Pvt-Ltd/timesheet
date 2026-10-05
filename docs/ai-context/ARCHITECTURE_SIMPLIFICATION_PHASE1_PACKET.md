# Phase 1 decision packet — retire the broad repository facade

## Outcome

Implemented on `arch/architecture-simplification`: shared contracts moved to
`lib/db/types.ts`, rate limiting uses its narrow provider selector, all facade
tests were repointed to owning adapters, and the aggregate repository files were
removed. The repo-wide boundary test now rejects imports of the removed facade.
Typecheck, lint, full coverage, both backend production builds, the live Supabase
Auth gate, and the cleanup-verified remote retry-history integration suite pass.
A disposable local PostgreSQL 16 Docker container also passed 48 native database
tests plus migration export, write-fence, native provider-fence, and upgrade-path
suites (19 more passing tests); the container and test data were removed afterward.
Playwright and Supabase-specific live database/migration legs remain gated because
no seeded browser server or local Supabase stack/direct database URL was supplied.

## Decision required

How should the broad `Repository` dispatcher be removed while both backend modes remain supported?

## Why now

`docs/plans/ARCHITECTURE_SIMPLIFICATION_PLAN.md` selects native as the eventual backend and identifies the broad dispatcher as vestigial. This slice must preserve existing behavior, authorization checks, and the still-supported Supabase mode.

## Current architecture and evidence

- `FACT` — Atlas maps `lib/db/repository.ts` as a shared type/guard module and the facade interface as a separate export.
- `FACT` — Serena finds the `repo` export in `lib/db/index.ts`, a live import in `lib/rate-limit.ts:129`, and a test mock in `tests/action-policy.test.ts:70`.
- `FACT` — `lib/db/timesheets.ts` selects a provider's narrow persistence adapter directly; the other domain composition modules follow the same pattern.
- `FACT` — `lib/auth/registration-{native,supabase}.ts` implement `findWhitelistedDomain`; the corresponding methods in `lib/db/{native,supabase}.ts` have no application references.
- `FACT` — `tests/boundary-enforcement.test.ts` already forbids global dispatcher imports in actions, routes, and domain composition modules.
- `UNKNOWN` — Deployed database state and clients are environment-specific. This phase does not infer their retirement status.

## Constraints and existing decisions

The Phase 0 decision keeps both backends supported until cutover and recovery gates are met. Keep `Actor`, write/result types, role guards, and authorization behavior. Applied migrations and public HTTP/action contracts remain unchanged. See `docs/ai-context/CONSTRAINTS.md` and `docs/plans/ARCHITECTURE_SIMPLIFICATION_PLAN.md`.

## Alternatives

1. **Chosen:** move shared types and guards to `lib/db/types.ts`, temporarily re-export from the old path, switch rate limiting to a narrow provider selector, repoint tests to domain adapters, then delete the broad facade. This preserves behavior and makes each step reviewable.
2. Keep the dispatcher as a compatibility layer. It maintains a second path to every adapter and the old parity obligation without an application consumer beyond rate limiting.
3. Delete the facade and its test consumers in one step. This risks losing authorization assertions and breaks imports of shared types and guards.

## Risks and acceptance

The main risk is weakening native/Supabase authorization coverage while repointing tests. Preserve each assertion and verify the same scenarios, including whitelist registration and rate-limit reserve/release. Run typecheck, lint, the focused repository/action/boundary suites, full unit suite, coverage, and both backend builds before declaring Phase 1 complete. Update the context pack and architecture delta when the facade is removed.

## Rollback and open questions

The change is code-only and can be reverted by Git; no schema or data rollback is involved. Confirm the exact adapter mapping for each facade test before deleting its import. No Astra escalation is needed because the architecture choice is recorded in the plan and this packet has no unresolved design trade-off.
