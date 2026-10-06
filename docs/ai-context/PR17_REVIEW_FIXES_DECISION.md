# PR17 confirmed review fixes

## Decision required and boundary

Restore the existing offline replay lifetime and session boundary, guard unsaved
personal/workspace layouts on every navigation path, and keep themed admin status
text readable. Baseline: `6db1fae2ff19642f5799ef07859f4e6b01960c92`, branch
`codex/pr17-review-fixes`. Root supplied the decision packet and confirmed probes;
implementation is confined to mobile runtime, focused tests, and these notes.
No API, database, migration, dependency, or transport changes.

## Evidence and selected protocol

- FACT — `mobile/src/sync/sync-engine.ts: resolveMutation` used queue recovery
  execution without the 90-day check in `flush`. Queue `createdAt` is immutable
  (`mobile/src/storage/offline-queue.ts: retryMutation`); the server ledger's
  default retention is 97 days (`lib/idempotency`). Root's 100-day probe sent
  again. A same-key replay after ledger cleanup can execute the mutation again.
- FACT — `resolveMutation` wrapped `ApiClientError` in a plain Error and
  `mobile/src/auth/SessionProvider.tsx: resolveMutation` bypassed `withAuth`.
  This lost terminal 401 identity and session-generation cancellation.
- FACT — `mobile/src/screens/LayoutCustomizerScreen.tsx` compared only personal
  modules with a saved snapshot. Workspace changes and shell/hardware/tab exits
  bypassed its local discard dialog. The existing shell/reducer already guards
  entry forms through `onDirtyChange`.
- FACT — warning text `#F59E0B` on `#FFFBEB` measured 2.07:1; success text also
  reused a fill token. Admin badge and settings consumers use the runtime palette.

Reuse one finite-timestamp/90-day boundary for flush and manual resolution. Refuse
expired or malformed manual-review items before execution, leaving their stored
bytes unchanged. Recent same-key success dequeues; unresolved responses retain
the item. Preserve API error identity for the authenticated wrapper. Resolution
runs through `withAuth`; a terminal 401 signs out with the existing visible reason.
Generation checks suppress stale dashboard/queue publication after a session
transition, including a transition during the queue-summary read.

Track independent personal/workspace saved snapshots and combine both dirty
comparisons regardless of the visible scope. Workspace loading seeds its snapshot;
successful save/reset updates only that scope, while personal state follows the
existing provider response. Failures retain edits. The app supplies optional
`onDirtyChange` and owns the single header/hardware/tab discard confirmation;
standalone consumers retain the local dialog. Reducer behavior and clean Android
root-tab exit remain unchanged.

Add `successText` and `warningText` palette tokens and use them only for affected
admin text. Existing fill/border tokens remain unchanged. Light values are
`#047857` / `#92400E`; dark values are `#6EE7B7` / `#FCD34D`.

## Alternatives and constraints

Rejected extending ledger lifetime or replacing uncertain mutations with fresh
keys: those change persistence/replay safety beyond this scope. Reuse the existing
authenticated lifecycle and shell reducer rather than introducing a parallel
session/navigation mechanism. Dedicated text tokens preserve existing fills;
changing shared success/warning colors globally would affect unrelated surfaces.

## Finding ledger and acceptance evidence

| ID | Failure scenario | Fix | Focused verification |
| --- | --- | --- | --- |
| F1 replay | Expired/malformed manual recovery resends after retention | Shared absolute age guard before queue execution | `manual-review-resolve.test.ts`: 100-day, inclusive 90-day and invalid dates for leave/update send zero and retain exact storage; recent success dequeues; unknown retains |
| F2 layout | Workspace edits or shell exits lose unsaved work | Both snapshots, combined dirty state, optional shell wiring | `layout-review-guards.test.tsx`, `layout-customizer-screen.test.tsx`, `discard-guard-shell.test.tsx`: scope switching, clean load, failed save, successful save/reset, other-scope edits, cancel preservation and one confirmed header/tab/hardware exit |
| F3 auth | Recovery 401 loses expiry handling; stale completion affects new session | Preserve API errors, use `withAuth`, fence queue summaries | `session-expiry-message.test.tsx`: visible sign-out reason and retained queue; success refresh; old success/401 completion cancels after another account signs in |
| F4 contrast | Admin status text reuses bright fill colors | Dedicated themed semantic text tokens | `theme-tokens.test.tsx`: both text tokens >=4.5:1 on card/background and respective status box; affected admin screen suites |

## Final verification / rollback

Both complete mobile Jest workflows passed: 66 suites / 476 tests each. Mobile
typecheck passed; lint passed with 0 errors and the same 42 existing warnings.
Independent closure review found no material issues. Windows release JavaScript
bundling passed using a temporary Metro config that adds the linked dependency
paths to watchFolders; the ordinary command initially failed because this isolated
worktree links dependencies outside its watched roots. No application build config
was changed. Device runtime remains unverified. No live server or database
verification is needed for this mobile-only patch. Rollback is the scoped source
and test delta; queue data, public transport and schema are unchanged.
