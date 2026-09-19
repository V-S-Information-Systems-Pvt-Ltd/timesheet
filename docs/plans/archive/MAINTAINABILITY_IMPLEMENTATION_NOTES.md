# Maintainability implementation notes

## Baseline

- Started: 2026-09-17.
- Branch: `arch/maintainability-improvement` (the requested name contained a
  space, which Git rejects; the valid hyphenated equivalent was used).
- HEAD at implementation start: `c319473ba02070cc213e6e1a67550ce5811bcf69`.
- Pre-existing change preserved: `docs/README.md` had one deletion from the
  preceding completed-plan cleanup task. No application files were changed by
  this task before the baseline.
- Tooling available: Atlas `0.2.1-alpha`, Serena TypeScript project metadata,
  Node `v24.19.0`, npm `11.19.0`.
- Atlas baseline: `atlas . --budget 2048` completed and identified the shared
  packages, `lib/data/client.ts`, the timesheet domain, and both persistence
  adapters.

## Phase 0 — navigation drills

These are bounded local command timings, not a claim about a user's typing or
reading speed. Both drills started from `docs/README.md` and used the same
search approach before the guide was added.

### Drill 1 — timesheet create/update rules

- Prompt: locate implementation and checks for daily-hour limits, inactive
  actors, and editing another user's entry.
- Elapsed bounded search: 351 ms.
- Source identified: `app/actions/timesheets.ts`,
  `lib/domain/timesheets.ts`, `lib/db/timesheets.ts`, and action/domain test
  files. The source search found the relevant assertions, but the docs entry
  point exposed no timesheet implementation spine.
- Unrelated or misleading navigation: the docs index led into archived plan
  links and mobile/architecture documents before source search; it did not
  distinguish Server Actions, the current `/api/v1/timesheets` browser path,
  and the compatibility route.
- Selected checks: V1 plus V2; action checks were selected for the Server
  Action path.

### Drill 2 — timesheet response-field change

- Prompt: locate the shared contract, server mapping, and web/mobile consumers
  affected by a timesheet response-field change.
- Elapsed bounded search: 263 ms.
- Source identified: `packages/contracts/src/timesheets.ts` and `index.ts`,
  `lib/api/v1/contracts.ts`, `packages/client`, `lib/data/client.ts`,
  `mobile/src/api/`, and mobile screens/tests. The docs entry point named
  mobile and shared behavior generally but did not expose these package edges.
- Unrelated or misleading navigation: the old index described backend-selected
  browser data and linked several plans from paths that no longer exist at the
  root of `docs/plans`.
- Selected checks: V1 plus the shared-client and mobile type/test checks when
  contract or consumer files change.

## Verification recorded during implementation

- V1: `npm test -- tests/boundary-enforcement.test.ts tests/domain-adapter-contracts.test.ts tests/mobile-contract-parity.test.ts`
  passed 3 files / 21 tests. The first sandbox attempt hit Windows Vite
  `spawn EPERM`; the identical retry with process-spawn permission passed.
- V2: `npm test -- tests/timesheet-domain.test.ts tests/timesheet-rate-limit-service.test.ts tests/timesheets-api.test.ts tests/mobile-timesheets-route.test.ts tests/mobile-timesheets-cookie-auth.test.ts tests/data-client-pagination.test.ts`
  passed 6 files / 68 tests with process-spawn permission.
- V4 supplemental checks: `npx tsc --noEmit` passed and `npm run lint` passed.
- V5 link check: all relative Markdown links in the changed documentation
  resolved; `git diff --check` reported no whitespace errors.
- Review follow-up: the focused suite was rerun after adding the v1 malformed
  query assertion; 9 files / 90 tests passed. `npx tsc --noEmit`, `npm run lint`,
  and `git diff --check` also passed.

## Phase 4 — repeat navigation drills

- The repeat measurements below were run from the new guide in the same
  implementation context. No independent reader/session evidence or equivalent
  tool/model record was captured, so these observations do not satisfy the
  plan's fresh-reader Phase 4 gate.
- Drill 1 repeated from the new guide in 234 ms. It led directly to the
  Server Action, v1 service, domain, narrow port, composition helper, adapter,
  and focused test locations. This is 117 ms faster than the 351 ms baseline
  bounded search.
- Drill 2 repeated from the new guide in 85 ms. It led directly to the shared
  contract, server mapper, typed client, browser mapper, mobile re-export,
  consumers, and parity tests. This is 178 ms faster than the 263 ms baseline
  bounded search.
- Both drills identified the intended boundaries and checks in the recorded
  walkthrough. The measurements support a provisional local navigation
  improvement only; they do not claim fewer production regressions or replace
  the required independent-reader run.

## Deviations

- Git cannot create `arch/maintainability improvement` because spaces are not
  valid in ref names. The implementation branch is
  `arch/maintainability-improvement`.
- No maintainer identities were inferred from Git authorship. The guide uses
  role-based review routing and marks named ownership as unconfirmed.
- The source has a dynamic `/api/v1/timesheets/[id]/route.ts` in addition to
  the collection route named in the plan; the guide includes both so update and
  delete navigation is complete.

## Final status

Phases 0–3 are completed — the guide, ownership routing, check map, corrected
context/index documents, baseline evidence, and applicable verification gates
are recorded. Phase 4's independent-reader gate remains outstanding. Named
maintainer identities and hosted/device/database evidence remain explicit
follow-up items outside this documentation-first scope.
