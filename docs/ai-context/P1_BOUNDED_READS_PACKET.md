# P1 bounded dashboard reads

Decision: isolate the server-paged all-date table from month totals, personal local-today presence, Telegram history, and complete history snapshots. The user selected page-first checkbox selection with an explicit all-filtered-history option.

## Verified evidence and constraints

- FACT — `app/dashboard/page.tsx:fetchTimesheets` currently omits pagination. `EntriesTable` locally pages at 25/50/100, owns user/page/size URL state, and bulk handlers resolve selection against its complete input array.
- FACT — `lib/data/client.ts:getTimesheetsOverHttp` globally shares same-URL in-flight reads. New session/scope controllers must use an explicit bypass, as D3 does for aggregates.
- FACT — `app/reports/page.tsx` uses 1,000-row list pages and 1,000-row month pages; `lib/reports/csv-stream.ts` uses 500. Preserve these boundaries with HTTP maximum 1,000 and default 50. Inclusive ranges override limits in adapters, so normalize effective ranges at the HTTP boundary.
- FACT — `ReportExport` includes future rows when the end date is omitted. `/api/v1/reports/export` instead defaults end to today. Use complete bounded list snapshots for this panel and the deactivation export to preserve filters, CSV formatting, filenames, and failure semantics.
- FACT — `UserWhitelist.confirmDeactivate` currently ignores read errors before deactivation; export mode must stop on any retrieval/download failure.
- FACT — Telegram currently sees personal history (all actor-visible history for admins). Give it independent bounded previous/next browsing with exact counts, preserving access to older entries.
- FACT — D3 month totals are server-confirmed, actor-visible, calendar-month aggregates independent of list scope. Keep its controller and mutation busy gating.
- FACT — existing optimistic insert/update/delete recovery, temporary-ID guards, confirmation dialogs, backfill eligibility, and dashboard-owned mutation locks must remain.
- UNKNOWN — production latency, concurrent externally modified history, live RLS and deployment verification. Offset paging cannot establish a transactional snapshot against external writes; detect changed counts/duplicate IDs/incomplete pages and fail without returning partial success.

## Selected protocol and lifecycle

Initial table read requests one URL-selected server page with exact count. User/page/size changes issue new scoped requests; retain unrelated URL parameters. Session transitions invalidate row/presence requests, and read identities bypass global singleflight. Optimistic overlays apply only to their originating page/filter/session; settlement still releases parent locks across remounts. Counts remain server-confirmed.

Header selection toggles only rendered non-temporary rows. Explicit all-history selection retrieves bounded pages on demand and installs one complete selected-row snapshot only after success. Scope changes/mutations cancel stale retrievals; no partial snapshot is actionable. Actions use that snapshot, preserve eligibility, and respect the 500-entry edit payload limit. Confirmation captures selected rows rather than resolving selection again later.

Exports retrieve all matching bounded pages before generating a CSV. Failed middle pages or inconsistent history produce errors and no download; failed deactivation export leaves the account active. Telegram pages independently, invalidates stale session/filter reads, and refreshes after mutations. Personal Today requests the local calendar date for the signed-in user with limit 1, independently of table paging/filter.

Rejected: passing a table page to full-history features; month-only list replacement; silently changing report page constants; relying on explicit limit alone; partial export/selection success; new auth/persistence APIs or migrations.

## Acceptance checks

Focused tests: HTTP defaults/inclusive range bounds/count defaults; complete multi-page snapshots including old/future rows and failures; page/user/size parsing; stale session/scope/mutation responses and overlays; selection snapshots and confirmation; independent Telegram navigation/personal today; D3 totals regression; existing CSV formatting and batch limits. Run focused lint and application typecheck. Root owns settled full matrix and deployment checks.

## Consolidated repair ledger

Invariant: a read or selection is usable only for its initiating session, scope, and mutation generation; a global operation resolves global server truth independently of the displayed page.

- P1-R1 — reviewer: range normalization attached to the edit payload schema. Move it to the list query schema; verify defaults, one-sided/huge/reversed inclusive ranges and unchanged edit payload.
- P1-R2 — reviewer: individual edits leave old selected row values reusable. Starting a mutation clears selection and cancels retrieval; an already captured batch retains its immutable work list. Verify edited rows cannot subsequently revert through stale bulk payloads.
- P1-R3 — reviewer: Last actions resolve the displayed page. Undo reads the existing persistence getLatest ordering through a small authenticated GET on the existing last resource (same contract as DELETE, ties unchanged). Edit uses an independent bounded canonical list read, navigates to the first unfiltered page if necessary, and opens the confirmed target. Verify page-two actions and latest-read failure.
- P1-R4 — reviewer/root: exports can outlive session/unmount. Panel cleanup invalidates request generations; parent session-generation predicates stop reads, download, and deactivation even before unmount cleanup runs. Verify middle-page failure, unmount, and direct session switch.

## Handoff evidence

P1-R1–R4 have implementation repairs. Focused verification: 11 test files / 173 tests passed (including D3 aggregates, history completeness, scoped reads, HTTP cookie/bearer behavior, Last service, existing CSV/Telegram and boundary enforcement); application `tsc --noEmit` passed; lint of affected source, unit tests and browser fixture passed with no warnings. No broad coverage/build/browser/database checks were run by the worker.

`e2e/bounded-dashboard.spec.ts` supplies native production fixtures against current v1 auth/data DTOs. Every API mutation is intercepted and unexpected writes fail. Browser execution is pending root integration on the isolated backend. It covers URL paging/user/size, page-first and explicit history selection, selection after individual edit, complete CSV including future/older rows, independent Telegram pages, middle-page failures (including deactivation), and export unmount cancellation.

S1 repair: ownership was extended to `app/dashboard/bulk-edit-modal.tsx`. Opening the modal captures selected rows independently of reusable checkbox selection. Submission copies all primitive payload values before synchronously validating eligibility/current scope/session, clearing reusable selection and acquiring dashboard-owned locks for every target. Locks remain held through write and fresh reconciliation on success, rejection, partial results and transport throws; finally releases each target. Escape, backdrop and both Cancel buttons use guarded dismissal, and all dialog inputs are disabled while saving. Every attempted batch closes after reconciliation, forcing fresh selection before retry. Unmount suppresses old dialog callbacks while same-session reconciliation still refreshes server truth; a replacement session receives neither follow-up reads nor old lock mutations.

S1 verification cases: unit lifecycle tests cover immutable payload/selection invalidation, delayed write and reconciliation lock lifetime, rejected/partial/thrown writes, failed reconciliation, competing submissions, and replacement sessions. The bounded browser fixture adds four delayed batch variants (success, rejection, partial result, transport failure), checking every target's locks, page/user/size/Undo controls, disabled top/bottom Cancel, Escape/backdrop blocking, fresh reconciliation, lock release and no reusable selection. Browser execution awaits the root's rebuilt production app; original five P1 browser tests passed in root verification before S1.

S1 checks: affected-source/unit/browser-fixture lint passed without warnings; application typecheck passed. Six focused unit files passed 75 tests. One verification attempt failed before collecting tests due to sandbox temporary-cache rename EPERM; the workspace-cache retry passed. Playwright discovery found all nine bounded fixtures. Application source changed in the modal and table wiring, so root production rebuild is required before executing the four added browser cases.

Remaining protocol limitation: changed counts/duplicate IDs/incomplete history are detected; an offset-paged browser snapshot cannot prove transactional consistency for count-neutral external changes. No new server snapshot/persistence protocol is introduced in this batch.

## Root integration verification

Independent bounded closure closed R1–R4 and S1 with no material findings.
Standard full matrix: 1,872 passed, 61 optional skips; coverage gates passed
(statements 73.83%, branches 66.09%, functions 80.38%, lines 77.17%).
Full lint, typecheck and both backend production builds passed. Disposable native
PostgreSQL: 22 focused index, daily-hours concurrency, password-recovery and
idempotency integration tests passed. No production/provider database changes.

Sandbox-only attempts failed on Windows cache/path access and DNS/socket access;
normal-access reruns passed. A native-forced full unit run was not an appropriate
configuration for suites that assume Supabase. Existing browser response watchers
now recognize the v1 login endpoint; the accessibility audit waits for theme
transitions to settle before checking contrast. Rebuilt nine-case bounded browser
matrix plus live authentication/accessibility/report checks: 21 passed, no skips.
Mobile consumers preserve explicit list pagination: separate mobile typecheck
and all 57 suites / 418 tests passed against the shared contract delta.
