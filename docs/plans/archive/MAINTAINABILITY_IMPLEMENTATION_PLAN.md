# Improve repository navigation and safe changes

## Context

Keep one repository and make its existing module boundaries easier to find, review, and verify. The motivating problem is that code is hard to navigate or change safely. The first implementation pass covers navigation, ownership guidance, and focused validation; the user explicitly deferred enforced review rules and CI filtering.

This is an implementation plan, not an ADR or a record of completed implementation. Its first usable deliverable is a timesheet change guide that traces a real operation from its entry points through domain logic and both persistence adapters to the relevant tests.

Planning baseline: `3e718584792d88f13ee06800ba3a5953455af383`, verified on 2026-09-15. Existing changes in `AGENTS.md`, `docs/README.md`, `.serena/`, `.ua/intermediate/`, and `docs/ai-context/` predate this plan and must be preserved. Record a fresh baseline when implementation starts.

## Evidence and key decisions

| Status | Evidence or decision | Consequence for implementation |
|---|---|---|
| Confirmed | `packages/core`, `packages/contracts`, and `packages/client` already exist. Their manifests establish that client depends on contracts, and contracts depends on core. | Document these public package boundaries and reuse them. |
| Confirmed | `TimesheetDomainDeps` in `lib/domain/timesheets.ts:55` receives a narrow persistence interface, clock, and write budget. `timesheetDeps()` in `lib/db/timesheets.ts:25` composes them. | Describe the existing domain and adapter composition; retain the `Repository` compatibility facade. |
| Confirmed | `lib/data/client.ts:3` describes one backend-neutral HTTP facade, importing `createApiClient` from `@vsis/client` at line 11. `docs/ai-context/MODULE_INDEX.md:11` still describes backend-selected data access. | Correct the context pack against source. Distinguish browser data access from backend-selected authentication. |
| Confirmed | Root workspaces cover `packages/*`; mobile has its own manifest and local dependencies on all three packages in `mobile/package.json:28`. | Include web, server, shared packages, and mobile when tracing contract impact. |
| Confirmed | Boundary enforcement, adapter export parity, domain behavior, HTTP behavior, and DTO mapping tests already exist. | Start with the current tests and add cases only for demonstrated gaps. |
| Inference | Making these existing boundaries discoverable addresses the reported problem with less coordination overhead than repository extraction. | Measure navigation on representative changes before considering another structural change. |
| Unknown | Actual primary/backup maintainers and the size of the navigation improvement are not established by source. | Record confirmed identities only; collect before/after walkthrough evidence. |

The architectural precedent is [the modular architecture plan](dual-backend-modular-architecture.md), whose summary retains the existing deployment, providers, schemas, and application locations. Its initial problem list is historical: [implementation notes](dual-backend-modular-implementation/NOTES.md) record subsequent package and domain work. Source is authoritative when those documents disagree. Open historical release gates are not proof of a current failure or a reason to repeat that migration.

## Approach

### Phase 0 — Capture a small, reproducible baseline

**Owner:** implementation coordinator, supported by a bounded evidence scout. **Dependency:** none.

1. Record HEAD, working-tree status, relevant tool availability, and pre-existing changes in `docs/plans/archive/MAINTAINABILITY_IMPLEMENTATION_NOTES.md`. Create that file when execution starts; keep it beside this plan. Back up any configuration before modifying it, if a separately justified configuration edit becomes necessary.
2. Run two read-only navigation drills from the normal documentation entry point, before correcting the guides:
   - Locate the implementation and checks for a proposed change to timesheet create/update rules, including daily-hour limits, inactive actors, and editing another user's entry.
   - Locate the shared contract, server mapping, and web/mobile consumers affected by a proposed timesheet response-field change.
3. For each drill, record the prompt, files/symbols identified, elapsed navigation time, unrelated files opened, missing or misleading guidance, and selected checks. Do not make the hypothetical application changes.
4. Run verification groups V1 and V2 below. Preserve exit codes and concise results; retain full logs locally if a failure needs diagnosis. Compare against the earlier V1 result of 21 passing tests at the planning baseline without presenting it as a fresh run.

**Gate:** each drill has reproducible evidence, and baseline test results distinguish pass, failure, and unavailable checks. A pre-existing test failure may leave the documentation work proceeding, but blocks any claim that the affected safety check is green.

**Risk and rollback:** noisy measurements or unrelated work mistaken for this task. Use the same drill prompts and tool/model settings for comparison, preserve the initial status, and revise only this task's evidence if recorded incorrectly. No runtime rollback is needed.

### Phase 1 — Deliver the timesheet change guide and correct its navigation context

**Owner:** one documentation implementer. **Dependency:** Phase 0 records captured.

Create `docs/guides/SAFE_CHANGES.md` as one concise contributor guide. Begin with the two timesheet drills; avoid a catalog of every utility. The source navigation spine is:

| Responsibility | Current entry point or boundary |
|---|---|
| Web mutations and their guards | `app/actions.ts` re-exports; `app/actions/timesheets.ts:21` (`logEntry`); `app/actions/_shared.ts` |
| Browser timesheet reads | `lib/data/client.ts:209` requests `/api/v1/timesheets` with the browser cookie session; the versioned route delegates to its service |
| Existing compatibility read endpoint | `app/api/data/timesheets/route.ts:31` delegates to the domain; distinguish it from the browser's current timesheet path |
| Versioned HTTP operations | `app/api/v1/timesheets/route.ts`; `lib/api/v1/services/timesheets.ts:71` (`createTimesheetService`) |
| Business rules | `lib/domain/timesheets.ts` (`createTimesheetEntry`, `updateTimesheetEntry` and related operations) |
| Dependency composition | `lib/db/timesheets.ts` (`timesheetDeps`) |
| Persistence contract | `lib/domain/timesheets-port.ts` (`TimesheetPersistence`) |
| Backend implementations | `lib/db/native/timesheets.ts`; `lib/db/supabase/timesheets.ts` |
| Wire contracts and consumers | `packages/contracts` public exports; server mapping in `lib/api/v1/contracts.ts`; `packages/client`; current web/mobile callers |

Preserve the dependency convention visible at `lib/domain/timesheets.ts:55`:

```ts
export interface TimesheetDomainDeps {
  persistence: TimesheetPersistence
  clock: () => string
  writeBudget: WriteBudget
}
```

Explain where a rule change, transport-only change, contract change, or persistence change belongs. Trace current callers with Serena before finalizing each example. Include the existing actor checks, stable action signatures and `{ error }` response convention, and backend authorization parity; link authoritative rules instead of copying the full security policy.

Correct the relevant context documents in the same deliverable:

- `CURRENT_STATE.md`, `ARCHITECTURE.md`, and `SYSTEM_MAP.md`: include shared packages, domain operations, narrow ports, and adapter composition. Show package dependencies separately from runtime/deployment boundaries.
- `MODULE_INDEX.md` and `DEPENDENCY_MAP.md`: add the public shared-package boundaries and domain ports; correct browser data access; show mobile's source dependencies on the shared packages.
- `API_CONTRACTS.md`: verify the shared request/response definitions and distinguish them from server-only database-to-DTO mapping. Correct only inaccurate statements.
- `ARCHITECTURE_DELTA.md`: record the corrected baseline and its source revision. Identify previously implemented modularization as a documentation correction, not work delivered by this plan.
- `docs/ai-context/README.md` and `docs/README.md`: link the contributor guide and keep progressive disclosure intact.

Use current task context, the compact context pack, Atlas, then Serena and targeted source as needed. Reuse Understand Anything for unresolved cross-domain questions; do not rebuild or reconfigure it for documentation edits. Do not rewrite the entire context pack or historical implementation ledger.

**Gate:** another contributor or fresh agent can trace both example changes to the right layers, consumers, and tests without the guide author's assistance. Referenced paths and symbols resolve, and the corrected documents agree with current source. This is the first shippable outcome.

**Risk and rollback:** another stale summary becoming authoritative. Include verification date/revision and source links; restore only this phase's documentation hunks if they misdirect readers.

### Phase 2 — Add practical ownership and review guidance

**Owner:** repository maintainer supplies ownership facts; documentation implementer records them. **Dependency:** Phase 1's boundary map.

Add a compact ownership section to `SAFE_CHANGES.md`, grouped by existing responsibilities: domain rules, persistence and migrations, identity/security, shared packages, web transport/UI, and mobile transport/UI. For each, identify the responsible maintainer role, review triggers, and escalation route. Add primary and backup identities only when the maintainer confirms them; Git authorship is not ownership evidence.

Document joint review triggers: contract changes involve server and web/mobile consumers; persistence or schema changes involve both adapters and migration tracks; identity, session, authorization, and role changes involve the security reviewer. Assigning a reviewer does not replace the existing checks.

If identities remain unknown, explicitly mark them unconfirmed and route requests through the repository maintainer. This is acceptable ownership guidance for the first pass; it must not be reported as completed individual assignments. The maintainer can fill the identities later without blocking the other phases.

**Gate:** a reader can identify which responsibilities need review for both drills, including cross-boundary changes, and every named owner is confirmed. No CODEOWNERS or repository-settings change is part of this pass.

**Risk and rollback:** misleading owner assignments or a single-person bottleneck. Keep backup/escalation guidance and remove only incorrect assignments if necessary.

### Phase 3 — Make check selection explicit and prove the selected path

**Owner:** routine coding/test agent, with documentation edits integrated by the guide owner. **Dependency:** Phase 1; test audit can run alongside Phase 2.

1. Add a change-to-check table to `SAFE_CHANGES.md`, using the current manifests, `vitest.config.mts`, `playwright.config.ts`, and `.github/workflows/ci.yml` as authoritative definitions. Focused local checks supplement the existing CI requirements.
2. Map the timesheet examples to existing success and failure cases: valid create/update; inactive actor rejected before persistence; other-user edits forbidden; daily totals above 24 hours rejected; exhausted write budget returns `429 RATE_LIMITED` without writing; browser query validation and DTO mapping. These cases already appear across the V2 suites; verify their actual assertions before claiming coverage.
3. Inspect the web mutation checks in `tests/actions.test.ts`, `tests/actions-extra.test.ts`, and `tests/action-policy.test.ts` when mapping the Server Action path. For the contract drill, inspect `tests/vsis-client.test.ts` and relevant `tests/data-client-*.test.ts` assertions, then identify affected mobile consumers and their manifest-defined checks. Identify which existing assertions cover each chosen operation rather than assuming a domain test proves transport wiring.
4. Record any uncovered requirement as a concrete missing assertion, with its failure mode and affected path. Add a small regression case to the relevant existing test file only if that gap is demonstrated. If it exposes an application bug, report a separate scoped fix; do not silently redesign or change production behavior under this plan.
5. Explain verification limits: `domain-adapter-contracts.test.ts` compares exported method names against expected lists; it does not execute database behavior. `mobile-contract-parity.test.ts` tests server-side DTO mapping, not an installed mobile client against a deployed server. RLS, transaction/concurrency, and cross-version compatibility require their appropriate integration evidence.

**Gate:** the guide names exact runnable checks, the selected success/failure assertions have been inspected, applicable runs pass, and skipped or unavailable integration evidence is labeled. If existing coverage is sufficient, finish with no new tests.

**Risk and rollback:** false confidence from structural tests or unnecessary duplicate tests. Keep behavioral checks separate from structural checks. Revert only a newly added incorrect test or guidance hunk; never weaken existing checks, coverage thresholds, or security guards to obtain a green result.

### Phase 4 — Validate the improvement and hand off

**Owner:** coordinator plus a reader/agent who did not author the guide. **Dependency:** Phases 1–3 integrated.

Repeat the Phase 0 drills in a fresh session with the same prompts and tool/model settings. Record correctness, time, unrelated reads, and review/check selection. Require correct boundary and consumer identification for both drills. Report whether navigation time or unrelated reads improved; this small sample supports a local navigation finding, not a claim of fewer production regressions.

If neither drill improves, make one bounded guide correction based on the observed confusion and repeat the affected drill. If it still fails, record the specific remaining navigation obstacle and stop expansion; seek a focused follow-up rather than broad repository restructuring. A failed drill remains an open gate.

Check links and task-only diffs, consolidate duplicate guidance, and record the final verification state. Update architecture deltas only for meaningful baseline/policy changes. Routine edits should maintain the relevant guide, not trigger full architecture rediscovery.

**Gate:** both drills are correct, at least one shows an observed navigation improvement, applicable checks pass, and all changes stay within the agreed first-pass scope. Missing real owner identities remain explicit follow-up items.

**Risk and rollback:** measurement bias or scope expansion. Use a fresh reader/session, retain the baseline, and report inconclusive outcomes honestly. Revert only this task's documentation/test changes if the result is unhelpful.

## Files and execution ownership

| Purpose | Files | Editing owner |
|---|---|---|
| First usable guide, ownership, and check selection | New `docs/guides/SAFE_CHANGES.md` | One documentation implementer; coordinator merges contributions |
| Accurate architecture navigation | The specific `docs/ai-context/` files listed in Phase 1 | Same documentation implementer |
| Discoverability | `docs/README.md` | Documentation implementer; preserve existing entries |
| Evidence and deviations | New `docs/plans/archive/MAINTAINABILITY_IMPLEMENTATION_NOTES.md` | Coordinator |
| Conditional regression coverage | Relevant existing `tests/*.test.ts` from Phase 3 | Test implementer; no speculative test expansion |

Use a small evidence scout for bounded symbol/reference checks and a routine documentation/coding model for execution. Supply this plan, the baseline, relevant symbols, and file ownership to delegated work. Reserve Astra/high-capability architectural reasoning for a material boundary decision or a stop condition; do not delegate independent rediscovery of the whole repository.

Each phase may be a small reviewable Conventional Commit. Do not commit unrelated work or publish changes without the applicable task authorization. No new dependency or tooling installation is required.

## Verification

Run commands from the repository root unless indicated. RTK may reduce noisy output, provided the underlying exit code and failures remain available.

| Group | Command/check | Expected result and use |
|---|---|---|
| V0 | `git rev-parse HEAD`; `git status --short`; `git diff --stat`; `git diff --check` | Record the baseline and final scope. Attribute pre-existing changes; no whitespace errors introduced by this task. Inspect newly created files too, since ordinary `git diff` omits untracked content. |
| V1 | `npm test -- tests/boundary-enforcement.test.ts tests/domain-adapter-contracts.test.ts tests/mobile-contract-parity.test.ts` | All selected checks pass. The architecture assessment ran this selection at the planning baseline: 21 passed, 0 failed. Rerun when implementation starts; this plan does not certify a later checkout. |
| V2 | `npm test -- tests/timesheet-domain.test.ts tests/timesheet-rate-limit-service.test.ts tests/timesheets-api.test.ts tests/mobile-timesheets-route.test.ts tests/mobile-timesheets-cookie-auth.test.ts tests/data-client-pagination.test.ts` | Timesheet domain, service, HTTP, browser cookie authentication, and client pagination cases pass. Not executed as part of writing this plan. |
| V3, conditional | `npm test -- tests/actions.test.ts tests/actions-extra.test.ts tests/action-policy.test.ts` | Run for new or changed action coverage or a demonstrated transport-wiring gap. Inspect relevant assertions while writing the guide; do not imply they ran if only inspected. |
| V4, conditional | `npm run typecheck`; `npm run lint`; the focused test command for each changed test file | Required when TypeScript test files change. If coverage inclusion changes, use `npm run test:coverage` and preserve existing thresholds. |
| V5 | Resolve every new/changed relative Markdown link and referenced source symbol; repeat the two navigation drills | No broken navigation; Phase 4's correctness and improvement gates satisfied. Record results in the notes. |

For this documentation-first pass, production builds, live database tests, mobile platform builds, Playwright, accessibility, and performance runs are not required unless the scope changes. Label them **not run / outside this change's impact**, rather than passed.

The guide must retain escalation rules for future application work: shared contract/package changes require relevant server and mobile checks; application changes require compatibility with both backend builds; persistence/auth changes require regression coverage and the relevant PostgreSQL/Supabase evidence. Native integration uses a migrated database via `TEST_DATABASE_URL`; missing infrastructure means that gate is unavailable. Follow the existing integration and deployment workflows without inventing script names or treating mocked Supabase tests as live RLS proof.

## Out of scope and rollback

- Repository extraction, new services, package publication, directory moves, and new abstraction layers: the current boundaries already support this first pass.
- CODEOWNERS enforcement, branch protection, permissions changes, and CI filtering: explicitly deferred by the user. Current review and CI requirements remain in force.
- Authentication, authorization, sessions, API contracts, runtime data behavior, schemas, migrations, and deployment changes: no such change is needed to deliver the guide and validation workflow. There is no data migration or meaningful runtime security/operational change in the planned scope.
- Tool reinstallation, Understand Anything reconfiguration/full rebuild, new dependencies, and broad test-framework work: existing capabilities suffice.
- Remediation of every historical release gate: those need their own current evidence and scope.

Roll back with targeted reversions of this task's committed changes, or restore only its uncommitted hunks. Preserve the starting dirty tree. Never reset the repository, delete unrelated files, rewrite applied migrations, or drop an existing safety check. No phase requires an irreversible operation.

## Assumptions, stop conditions, and finish line

**Confirmed scope:** maintain one repository; first pass is navigation, ownership guidance, and focused validation; enforcement is deferred. **Unverified inputs:** owner identities and measured navigation improvement. Their handling is explicit in Phases 2 and 4.

Stop the affected workstream and report concrete evidence if current source no longer has the described package/domain boundaries, finishing would require production behavior or security changes, or the task encounters conflicting edits to its owned files that cannot be safely reconciled. Continue independent documentation work when possible. Log ordinary path/name drift and other conservative adjustments without pausing the entire task.

Reopen the architectural decision only for material new evidence: required source-access separation; sustained independent mobile ownership/release conflicts; or shared packages becoming independently consumed products. Any future mobile extraction needs an explicit replacement for local shared-package dependencies and a release/compatibility strategy.

Maintain a `## Deviations` section in the execution notes: what the plan said, what current code required, and the chosen adjustment. End those notes with one of **completed**, **blocked**, or **partial**, listing phase gates and evidence. Completion requires the linked guide, accurate context, usable ownership routing, demonstrated check selection, passing applicable checks, and the Phase 4 navigation result. Do not claim implementation complete merely because documents exist.

## Plan validation and review

Reviewed on 2026-09-15 against current source references, existing tests, manifests, and the user's scope answer. No application implementation was performed while creating this plan.

| Check | Resolution |
|---|---|
| Answers the request | Context and Phases 0–4 translate the one-repository recommendation into executable work and gates. |
| User answers incorporated | Both inputs are recorded: navigation/safe-change pain and the explicit deferral of enforcement. |
| Scope challenge | Out of scope removes extraction, enforcement, CI optimization, new tooling, and speculative tests. |
| Assumptions explicit | Evidence table, Phase 2 owner fallback, Phase 4 measurements, and stop conditions distinguish known facts from future evidence. |
| Verification | V0–V5 define commands, expected results, conditional checks, and limits. |

The review tightened three points: owner identities cannot be inferred; export/DTO checks are not behavioral database/mobile proof; and implementation needs a measured finish line. Completeness, feasibility, scope, testability, risk, and assumptions were checked against those resolutions. Runtime correctness and navigation improvement remain execution results to establish, not claims made by this plan.

### Review notes

Scores assess plan specificity and visible gaps, not completed implementation or guaranteed outcomes.

| Dimension | Initial review | Final review | Resolution |
|---|---|---|---|
| Completeness | 5/5 | 5/5 | Phase gates, recovery, ownership fallback, and an explicit finish line. |
| Feasibility | 4/5 | 5/5 | Source verification corrected the browser trace to `/api/v1/timesheets` and kept the compatibility route separate. |
| Scope | 5/5 | 5/5 | User-selected deferrals and conditional test additions remain explicit. |
| Testability | 4/5 | 5/5 | V2 now includes browser cookie-auth and client pagination tests for the actual browser path. |
| Risk | 5/5 | 5/5 | Preserve the dirty tree and existing checks; stop before production behavior changes. |
| Assumptions | 5/5 | 5/5 | Owner identities and observed improvement stay unverified until execution supplies evidence. |
