# Mobile UI Usability — Round 2 Plan

Predecessor: [`MOBILE_UI_USABILITY_IMPROVEMENT_PLAN.md`](MOBILE_UI_USABILITY_IMPROVEMENT_PLAN.md)
(slices S0–S10, all implemented and reconciled). That plan is closed except for its
device-acceptance gates. **Do not re-report its scope.** This document covers only
what it never touched.

Baseline: `mobile/` at branch `claude/hopeful-mahavira-e1b88c`, React Native 0.84.1 /
React 19.2.3, targets Android + iOS + Windows. Line numbers are baseline-relative;
re-locate by symbol before editing.

## Purpose

The predecessor fixed the *entry* path (log time, edit, list, home, sign-in). Round 2
covers the screens and shell that plan skipped: profile, leaves, reminders, reports,
the admin screens, and the session/offline shell. Ranked by user impact:

1. Stop silent loss and silent damage on destructive or multi-step actions that today
   commit on one unconfirmed tap (R1).
2. Stop the UTC/local timezone confusion that records leave and schedules reminders on
   the wrong day (R2).
3. Make failures distinguishable from emptiness — a failed fetch must not render as
   "no records" (R3).
4. Make the shell tell the user *why* they were ejected and let them recover (R4).
5. Bring the untouched screens onto the palette and a11y conventions S2/S7 established
   (R5).

### Non-goals

- **No new runtime dependency.** Same standing rule as the predecessor. Every slice
  below is achievable with the current dependency set.
- **No re-doing S0–S10.** The entry form, entry list, home screen, sign-in, date
  chips, touch targets and save toast are done. If a fix belongs there, it is a
  regression, not a roadmap item.
- **No navigation-library adoption.** The custom reducer stays.
- **No visual redesign.** Palette-only colors, as enforced by
  `mobile/__tests__/theme-source-guard.test.ts`.
- No API contract changes beyond the additive copy/confirm work named here.

## The lever: most of this is wiring, not building

Round 2's cost is low because the predecessor already shipped the primitives this
round needs. Reuse them; do not write parallels.

| Already exists | Where | Round-2 use |
| --- | --- | --- |
| `ConfirmDialog` | `mobile/src/components/ConfirmDialog.tsx` | R1 confirmations. Currently mounted **only** for the unsaved-entry guard (`App.tsx:424`). |
| `todayISO`, `addDaysISO`, `toISODate`, `isValidISODate` | `mobile/src/utils/dates.ts:12` | R2 local-day defaults and validation. |
| `formatLocalDateTime`, `parseLocalInputToIso` | `mobile/src/utils/dates.ts:30,41` | R2 reminder timestamps and the create/edit time-field round trip. |
| `formatDatePreview`, `formatDateShort`, `formatDateRangeShort` | `mobile/src/utils/dates.ts:63,76,88` | R3/R5 human-readable dates on the screens S4 never reached. |
| `DateChooserModal` | `mobile/src/components/DateChooserModal.tsx` | R2 leave date fields; already parameterized for copy by S5. |
| `palette.errorBoxBg` / `successBoxBg` / `error` / `danger` | `mobile/src/theme.ts` | R5 replacing hardcoded hex. |

## Invariants

Inherited from the predecessor; a slice that cannot satisfy them is not done.

1. **No new dependency.**
2. **Three-platform parity.** `npm test` and `npm run test:windows` must both pass.
3. **Palette-only colors.** Never read the raw `colors` object in a themed surface.
4. **Accessibility is part of the change.** New interactive elements ship with
   `accessibilityRole`, `accessibilityLabel`, and `accessibilityState` where they have
   a selected/checked state. New targets ≥ 44pt / 48dp, or `hitSlop` to reach it.
5. **No destructive action without confirmation.** Named explicitly because R1 is
   mostly about this.
6. **Local-day, not UTC-day, for anything a human reads or picks.** Named because R2
   is entirely this.
7. Conventional Commits, one commit per slice, scope `mobile`.

## Reviewed baseline

Verified facts. Each was read in the current worktree; the ones marked *(re-verified)*
were confirmed by direct inspection while writing this plan.

**Destructive actions commit on one unconfirmed tap.**

- `ProfileScreen.tsx:314-339` *(re-verified)* — "Sign Out of All Devices" and
  "Disconnect Workspace" are bare `PressableScale`s calling `logoutAll` /
  `disconnectServer`. One stray tap revokes every session the account holds, or drops
  the user to the connect screen.
- `UserAdminScreen.tsx:1124-1132` — the reclassify modal prints its blast radius
  ("will atomically update all {N} user(s)") and then applies it from the Save button
  with no confirm step and no undo.
- `SettingsAdminScreen.tsx:171-190, 336-356` — `handleResetBranding` restores workspace
  defaults with no confirmation, and its Reset button carries no busy state.
- `LayoutCustomizerScreen.tsx:131-146, 380-413` — reorder / placement / enabled edits
  are local-only with no dirty tracking; `onGoBack` and the Android back handler both
  leave unconditionally, discarding the change silently.
- `LeavesScreen.tsx:115-130` *(re-verified)* — a range leave submits one request per day
  in a `for` loop under a single `catch`. Failing on day 4 of 10 leaves three days
  written, reports only the raw error, and retrying duplicates them.
- `RemindersScreen.tsx:164-173` — dismissing a global announcement calls
  `dismissGlobalReminder` immediately, with no undo.

**Timezone: UTC wall clock used where local is meant.**

- `LeaveAdminScreen.tsx:44, 102` *(re-verified)* — `new Date().toISOString().slice(0, 10)`
  for the default leave date, while `todayISO` already exists and is unused here. East
  of UTC, after ~18:00 local, the prefilled day is tomorrow.
- `GlobalReminderAdminScreen.tsx:47, 80, 92, 117` — the scheduled-time field is seeded
  from a UTC wall clock (`toISOString().slice(0, 16)`) and then parsed as local
  (`new Date(remindAt).toISOString()`), so create and edit disagree about the same
  value.
- `RemindersScreen.tsx:204, 288` and `GlobalReminderAdminScreen.tsx:227` — timestamps
  printed by slicing the raw ISO string (`remind_at?.slice(0, 16).replace('T', ' ')`),
  so a 09:00 IST reminder renders as `2026-10-07 03:30`.

**A failed fetch renders as the genuine empty state.**

- `UserAdminScreen.tsx:614-627, 123`; `LeaveAdminScreen.tsx:52-55`;
  `SettingsAdminScreen.tsx:83`; `PrivilegedReportsScreen.tsx:66-69` — a secondary fetch
  failure is swallowed into `[]` (`listAdminTitles().catch(() => [])`), which the list
  then renders as "No title definitions" / "No users found".
- `ReportsScreen.tsx:260-290` *(re-verified)* — the error box and
  `ListEmptyComponent={<EmptyState message="No hours logged in this period." />}` render
  **simultaneously**, claiming zero hours with totals `0.0 hrs` and no retry.

**The shell ejects the user without explanation.**

- `SessionProvider.tsx:621-625` — a 401 that survives the single-flight refresh calls
  `signOut()`; `loadDashboard`/`loadReference` (`664-666`, `688-690`) do the same, so a
  background refresh alone logs the user out.
- `App.tsx:464-474` — `signOut` maps straight to `SignInScreen`, which is mounted with
  only `isDarkMode` + `onBackToConnect` and **never receives the error string**. The
  user lands on a bare sign-in form with no reason given.
- `App.tsx:77, 112-114, 187` — the signed-out branch returns `SignInScreen` instead of
  the shell, unmounting `MainNavigator`, so the nav stack and any open draft are gone.
- `App.tsx:500-540, 572` *(re-verified)* — `AppErrorBoundary` catches render-phase throws
  only; "Try Again" sets `hasError=false` and re-renders the identical tree, so a
  deterministic throw loops. It is hard-wired to `isDarkMode={false}` (`App.tsx:572`), so
  a dark-mode crash shows a full-white screen.
- `App.tsx:414-415` — `retryMutation(id).catch(() => {})` and the same for
  `discardMutation`: a failed retry looks identical to a successful one.
- `App.tsx:164-177` — the back guard treats any non-dashboard root tab as
  back-navigable, so hardware back from `timesheets`/`reports`/`more` resets to the
  dashboard and loses the selected tab.
- `src/storage/offline-queue.ts:522-524` — `discardMutation` is a bare dequeue with no
  confirmation anywhere; `ConfirmDialog` is wired only to the unsaved-entry guard.
- `OfflineBanner.tsx:126, 136-145` — for a non-legacy mutation in commit-unknown state,
  Retry and "Review and re-enter" are both hidden, leaving instant Discard as the only
  exit.

**Palette and a11y drift on the screens S2/S7 never reached.**

- 13 hardcoded status/error hex values across `UserAdminScreen`, `ActivityTypeAdminScreen`,
  `ProjectAdminScreen`, `LeaveAdminScreen`, `GlobalReminderAdminScreen`
  *(re-verified count)* — e.g. `backgroundColor: item.isActive ? '#ECFDF5' : '#FEF2F2'`,
  `color: '#B45309'` — while `palette.errorBoxBg` / `successBoxBg` / `error` / `danger`
  already exist. In dark mode these read as bright near-white boxes.
- Error banners in the same five screens plus `ReportsScreen.tsx:260-264` carry no
  `accessibilityRole="alert"`, though `LeavesScreen.tsx:223` and `ProfileScreen.tsx:80`
  both set it.
- `EmptyState.tsx:22-24` and `FeatureHub.tsx:36` each hold a **partial** `IconName`
  allow-list; any icon outside it renders the icon *name* as literal text (e.g. a giant
  "trash"). The two lists have already drifted from `IconName`.

## Slices

Tiers are independently shippable in order. Slices within a tier are independent.

### R1 — Confirm and contain destructive actions (Tier 1)

Highest severity: silent loss and silent damage. Reuse the shipped `ConfirmDialog`; do
not add a second dialog primitive.

- `ProfileScreen.tsx` — gate `logoutAll` and `disconnectServer` behind `ConfirmDialog`
  with explicit copy ("Sign out of every device?" / "Disconnect this workspace?").
  Cancel is the default. Keep the plain "Sign Out" unconfirmed.
- `LeavesScreen.tsx:115-130` — replace the day loop with all-or-report: track how many
  days committed, and on failure surface "3 of 10 days recorded — the rest did not
  save" rather than the raw error. Do not change the per-day request shape without
  checking the API contract; if a bulk endpoint exists, prefer it.
- `LayoutCustomizerScreen.tsx` — track dirtiness and route `onGoBack` and the Android
  back handler through the existing guard pattern from S1 rather than inventing a
  second one. If the screen is not on the nav-guard path, wire it the same way
  `LogTimeScreen` was.
- `UserAdminScreen.tsx` reclassify and `SettingsAdminScreen.tsx` reset-branding — one
  `ConfirmDialog` each, restating the blast radius in the body.
- `RemindersScreen.tsx:164-173` — either confirm the dismiss or make it undoable via the
  existing `Toast`. Prefer undo: dismissal is low-stakes and a confirm on every dismiss
  is friction.
- `OfflineBanner` commit-unknown state — stop leaving instant Discard as the only exit.
  Give the state a non-destructive path (retry-when-online, or an explicit
  "I'll check the server" that re-runs the disambiguation), and confirm the Discard.

**Tests.** For each: the destructive action does not fire on first tap; Cancel leaves
state untouched; Confirm performs it. `LeavesScreen` partial-failure reports the count
committed and not the raw error, and does not silently claim success.

**Exit criteria.** No action that destroys data, revokes sessions, or rewrites a batch
of users fires without an explicit confirmation or an undo affordance.

### R2 — Local time, everywhere a human reads or picks it (Tier 1)

- `LeaveAdminScreen.tsx:44, 102` — use `todayISO` from `../utils/dates`.
- `GlobalReminderAdminScreen.tsx:47, 80, 92, 117` — seed the time field and parse it
  through the same local helpers (`formatLocalDateTime` / `parseLocalInputToIso`), so
  create and edit round-trip the same wall clock.
- `RemindersScreen.tsx:204, 288`; `GlobalReminderAdminScreen.tsx:227` — render through
  `formatDatePreview` / `formatLocalDateTime` instead of slicing ISO.
- `LeavesScreen.tsx:270-283, 330-341` — give the leave date fields the existing
  `DateChooserModal` instead of free-text with a `YYYY-MM-DD` placeholder and no
  `keyboardType` (this is the same gap S5 closed on the entry form). Where free-text
  stays, validate with `isValidISODate` and say the *format* was wrong, not "End date
  must be on or after start date."
- `PrivilegedReportsScreen.tsx:204-229, 107` — validate the custom range with
  `isValidISODate` and a from ≤ to guard before it reaches `getReports`.

**Tests.** A fixture pinned to a non-UTC offset asserts the default leave date equals
the *local* day, a reminder renders its local time and not the shifted one, and an
inverted or malformed range is refused before the request.

**Exit criteria.** No user-visible date or time is derived from `toISOString()` slicing
or parsed as local; every pickable date goes through a validated control.

### R3 — A failure never reads as an empty result (Tier 2)

- `ReportsScreen.tsx:260-290` — when `error` is set, suppress the empty state and the
  `0.0 hrs` totals, and offer retry. These must be mutually exclusive branches.
- The four swallowed secondary fetches (`UserAdminScreen:614-627`, `LeaveAdminScreen:52-55`,
  `SettingsAdminScreen:83`, `PrivilegedReportsScreen:66-69`) — keep the last-known value
  and surface a retryable inline error instead of collapsing to `[]`. Do not let a
  picker assert "No users found" because one request failed.
- `App.tsx:414-415` — give `retryMutation` and `discardMutation` a visible failure
  outcome; a caught-and-ignored rejection currently makes a failed retry look like a
  successful one.

**Tests.** With the fetch stubbed to reject: the error renders, the empty state does
not, totals are not shown as `0.0`, and retry re-issues the request. For the pickers:
a rejection does not produce the "no results" copy.

**Exit criteria.** Every load failure is distinguishable on screen from a genuine empty
result, and every failure offers a recovery path.

### R4 — The shell explains itself (Tier 2)

- `App.tsx:464-474` + `SignInScreen` — pass the session error through so an expiry or a
  secure-storage failure says *why* the user is on the sign-in screen.
- `AppErrorBoundary` (`App.tsx:500-540, 572`) — read the real theme instead of the
  hard-wired `isDarkMode={false}`; make "Try Again" reset navigation state as well as
  `hasError`, so a deterministic throw is not a loop. Consider one
  `ErrorUtils.setGlobalHandler` / `unhandledrejection` handler as the single net for the
  async throws the boundary cannot see.
- `App.tsx:164-177` — treat every root tab as a root for back purposes, so back from
  `timesheets`/`reports`/`more` exits rather than silently resetting to the dashboard.
  Decide this against the platform convention and record the decision.

**Tests.** A rejected refresh renders the sign-in screen **with** the reason; the error
boundary renders in dark mode; "Try Again" leaves the error tree; back from a root tab
behaves as decided.

**Exit criteria.** No forced logout and no crash is silent, and no recovery affordance
is a no-op loop.

### R5 — Palette and a11y parity on the remaining screens (Tier 3)

- Replace the 13 hardcoded status/error hex values with the existing
  `palette.errorBoxBg` / `successBoxBg` / `error` / `danger`.
- Add `accessibilityRole="alert"` to the six error banners missing it.
- Collapse the two partial icon allow-lists (`EmptyState.tsx:22-24`,
  `FeatureHub.tsx:36`) into one check tied to `IconName`, so an unmapped icon cannot
  silently render its name. Fixing the shared list fixes every caller at once.
- While here: extend `theme-source-guard.test.ts` to police `colors.(error|success|danger|warning)`
  the way it already polices `colors.primary*`, so the bypass cannot spread. This is the
  root-cause fix for the palette drift — one guard, not thirteen call sites re-checked
  by hand each time.

**Tests.** A render assertion per touched surface that the resolved background/foreground
comes from the palette and not a literal; a guard test that a `colors.error` reference
outside the allowlist fails; an assertion that an unmapped `IconName` cannot produce
literal text.

**Exit criteria.** No user-facing literal color remains in the touched screens; the
guard covers the error/success/danger tokens.

## Deferred (unchanged from the predecessor, plus one)

- Haptics, native date picker, swipe gestures, biometric unlock, navigation-library
  migration — same dependency-policy reasoning as the predecessor's
  [Deferred items](MOBILE_UI_USABILITY_IMPROVEMENT_PLAN.md#deferred-items).
- **Auto-flush on reconnect.** `src/sync/sync-engine.ts` stops on transient errors and
  nothing reschedules a flush, so "N pending" is the resting state after a network
  blip. This is a sync-engine semantics change, not a UI fix; it belongs in a sync
  decision packet, not here. Round 2 only makes the state *legible* (R3).
- **Manager/reporting-line editing** (`UserAdminScreen.tsx:66, 78` — `createManagerId` /
  `editManagerId` are plumbed to the API but no control sets them). A missing feature,
  not a UX defect; scope it separately.
- **Search-under-collapsed-nodes** (`TeamScreen.tsx:91-122`) and the nested-pressable
  chevron (`TeamScreen.tsx:229-242`) — real, but lower impact than the above; fold into
  a Team-screen pass if one is scheduled.

## Verification

Per slice, run the focused suites named there. On the settled change set:

```bash
cd mobile && npm run lint && npm run typecheck && npm test && npm run test:windows
```

Before calling Tier 1 done, also:

- Manual pass on at least one real platform for: sign-out-all confirm, a partial leave
  submission, a reminder at 09:00 IST rendering 09:00, and back from a root tab.
- Light **and** dark check of every R5 surface, since the whole point is dark-mode
  contrast.
- `git status --porcelain` against a captured baseline: only files the landed slices
  name should differ.

Report which checks passed, which were skipped, and why. Do not describe a manual pass
as done unless it ran on a device or emulator.

## Risks

| Risk | Mitigation |
| --- | --- |
| Confirmation fatigue — too many dialogs | Only data-destroying, session-revoking, or batch-rewriting actions get a dialog; low-stakes dismissals get undo (R1) |
| `ConfirmDialog` used in a context it was not built for | It was built for the unsaved-entry guard; check its props and Windows sizing (`useModalBounds`) hold for each new call site |
| Per-day leave submit cannot report partial success cleanly | Track committed count in the loop's catch; prefer a bulk endpoint if the API has one — confirm the contract first |
| Back-handler change alters expected platform behavior | Decide against Android/iOS/Windows convention and record the decision in the slice |
| UTC→local change shifts already-stored values | Storage stays ISO; only the *display* and the *default-day* change. Assert a stored value round-trips unchanged |
| Guard extension flags pre-existing code | Extend it in R5 *after* fixing the call sites it would flag, so the guard lands green |
