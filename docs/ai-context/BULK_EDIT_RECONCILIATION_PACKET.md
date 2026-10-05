# Bulk edit reconciliation repair decision packet

## Decision Required

How should EntriesTable refuse reuse of retained snapshots until its current-scope page read succeeds?

## Why This Decision Is Needed

Carson's P2: a successful project A→B batch followed by failed reconciliation leaves A displayed. A subsequent activity-only batch copies every field from A and can revert B. Acceptance: refuse the second write, then allow an activity edit preserving B after a successful retry.

## Current Architecture / Evidence

- FACT — `lib/dashboard-timesheets.ts:createTimesheetPageReader` retains rows on failed refresh and exposes loading/error.
- FACT — `app/dashboard/dashboard-client.tsx` supplies current-scope loading/error and parent-owned mutation locks to EntriesTable.
- FACT — `app/dashboard/entries-table.tsx` retains selection, editor and modal snapshots; history completions use generation fences.
- FACT — `app/dashboard/bulk-edit-modal.tsx:runBulkEditMutation` captures primitive fields and owns locks through reconciliation, including failed reads.
- FACT — `e2e/bounded-dashboard.spec.ts` intercepts all browser API traffic and supplies a production native fixture.
- INFERENCE — controls alone cannot reject an already captured confirmation callback. Read-context identity must fence handlers too.

## Constraints / Relevant Existing Decisions

Baseline `db0c25e`; bounded P2 repair only. Preserve backend APIs, session/generation fences, parent locks and retained read-only display. Installed Next client directive documentation was read. No migrations, operational helpers, delegation, staging or commits.

## Alternatives / Decision

Choose a ready read context (`!loading && !readError`) with identity changed on scope/loading/error transitions. Handler closures must match the latest committed context and current session. Invalidate reusable snapshots at unavailable transitions; preserve an already submitted bulk modal and captured lock-release callbacks. Alternatives: hiding retained rows loses useful display; changing payload/backend contracts expands scope and does not address stale delete confirmations.

## Lifecycle / Known Risks

- Activation: only a successful current-scope read permits selection and snapshot actions.
- Submission: capture and lock the batch synchronously; clear reusable selection.
- Success: keep locks through reconciliation, discard the submitted modal on completion.
- Failed reconciliation: retain read-only rows; invalidate selection/history/editor/confirmation/unsubmitted modal, reject all snapshot handlers.
- Retry: unavailable while loading; successful read enables fresh snapshots, never revives old ones.
- Stale artifacts: invalidate history/latest generations and fence saved confirmation/modal callbacks across recovery.
- Concurrent transitions: read invalidation must not release captured in-flight batch locks; session fences continue to prevent old-session follow-up reads.

## Architecture Delta / Scout Synthesis

Local UI invariant repair against the supplied clean baseline; no persistence/public-contract delta. Root verified the stale-field path; this packet uses directly scoped source rather than repeating architecture discovery.

## Validation / Unresolved Questions

Mock browser acceptance covers A→B, failed read, blocked activity-only write, recovery preserving B, loading, stale dialogs and pending history. Focused lifecycle/reader unit tests, TypeScript and scoped lint run locally. Root rebuilds native and runs browser tests after ownership return; production browser execution remains unverified until then.

## Implementation / Verification Evidence

EntriesTable now fences selection and snapshot handlers by committed read-context identity and session. Loading/failure discards reusable selection, history, editors and dialogs; a submitted bulk modal retains its locks through reconciliation. Edit Last's ID-only navigation intent resolves against fresh destination rows and is discarded on failure.

Passed: 32 focused tests in `tests/dashboard-timesheets.test.ts` and `tests/bulk-edit-lifecycle.test.ts`; scoped ESLint; `tsc --noEmit`; diff whitespace check; Playwright test discovery. No backend/database operations or migration checks were run. Root must execute the native mocked browser suite; new test filter: `failed bulk reconciliation|loading invalidates stale`.

Root integration completed: full application coverage (1,927 passed, 61 skipped),
root/test lint, both backend builds and all 18 distinct mocked browser scenarios
passed. One project-picker locator was corrected before the focused browser
rerun. Carson's independent closure accepted the source and browser evidence,
with no unresolved material finding. See
[review evidence](../../migrations/evidence/independent-review-2026-10-05.md).
