# Continuous bug audit

> Archived 2026-10-04 as supporting reference. Recorded evidence, contracts and
> unverified limitations retain their scope; this move marks no pending check complete.
> Current work follows the [active plans](../../README.md#active).

## T01 decision packet: complete JSON transport deadline

### Decision required and acceptance

Should the existing HTTP deadline cover response-body consumption as well as fetch?
Yes: one deadline must bound the complete fetch/JSON operation for both `request`
and `send`, including platform fetch implementations that ignore abort. Preserve
status/code mapping, invalid-JSON handling, default and per-call timeout values.
Refresh behavior, caller cancellation, and authentication protocols are out of scope.

### Current architecture and constraints

The platform-neutral `packages/client/src/api-client.ts` transport serves browser
cookie requests through `lib/data/client.ts` and mobile bearer requests through
`mobile/src/api/client.ts`. No persistence or backend selection changes are needed.
This localized packet uses the assigned source scope; broad Atlas/graph discovery
is unnecessary. The root `ASTRA_ARCHITECT.md` guidance requires bounded evidence;
no material architecture escalation is needed for this existing contract repair.

### Evidence and relevant symbols

- FACT: `fetchJson` clears its timer after `Promise.race([pending, timeout])`, then
  separately awaits `response.json()` (`api-client.ts`, original lines 117–124).
- FACT: runtime reproduction returned immediate headers and an unresolved JSON
  promise; a 5 ms transport deadline remained pending after 30 ms.
- FACT: `restoreBackup` passes 120,000 ms through `api.send` and maps timeout to an
  unknown-outcome message (`lib/data/client.ts`, lines 716–735).
- FACT: existing `tests/vsis-client.test.ts` deadline cases stall fetch, not JSON.
- INFERENCE: stalled bodies can indefinitely block loading and recovery paths.
- UNKNOWN: frequency of real production body stalls; no telemetry was consulted.

### Lifecycle invariant and alternatives

Activate one timer when transport starts. Race one operation encompassing fetch
and body parsing against its deadline. On normal completion or failure, clear the
timer. On expiry, abort best-effort and reject with the established `TimeoutError`
even if fetch or parsing ignores abort. Late settlements must have rejection
handlers and must not change the already-settled result. Each concurrent operation
owns its timer/controller; retries start separate transport operations as before.
No artifacts persist, and recovery remains the caller's existing responsibility.

- Selected: move JSON parsing inside the existing raced operation. One deadline,
  smallest change, no API migration or rollback complexity.
- Rejected: restart a timer for parsing; grants an extra timeout period and changes
  the meaning of the configured deadline.
- Rejected: depend only on abort; React Native Windows may ignore cancellation.

### Architecture delta and review request

No new boundary or public contract; this repairs the existing timeout promise.
Independent review should check body parsing, late rejection, timer cleanup,
abort-ignoring platforms, and preservation of invalid JSON/status/code behavior.

### Acceptance checks

Focused regressions: stalled body in `request` and `send`, timely body success,
invalid JSON, successful/failing operation cleanup, and late body rejection.
Run the shared transport/browser facade tests, relevant mobile timeout tests, and
the settled patch's required root verification matrix through the coordinator.

## Finding ledger

| ID | Source | Failure scenario | Repair | Verification | Remaining blocker |
| --- | --- | --- | --- | --- | --- |
| T01 | `packages/client/src/api-client.ts:fetchJson` | Headers arrive; body stalls beyond deadline | Race complete fetch/parse operation | Three regressions failed on original code; repaired transport/browser suite 48 pass, mobile API suite 18 pass, focused ESLint and diff check pass; root typecheck passes after invalid-JSON mock correction | Independent closure approved; final root coverage, lint and both backend builds passed |

### Implementation evidence

The settled implementation races an async fetch/parse operation against one
`Promise<never>` deadline and clears its timer in the outer `finally`. Parsing
fallback stays inside the operation; the timeout rejection stays outside it.
Eight added test cases cover both entry points, remaining deadline after delayed
headers, delayed-body success without subsequent abort, body timeout override,
invalid JSON fallback, fetch rejection cleanup, and late body rejection handling.
No caller or refresh behavior was changed. Tests were run against this final
transport/test file state. No commits were created.

## M1b transport decision: failed authentication ownership

- FACT: the original zero-argument refresh callback could not identify which
  request token produced a delayed 401. A current-generation check taken when the
  callback starts cannot distinguish an earlier account's request.
- Selected consolidated protocol: `RefreshAuth` accepts optional
  `failedAccessToken?: string`, preserving its exact synchronous/asynchronous
  return union and no-argument callback compatibility. Each request captures its
  refresh handler before resolving auth/fetching, then passes the token used by
  its initial fetch. Replacing or registering a handler mid-flight cannot redirect
  the pending operation into a different owner's handler.
- The mobile lifecycle owns generation/accepted-token tracking and rejects stale
  ownership by throwing. Same-generation rotated tokens remain eligible; latest
  token reuse avoids redundant refresh. Shared transport continues surfacing its
  original 401 when refresh throws. Null-return retry semantics are unchanged.
- Activation captures callback and auth. Normal completion keeps response
  contracts. Delayed 401 uses the captured callback/token, and owner rejection
  ends the attempt without another fetch. Existing one-retry and timeout rules
  stay intact. No shared account state, token registry, or persisted artifacts
  are added.
- Rejected alternative: compare against only the current token in shared
  transport; it has no session-generation knowledge and would reject legitimate
  same-session rotated-token requests. Rejected alternative: select the latest
  callback on delayed 401; it can cross account ownership after replacement.
- Verification: transport/browser suite 54 pass (six added protocol cases).
  Cases cover explicit and resolved failed tokens, synchronous/no-argument
  compatibility, replaced/new callbacks during pending fetch, stale A mutation
  rejected after B login with zero retry, and successful/anonymous/one-retry limits.
  Shared scoped lint, root typecheck and diff whitespace checks pass. Consolidated
  lifecycle closure and full settled matrix remain pending.


## Settled batch verification — 2026-10-01

T01 (whole-response deadline), M2 (reopened date shortcuts), and M1/M1b/M1c
(session ownership, ordered persistence, retry ownership and status/refresh
ordering) have independent Sol 6.1 closure approval. All roles used Sol 6.1 with
user approval because Luna 6 was unavailable. No commits or deployment actions.

Final checks on the settled source:

- Root coverage run: 142 test files / 1,623 tests passed; 13 files / 60 tests skipped.
  Coverage gates passed: 72.42% statements, 63.87% branches, 79.61% functions,
  75.92% lines.
- Root lint and TypeScript checking passed; Supabase and native production builds
  passed with CI-equivalent compile-only configuration.
- Standard mobile and Windows configurations: each 49 suites / 324 tests passed.
- Mobile TypeScript and Windows bundle passed. Mobile lint: 0 errors, 45 existing
  warnings, matching the starting baseline.
- Database/live integration checks lack TEST_DATABASE_URL and provider fixtures;
  authenticated Playwright lacks E2E credentials. Those checks were not verified.

These settled results supersede intermediate failures and pending-check notes in
this packet and the linked session/date decision packets. The continuous audit
remains active; this is one bounded batch, not a claim that the repository has no
remaining defects.

## Settled second batch — 2026-10-01

| ID | Verified failure | Repair | Status |
| --- | --- | --- | --- |
| B01 | Invalid bulk dates abort valid rows; rejected edits remove unchanged hours from projections | Validate eligible unique candidates before queries and recompute admissions until stable | Independently approved, verified |
| B02 | Bulk persistence error becomes false zero-update success | Existing STORAGE_ERROR result and reservation refund | Independently approved, verified |
| B03 | Committed duplicate read-back failure reports failure/refunds its write | Narrow post-create read-back fallback preserves committed success/count/charge | Independently approved, verified |

Final root coverage: 143 files / 1,642 tests passed; 13 files / 60 tests skipped.
Coverage gates passed (72.57% statements, 64.06% branches, 79.65% functions,
76.07% lines). Root lint, TypeScript, and both Supabase/native production builds
passed. Integration/E2E prerequisites remain unavailable. Mobile/shared-client
source did not change in this batch, so the prior settled 324-test standard and
Windows runs and bundle verification remain applicable.

B04 is now the next verified finding: malformed IDs enter UUID persistence
queries and can abort mixed batches. Initial reviewer approved isolating invalid
IDs in both adapters while retaining opaque domain contracts and PostgreSQL's
accepted input spellings. Primary compatibility evidence:
https://www.postgresql.org/docs/16/datatype-uuid.html and the PostgreSQL 16 parser.
Implementation and independent closure are now verified; live-database parity
remains unavailable.

## Settled third batch — 2026-10-01

B04 isolates malformed database UUIDs in native and Supabase bulk lookups while
preserving actor scope and opaque domain contracts. Independent closure approved.
Parser tests cover 512 accepted spelling combinations and malformed/trailing
input; actual-domain adapter tests retain valid edits in mixed batches.

Root coverage: 145 files / 1,683 tests passed; 13 files / 60 tests skipped.
Coverage gates passed (72.65% statements, 64.26% branches, 79.69% functions,
76.10% lines). Root lint, type checking, and both backend production builds passed.
Live database and E2E prerequisites remain unavailable. Mobile/shared-client
source did not change, so prior settled mobile checks remain applicable.

## Settled fourth batch — 2026-10-01

B05 fixes reminder PATCH truthiness coercion. Personal reminder updates now require
an explicit boolean `done`; missing, string, numeric, null, array, and object values
return the existing validation error instead of silently toggling state. The shared
domain validation applies to both native and Supabase persistence. The compatibility
`/api/data/reminders` PATCH transport now returns HTTP 400 with field errors for the
same invalid inputs, matching the versioned `/api/v1` behavior.

Sol 6.1 initial audit verified the failure and compatibility-path gap. A fresh Sol
6.1 closure review approved the settled delta with no actionable findings and
independently passed 72 focused tests. Root verification after synchronizing the
merged dependency lockfile passed with 145 files / 1,699 tests; 13 files / 60 tests
were skipped. Coverage gates passed (72.68% statements, 64.30% branches, 79.69%
functions, 76.10% lines). Root lint, TypeScript, and both Supabase/native production
builds passed on Next 16.3.8. Live database and authenticated E2E prerequisites
remain unavailable.

## Settled fifth batch — 2026-10-01

B06 closes destructive coercion in bearer/mobile admin-user mutations. Supplied
`isActive` must now be a boolean before account creation or profile update, so
values such as `"false"`, `null`, numbers, arrays, and objects cannot activate or
deactivate accounts through JavaScript truthiness. Supplied `managerId` must be a
string or null, so malformed values cannot silently clear an existing reporting
line. Omitted create status still defaults active; omitted PATCH fields remain
unchanged; explicit `false`, explicit `null`, valid/blank manager strings, existing
self-role/status guards, hierarchy checks, and atomic persistence semantics remain
unchanged.

The pre-fix route reproduction added 16 malformed cases: create cases progressed
into later provider work and update cases reached profile lookup instead of being
rejected. After the service-boundary repair, the admin-user route suite passes 31
tests. A fresh Sol 6.1 closure reviewer approved the delta with no actionable
findings and independently passed 82 related route/domain tests.

Settled root verification: 145 test files / 1,717 tests passed; 13 files / 60 tests
skipped. Coverage gates passed (72.73% statements, 64.46% branches, 79.71%
functions, 76.14% lines). Root lint and TypeScript passed; both Supabase and native
production builds passed on Next 16.3.8. Live database and authenticated E2E
prerequisites remain unavailable.

## Settled sixth batch — 2026-10-01

REF-ACTIVITY closes bearer/mobile activity-type PATCH coercion and partial-write
behavior. Supplied `name` must be a string, supplied `isActive` must be boolean,
and supplied `telegramNo` must be null or a positive integer. The domain now
preflights the complete patch before its first persistence mutation, so a valid
rename cannot commit before a later invalid field is rejected. Explicit null and
positive Telegram numbers retain their existing behavior.

REF-TITLE closes bearer/mobile title reclassification truthiness coercion.
Supplied `syncUsers` must be boolean; omission still defaults to false. Malformed
values such as `"false"`, numbers, null, arrays, and objects are rejected before
title persistence or profile hierarchy-role synchronization can begin.

Pre-fix regressions reproduced 16 failures. The settled focused route/domain
matrix passes 4 files / 114 tests, including the admin-user regression suite.
Root TypeScript checking passed. Root coverage passes with 145 test files / 1,739
tests; 13 files / 60 tests skipped, with 72.81% statements, 64.73% branches,
79.71% functions, and 76.21% lines. Root lint passed after this patch. Supabase
and native Next.js 16.3.8 production builds also passed after this patch; the
Supabase build used the established compile-only Auth-config bypass.

The previously-started independent Sol 6.1 closure reviewer could not be
retrieved after the session context changed because collaboration-agent tools
were no longer exposed. Local reviewer fallback had already failed
deterministically because the Codex home directory could not be resolved, so it
was not retried. Live database and authenticated E2E prerequisites remain
unavailable. No commits or deployment actions were performed. This iteration is
closed here per the user's stop-after-current-iteration instruction.

## Pre-push verification — 2026-10-03

The user authorized committing and pushing the remaining related audit files.
The combined patch passed root lint, root TypeScript checking, and root coverage:
145 test files / 1,739 tests passed; 13 files / 60 tests skipped. Coverage gates
passed with 72.81% statements, 64.73% branches, 79.71% functions, and 76.21% lines.
Mobile lint passed with 0 errors / 45 warnings; mobile TypeScript checking passed.
Both mobile Jest configurations passed 54 suites / 381 tests each, and the Windows
production JavaScript bundle passed. Supabase and native production builds passed
using the existing CI compile-only placeholder configuration; the Supabase build
used the explicit Auth-configuration bypass. Live database checks remain
unavailable without TEST_DATABASE_URL. Authenticated E2E, device acceptance, and
native Windows rendering checks were not performed.
