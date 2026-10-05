# Plan: Duplicate UX & mutation latency

## Context & goal

On the web dashboard, mutating a timesheet entry (duplicate, edit, delete) feels
slow because every action is a **two round-trip** sequence with no optimistic
feedback:

1. Click → `duplicateEntry(id)` / `updateTimesheet(...)` / `deleteTimesheet(id)`
   (round-trip 1).
2. `onChanged()` → `fetchTimesheets()` — a **full refetch** of the entries list
   (round-trip 2; for admins/COs this is *every* user's rows).
3. Only then does the row appear / change / disappear.

Logging a new entry already feels instant because `handleLogged`
(`app/dashboard/page.tsx:243`) is optimistic: it inserts a temp row, refetches,
and drops the temp row if the refetch fails. This plan brings that same pattern
to **duplicate, edit, and delete**, and fixes concrete correctness bugs found in
the bulk-duplicate path.

Chosen scope (user: "Everything incl. #5"):

1. **Optimistic per-row duplicate** — row appears instantly on click.
2. ~~Parallelize bulk duplicate~~ → **superseded, see Decision 1.** Kept
   sequential; optimism removes the perceived latency instead.
3. **Fix bulk-duplicate partial-failure** — always refetch + report, like
   `performBulkDelete` already does.
4. **Pending state + double-fire guard** on per-row duplicate.
5. **"Duplicate to a chosen date"** on web — requires a `targetDate` param on
   the `duplicateEntry` Server Action, a date dialog, and action tests.
6. **PLUS: optimistic edit & delete** (single-row), and optimistic bulk delete
   (same reconcile pattern).

## Key decisions (evidence-backed)

### Decision 1 — bulk duplicate stays SEQUENTIAL (backend parity)

The 24h daily cap is enforced by a DB trigger on both backends, but **only the
native trigger serializes concurrent same-user/date writes**:

- Native — `db/migrations/0015_data_integrity_and_concurrency.sql`:
  `perform pg_advisory_xact_lock(hashtext(NEW.user_id || ':' || NEW.log_date))`
  before the sum check. Concurrent same-day writes are serialized; the
  `tests/daily-hours-concurrency.int.test.ts` proves exactly one of two
  jointly-over-cap inserts wins.
- Supabase — `supabase/migrations/20260823000000_daily_hours_trigger.sql`: the
  same function with **no advisory lock** — a plain read-then-check, i.e. a
  TOCTOU race under concurrency.

Web duplicates land on the **same date** by default (the common case), so firing
them with `Promise.all` would open a 24h-cap race on the Supabase backend.
Adding an advisory lock to Supabase is an out-of-scope schema/deploy change, and
`AGENTS.md` makes "preserve backend behavior and authorization parity" a hard
constraint. Since optimistic UI already removes the *perceived* latency (rows
appear instantly; the server calls run in the background), parallelism is a
marginal win not worth the parity risk. **Bulk duplicate remains sequential.**

### Decision 2 — reconcile is the source of truth; temp rows carry fake ids

Mirror `handleLogged`: optimistically mutate the parent `timesheets` array, fire
the Server Action, then `await onChanged()` (the existing full refetch) to
replace the array with server truth. `fetchTimesheets()` already returns a
`boolean` (`false` = failed or superseded by a newer fetch) guarded by
`fetchSeqRef`. Rollback rules:

- **Duplicate** (new row has a **fake** `temp-…` id): success → refetch swaps
  temp→real; if refetch fails, **remove** the temp row (never leave a fake-id
  row that Edit/Delete could target). Server error → remove temp.
- **Edit** (row id is **real**): success → optimistic value already matches what
  we sent, so keep it even if refetch fails. Server error → restore the
  pre-edit snapshot in place (no ordering change).
- **Delete** (row id is **real**): success → stays removed. Server error →
  re-insert the removed row (bulk: the final refetch restores any that failed).

### Decision 3 — reuse `PromptDialog` for "duplicate to date"

`PromptDialog` (`app/components/confirm.tsx`) already has the re-seed-on-open,
focus-trap, and form-submit behavior. Extend it with a minimal, backward-
compatible `inputType?: 'text' | 'date'` (default `'text'`) so it can render a
date field. No new dialog component / file.

### Decision 4 — toast tones

`app/components/toast.tsx` supports `success | error | info` only (no
`warning`). Partial-failure summaries use `error`; all-success uses `success`.

## Implementation decision packet — optimistic lifecycle

**Decision required:** How can optimistic rows remain safe during overlapping refreshes,
server rejections, transport failures, retries, and bulk partial completion?

**FACT:** `page.tsx:145` replaces the list on refresh; `entries-table.tsx:318`
adds temporary IDs before awaiting writes. A plain replacement can erase another
pending operation. Rows with temporary IDs must never reach Server Actions.
**FACT:** Returned `{ error }` and rejected promises are different failure paths;
a bulk-delete rollback cannot depend solely on a successful refresh.
**INFERENCE:** Keep parent-owned pending overlays and row locks. Merge pending
rows into fresh server reads. Clear overlays on settlement; invalidate older reads
only for committed writes, always followed by reconciliation. Returned rejection
must not cancel another operation's refresh. Keep snapshots for immediate rollback
and retain rejected edit drafts for correction.

**Alternatives:** Full-list snapshots would overwrite unrelated writes; a global
lock would unnecessarily block other rows; parallel bulk requests would not improve
Next.js client dispatch (the installed Server Actions guide documents sequential
dispatch) and could undermine the Supabase daily cap if moved server-side.

**Chosen lifecycle:** Begin → overlay + parent-owned synchronous row lock → action
→ settlement (invalidate older fetches only on commit) → committed/uncertain writes
refresh with other pending overlays retained → unlock. On returned rejection,
restore the affected snapshot/draft or remove the temp row, then settle without
canceling another operation's read. On a
transport failure, roll back and attempt refresh because commit status is unknown;
do not automatically retry a possibly committed duplicate. Bulk processes every
row sequentially, restores failures directly, refreshes once, and reports counts.
Temporary rows display “Saving…” and are excluded from selection and mutation.
Settlement is idempotent: invalidate older reads only when removing an existing
pending overlay for a committed write. Temporary-row cleanup must not create a deletion overlay or
invalidate a different operation's newer refresh. The data facade deduplicates
in-flight GETs; reconciliation waits out any pre-write request before starting a
fresh one. The overlapping-duplicates browser regression verifies both invariants.

**Constraints/non-goals:** No persistence/auth changes, no new backend endpoints,
no mobile changes. Existing action names and same-date default remain unchanged.
**Unknown:** Live backend credentials/connectivity; report browser verification
limitations rather than treating mocked checks as backend integration evidence.
**Acceptance:** Tests for target-date validation/policy, overlay merging, pending
rows; lint/typecheck/full tests/both builds; browser success/failure/partial flows.

## Closure repair decision packet — consolidated invariants

The closure review identified six verified gaps. Resolve them together rather
than separately changing refresh scheduling:

| ID | Failure scenario / evidence | Resolution and acceptance |
| --- | --- | --- |
| C1 | A duplicate refresh is invalidated by B's rejected edit/delete settlement (`page.tsx:195`, table rejection paths). | Settlement distinguishes committed vs rejected writes. Only commits invalidate pre-write GETs; every committing path schedules reconciliation. Mixed-success/rejection overlap test. |
| C2 | `crypto.randomUUID` is secure-context-only; bulk locks are acquired before ID generation. | Local timestamp + monotonic counter temp IDs (not security tokens), generated before acquiring batch locks. Browser test with UUID unavailable. |
| C3 | Child-owned locks disappear on tab remount while actions continue. | Parent owns the mutable lock set and rendered busy state; child fallback only for standalone callers. Remount test with action held. |
| C4 | Rejected delete prepends an older row, corrupting list order / Edit Last. | Remember last authoritative server ID order; restore real rows within that order while pending new rows stay at the front. Ordering unit/browser tests. |
| C5 | Canceling the editor before sending discards a rejected draft. | Capture draft strings and editor generation; reopen rejected draft unless another editor was started meanwhile. Draft-retention browser test. |
| C6 | Source-date write checks prevent copying an old owned row to a writable target. | Ownership-only chosen-date copy eligibility, separate from edit/delete and same-date eligibility. Server still validates destination window and daily cap. Regular-user old-source regression. |

**Alternative rejected:** refreshing every rejected write would fix C1 but adds a
round trip for validation rejection and does not clarify the commit/read invariant.
**Lifecycle:** locks begin before optimistic feedback and survive child unmount;
returned rejection restores local truth/draft and settles without invalidating
other reads; committed success invalidates old reads exactly once and reconciles;
transport uncertainty restores local feedback and reconciles without auto-retry.
**Bounds:** no schema/auth/repository/mobile changes. All earlier transport and
partial-batch regressions remain acceptance checks. No additional broad review is
needed unless a named unresolved correctness risk remains.

## Changes by file

### 1. `app/actions/timesheets.ts` (Server Action)

- `duplicateEntry(entryId: string, targetDate?: string)`.
- Add `import { isValidISODate } from '@/lib/validation'` (canonical app-side
  path; re-exports `@vsis/core`).
- After the actor gate, before the domain call:
  `if (targetDate !== undefined && !isValidISODate(targetDate)) return { error: 'Invalid date. Use YYYY-MM-DD.' }`.
- Forward `targetDate` to `duplicateTimesheetEntry(actor, entryId, targetDate, timesheetDeps())`.
  The domain already supports `targetDate` (`lib/domain/timesheets.ts`), and
  passing `undefined` preserves exact current behavior. The `app/actions.ts`
  barrel re-exports by `Parameters<typeof …>`, so the new optional param flows
  automatically — no barrel edit needed.

### 2. `app/components/confirm.tsx`

- `PromptDialog`: add `inputType?: 'text' | 'date'` prop (default `'text'`);
  render `<Input type={inputType} …>`. Existing callers unaffected.

### 3. `app/dashboard/page.tsx` (state owner)

- Memoized insert/update/remove mutators maintain both `setTimesheets` and a
  pending overlay keyed by ID. Inserts deduplicate real IDs on rollback.
- `settleTimesheet(id, committed)` removes an existing overlay and invalidates
  pre-write reads exactly once on commit. Rejections don't cancel other reads;
  temporary-row cleanup creates no tombstone. Real-row rollback restores the
  last authoritative server ID order while keeping pending new rows first.
- Dashboard-owned mutation locks and busy-state copies survive table unmounts;
  standalone table callers retain a local fallback.
- `fetchTimesheets` waits out an existing GET before starting a new one (the
  facade uses single-flight deduplication), rejects stale results and missing
  data, then merges current pending overlays over the returned server rows.
- Pass `onOptimisticInsert/Update/Remove/Settled` to `EntriesTable`.
- Clear pending state and invalidate in-flight reads when signing out.
- `lib/optimistic-timesheets.ts` contains the pure overlay merge; focused unit
  tests cover inserts, edits, deletes, missing rows, and settled server truth.

### 4. `app/dashboard/entries-table.tsx` (primary)

- Imports: add `Spinner` (from ui), `PromptDialog` (from confirm).
- Props: add optional `onOptimisticInsert/Update/Remove`; widen
  `onChanged: () => void` → `() => void | Promise<boolean>` so handlers can read
  the reconcile result (`ok === false` ⇒ rollback).
- State: prefer dashboard-owned `mutationLocks` / `busyIds` / `onBusyChange`
  shared by single-row and bulk mutations; `duplicateDateTarget` controls the
  date dialog. An editor generation prevents restoring a rejected draft over
  another editor started while the action was pending.
- `handleDuplicateEntry(t, targetDate?)`: ownership and lock guards; build a
  `temp-…` clone with a local timestamp/counter ID (no secure-context dependency),
  optimistic insert, call
  `duplicateEntry(t.id, targetDate)`, reconcile/rollback per Decision 2; spinner
  via `dupBusyIds`.
- `handleDuplicateSelected` (bulk, **sequential**): optimistic-insert a clone per
  picked row up front; run duplicates sequentially; track `failed`/`lastError`;
  **always** reconcile + `clearSelection()` + report (fixes the partial-failure
  bug where it returned early leaving stale UI); remove temp rows for failures
  and, if the refetch fails, all remaining temps.
- `handleUpdateEntry`: capture edit values, `cancelEdit()`, optimistic
  `onOptimisticUpdate` (including nested `projects.name`/`activity_types.name`
  from `projectById`/`typeById`), call `updateTimesheet`, rollback to snapshot and
  reopen the submitted draft on error unless another editor was started.
- `performDeleteEntry` / `performBulkDelete`: optimistic removal before the
  call; immediately restore snapshots on returned errors or transport failure,
  settle overlays, then reconcile. Bulk always refreshes and reports success /
  failure counts; failed rows remain visible even if the refresh also fails.
- Shared row locks block edit/delete/duplicate overlap on the same source row,
  including selected-row operations and the Edit Last / Undo Last helpers.
- Pending temporary rows show “Saving…” and cannot be selected or mutated.
- `refreshEntries` handles rejected refresh promises; transport errors trigger
  rollback and reconciliation, with an uncertain-commit message and no retry.
- The `D` shortcut ignores the hidden navigation drawer when checking whether
  a modal is open; visible dialogs still suppress table shortcuts.
- "Duplicate to date": desktop adds an `IconCalendar` hover button
  ("Duplicate to date…") opening the dialog seeded to the row's `log_date`;
  mobile menu adds a "Duplicate to date…" item. The dialog's `onSubmit(date)`
  calls `handleDuplicateEntry(target, date)`. Older owned source rows are eligible
  even outside the edit window; the destination policy is enforced server-side.
  Edit/delete and same-date copy remain disabled on non-writable source rows.
- Keep same-date Duplicate button + `D` shortcut (now optimistic + partial-safe).

### 5. `tests/actions.test.ts` — `describe('duplicateEntry')`

- **forwards a valid `targetDate`**: admin duplicates with an explicit
  `targetDate`; assert `createTimesheet` called with `logDate: targetDate`
  (proves the param overrides the source date).
- **rejects an invalid `targetDate`**: `duplicateEntry('entry-1', '2026-02-31')`
  returns `{ error: 'Invalid date. Use YYYY-MM-DD.' }` and neither
  `getTimesheet` nor `createTimesheet` is called (guard short-circuits before the
  domain). `isValidISODate` rejects rolled-over dates.

## Out of scope / boundaries

- No parallelism (Decision 1). No Supabase migration.
- `deleteLastEntry` / undo-last stays non-optimistic (the client's "latest" may
  differ from the server's; not worth the mismatch risk).
- No change to mobile (`mobile/`), repository, or auth layers.

## Verification

- `npm run lint`, `npm run typecheck`.
- `npm run test` (focus `tests/actions.test.ts`, `tests/action-policy.test.ts`;
  then full run — coverage gates shouldn't move for this surface).
- Both backends: `NEXT_PUBLIC_BACKEND=supabase npm run build` and
  `NEXT_PUBLIC_BACKEND=native npm run build`.
- Manual/preview: duplicate (same-day + to-date), rapid double-click guard,
  bulk duplicate with a forced failure (partial report), optimistic edit/delete
  and their error rollbacks.

## Verification results — 2026-10-02

- **Passed:** lint, TypeScript, full Vitest coverage run — 146 files / 1,745 tests
  passed; 18 files / 86 tests skipped. Aggregate statements 73.27%, branches
  64.60%, functions 74.56%, lines 76.14%; all configured coverage gates passed.
  The migration-fence refusal message is expected negative-test output, not a
  failing check.
- **Passed:** final production builds for native and Supabase. The Supabase
  build used the existing `.env.local` via `@next/env` for the prebuild gate;
  hosted email-confirmation configuration was verified, not bypassed.
- **Closure follow-up:** the final review found the existing log-time optimistic
  path still generated `optimistic-…` IDs while mutation guards recognized
  `temp-…`. Log-time now uses the same `createTemporaryTimesheetId()` helper,
  and all mutation guards use `isTemporaryTimesheetId()`, so every temporary
  row is consistently non-actionable. After this fix, full Vitest (1,745
  passed / 86 skipped), lint, typecheck, `git diff --check`, the native build,
  and the Supabase compile all passed. A fresh hosted Supabase Auth check was
  unavailable because this runtime could not reach `/auth/v1/settings`; the
  Supabase compile used the explicit compile-only bypass. A fresh Playwright
  rerun was also blocked by the tool safety layer after the production preview
  hit the expected trusted-proxy startup guard; the previously completed 18/18
  fixture run remains the browser evidence for the mutation flows.
- **Passed:** 18 Chromium browser-fixture checks in
  `e2e/timesheet-mutations.spec.ts`: all previous mutation/transport/partial-failure
  and dialog-accessibility cases, plus mixed committed/rejected overlap, tab
  remount locks, UUID-unavailable single/bulk copies, rollback ordering, and
  regular-user older-source copying. Rejected-edit coverage verifies draft
  retention before canceling back to the original row. All six closure ledger
  items C1–C6 are implemented and covered; no additional review was requested.
  Browser fixture cookies are stripped from dashboard GETs so unsigned fixture
  sessions never reach server-side Auth. Canceled development navigation streams
  can log `destination stream closed early`; the fixture assertions passed.
- **Preview proof:** isolated regular-user fixture copied an older owned entry
  from 2025-01-01 onto 2026-10-02, reconciled the real ID, and left no temporary
  rows. Source edit/delete stayed disabled; chosen-date copy was enabled. Date-dialog
  computed styles and screenshot captured. Fixture requests never wrote hosted
  data. The preview server was stopped after verification.
- **Limitations:** browser checks ran against the development preview. Production
  preview startup was blocked by missing trusted-proxy configuration, and the
  explicit direct-exposure acknowledgement was denied; no production security
  setting was changed. Database integration tests were skipped because
  `TEST_DATABASE_URL` is absent; no seeded/live mutation tests were performed.
  Both backend compile checks passed, but they do not prove live persistence.

## Commit

Conventional Commits, e.g. `feat(ui): optimistic timesheet mutations + duplicate to date`.
