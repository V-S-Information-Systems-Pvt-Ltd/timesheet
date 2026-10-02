# Mobile UI Usability Improvement Plan

Baseline: `mobile/` at branch `arch/architecture-simplification` (worktree
`C:\dev\timesheet-architecture-simplification`), React Native 0.84.1 / React
19.2.3, targets Android + iOS + Windows (`react-native-windows` 0.84.0).

Source: the usability review of the mobile app UI (read-only analysis, no files
changed). This plan converts that review's ranked findings into implementable
slices. Line numbers are baseline-relative and will drift as slices land; always
re-locate by symbol before editing.

## Purpose

1. Stop silent data loss in the time-entry flow by activating the unsaved-changes
   protocol that already exists in the navigation reducer but is never dispatched.
2. Remove the light-mode invisible-text defect on the date quick-select chips.
3. Give every write an explicit outcome, distinguishing a committed save from an
   offline-queued save.
4. Replace raw ISO dates in human-facing copy — especially irreversible delete
   confirmations — with the formatter the codebase already ships.
5. Reduce entry-form friction: real date picking, inline validation, compliant
   touch targets, recency-ranked project shortcuts.
6. Reduce list-screen friction: discoverable selection, day grouping with daily
   totals, summarized batch errors.
7. Keep Android, iOS and Windows at parity and add regression coverage for every
   behavior this plan changes.

### Non-goals

- No navigation library adoption. The custom `navigationReducer` stays.
- No new runtime dependency in S1–S7. Haptics, native date pickers and gesture
  libraries are explicitly deferred (see [Deferred](#deferred-items)).
- No visual redesign, no new design tokens, no brand-color changes. Every color
  comes from the existing runtime `Palette`.
- No API/contract changes beyond the one additive return value in S3.
- No change to offline-queue or idempotency semantics. S3 reports queue state; it
  does not alter when or how writes are queued.
- Web app (`app/`) untouched. This plan is scoped to `mobile/`.

## Implementation status

| Slice | Scope | Tier | Status |
| --- | --- | --- | --- |
| S0 | Guardrails, baseline capture, verification contract | — | Done |
| S1 | Activate the unsaved-changes guard end to end | 1 | Done |
| S2 | Fix invisible quick-date chip labels (light mode) | 1 | Done |
| S3 | Save confirmation: saved vs queued | 1 | Done |
| S4 | Human-readable dates in cards, confirms, a11y labels | 1 | Done |
| S5 | `DateChooserModal` in the entry form | 2 | Done |
| S6 | Inline field validation + scroll-to-first-error | 2 | Done |
| S7 | Touch-target compliance on chips and steppers | 2 | Done |
| S8 | Recency-ranked project shortcuts; collapse Telegram card | 3 | Done |
| S9 | List ergonomics: pressable cards, day groups, batch-error summary | 3 | Done |
| S10 | Home and sign-in polish | 4 | Done |

All slices are implemented on `arch/architecture-simplification`. What each
implementation settled differently from the plan above is recorded under
[Implementation notes](#implementation-notes) at the end of this document.

The table records implementation status. Device/emulator acceptance checks
remain pending; Tier 1 is not fully verified until those checks are recorded.

Tier matches the accepted review: Tier 1 = correctness/data-loss, Tier 2 = entry
friction, Tier 3 = flow efficiency, Tier 4 = polish. Tiers are independently
shippable in order; within a tier, slices are independent except S6 ⊃ S2 (both
touch `TimeEntryForm` styles) and S9 ⊃ S4 (card date rendering).

## Reviewed baseline

Verified facts this plan depends on. Each was read in the current worktree.

**Unsaved-changes machinery is complete but dead.**

- `mobile/src/navigation/navigation-reducer.ts` implements `SET_DIRTY` (≈ line
  213), `CONFIRM_DISCARD` (≈ 219), `CANCEL_DISCARD` (≈ 243), and `isDirty`
  interception inside `SWITCH_TAB` (≈ 70), `PUSH_ROUTE` (≈ 104) and `GO_BACK`
  (≈ 168 for the stack-pop branch, ≈ 191 for the root branch).
- `mobile/App.tsx` never dispatches `SET_DIRTY`, `CONFIRM_DISCARD` or
  `CANCEL_DISCARD`, and never reads `navState.showDiscardDialog`. A grep for
  `onDirtyChange|SET_DIRTY` across `mobile/__tests__/` returns no matches.
- Therefore `isDirty` is permanently `false`, all four guards are unreachable, and
  a half-filled entry form is destroyed silently by a tab switch or Android back.
- `mobile/src/screens/LogTimeScreen.tsx` already declares
  `onDirtyChange?: (isDirty: boolean) => void` (line 12) and forwards it to
  `TimeEntryForm` (line 57). Only `App.tsx`'s omission breaks the chain.
- `CONFIRM_DISCARD` **rebuilds** the stack rather than popping it:
  `history: isRoot ? [destination] : ['dashboard', destination]` with a matching
  two-entry `stack`. A discard from a deep route therefore lands on
  `dashboard → destination`, losing intermediate frames.

**Quick-date chips render white-on-white in light mode.**

- `mobile/src/components/TimeEntryForm.tsx:324-351` — the "Today" and "Yesterday"
  chips hardcode `backgroundColor: palette.card` regardless of selection, while
  the label switches to `palette.onPrimary` when selected.
- `mobile/src/theme.ts` — `colors.card = '#FFFFFF'`; light `palette.card =
  colors.card`; `onPrimary: '#FFFFFF'` in **both** the light and dark branches.
  Selected label on light background is therefore 1:1 contrast — invisible.
- `presetButtonActive: {}` (line 801) and `presetTextActive: {}` (line 803) are
  declared and empty; `chipActive: {}` (823) likewise. The intended selected
  treatment was never written.
- `mobile/src/components/DateChooserModal.tsx:144-183` contains the **correct**
  pattern to mirror: `backgroundColor: selected ? palette.primary :
  palette.background` paired with `color: selected ? palette.onPrimary :
  palette.foreground`.

**Writes are indistinguishable from queued writes.**

- `mobile/src/auth/domains/timesheets.ts:48-58` — `createTimesheet` returns
  `Promise<void>` and passes `onNetworkFailure: () => enqueueCreateTimesheet(...)`.
- `mobile/src/auth/SessionProvider.tsx:621-625` — on a network failure `withAuth`
  sets offline state and **returns** `options.onNetworkFailure()`. The queued path
  resolves normally, so the caller cannot tell a commit from an enqueue.
- `App.tsx` passes `onSuccess={navigateBack}` to both `LogTimeScreen` and
  `EditTimeScreen`; neither emits any confirmation. Save is entirely silent.
- `updateTimesheet` (line 60) has **no** `onNetworkFailure` — edits throw when
  offline and are never queued. The edit toast is therefore "Saved" only.
- `mobile/src/components/Toast.tsx` is a reusable component (not a provider) with
  `{ message, type, visible, onDismiss, durationMs = 3000, palette }`, already
  carrying `accessibilityLiveRegion="polite"` and `accessibilityRole="alert"`,
  positioned `absolute` at `top: spacing.md`, `zIndex: 999`.

**Date formatting is inconsistent, not absent.**

- `mobile/src/utils/dates.ts` exports `formatDatePreview` ("Mon, Oct 24, 2026").
- The entry form **already** previews the parsed date beside its label
  (`TimeEntryForm.tsx:281-283`, style `datePreviewText` at 790). The form is not
  the problem; the raw-ISO surfaces are.
- Raw ISO dates remain in: `TimesheetEntryCard.tsx:71` (card body) and its four
  accessibility labels (53, 89, 106, 118); `HomeScreen.tsx:88` and
  `TimesheetListScreen.tsx:228` (both **delete confirmations**).

**Touch targets and other measured facts.**

- Compliant already: `presetButton` `minHeight: 48` (796), `stepButton`
  `minWidth: 44` (791), `input` `minHeight: 48` (785), `TimesheetEntryCard`
  `actionButton` 44×44 (219-225), `DateChooserModal` chips/buttons 44.
- Non-compliant: `chip` `minHeight: 38` (811) and `hourStepChip` `minHeight: 36`
  (837), neither with `hitSlop`; `BottomNavBar` action button 38×38 with
  `hitSlop: 8`; `TimesheetEntryCard` checkbox 22px with `hitSlop: 8`.
- `TimeEntryForm` validates only on submit (≈ 203-226) and surfaces errors in a
  single box above the form (≈ 251-255) with no scroll-to-field.
- `quickProjects = reference?.projects?.slice(0, 4) ?? []` (247) — first four by
  API order, not by recency. A "Copy last entry" row already exists (269-274).
- `TimeEntryForm` has a false-dirty hazard: the create-mode predicate (106-121)
  treats a non-empty `projectId` as dirt, while the async default-project effect
  (89-103) sets `projectId` to the `'internal'` project after mount once
  `reference` resolves. `isInitialMount` suppresses only the first effect run.
- `TimesheetListScreen.tsx` dumps `errors.join('\n')` into `Alert` (331, 397);
  filters are relative only (All / 7 / 30); selection is discovered through a
  "Select" button (472-481); `DateChooserModal` is wired at 690.
- `HomeScreen.tsx` has three profile entry points in one viewport (176-207), a
  `label="This Week"` / `dateLabel="Last 7 days"` mismatch (226-242), and a dead
  `isLoading` branch at 220 (unreachable behind the early return at 153).
- `SignInScreen.tsx` has focus chaining, `returnKeyType` and show-password, but no
  `autoComplete` / `textContentType` and no biometric unlock.
- `mobile/package.json` dependencies are only `@vsis/{client,contracts,core}`,
  `react`, `react-native`, `react-native-safe-area-context`,
  `react-native-windows`, `zod`. **No haptics and no datetimepicker exist.**

## Invariants

These hold for every slice. A slice that cannot satisfy them is not done.

1. **No new dependency in S1–S10.** Per the standing repo policy (recorded in
   `docs/plans/archive/MOBILE_CODE_REVIEW_FINDINGS_FIX_PLAN.md`): *no dependency
   is adopted until its React Native 0.84, new-architecture, Android, iOS and
   maintenance status is documented.* Every slice below is achievable with the
   current dependency set.
2. **Three-platform parity.** Android, iOS and Windows. Honour the existing
   `Platform.OS === 'windows'` branches (e.g. `RefreshControl` is omitted on
   Windows in `HomeScreen.tsx:166`). `npm run test:windows` must pass alongside
   `npm test`.
3. **Palette-only colors.** `mobile/__tests__/theme-source-guard.test.ts` fails the
   build if `colors.primary|primaryDark|primaryLight` appears outside
   `src/theme.ts`, `src/screens/SignInScreen.tsx`, `App.tsx`, or if
   `getPalette(isDarkMode)` appears in mounted authenticated code. Read the
   palette from `useTheme()` or the passed `palette` prop — never the raw
   `colors` object.
4. **No offline-semantics drift.** Idempotency key generation, enqueue timing and
   `sync-engine` behavior are unchanged. S3 observes; it does not steer.
5. **Accessibility is part of the change, not a follow-up.** Any new interactive
   element ships with `accessibilityRole`, `accessibilityLabel` and — where it has
   a selected/checked state — `accessibilityState`. New targets are ≥ 44pt
   (iOS HIG) / 48dp (Android Material); where layout forbids growth, add
   `hitSlop` to reach the minimum.
6. **Preserve unrelated work.** The worktree already carries ~33 modified and ~11
   untracked files from in-flight architecture work. Touch only the files a slice
   names; re-check `git status` before and after each slice.
7. **Conventional Commits**, one commit per slice, scope `mobile`.

## S0 — Guardrails and baseline capture

No product change. Establishes the ground truth each later slice is measured
against.

1. Record the pre-change worktree: `git status --porcelain` and
   `git stash list` (do not stash; see the worktree safety rule — prefer a WIP
   commit if work must be set aside).
2. Run the full mobile gate and record the result as the baseline:

```bash
cd mobile && npm run lint && npm run typecheck && npm test && npm run test:windows
```

3. Note any pre-existing failure. A pre-existing failure is not this plan's to
   fix, but it must be named so later runs are comparable.

**Exit criteria.** Baseline recorded; the four commands' pass/fail state is known.

## S1 — Activate the unsaved-changes guard (Tier 1)

**Defect.** A user with a half-filled entry form who taps a tab or Android back
loses everything, with no prompt. The protocol to prevent it already exists and is
never invoked.

### S1.1 — Fix the dirty predicate before wiring it

Wiring the current predicate would nag users on untouched forms, because the async
default-project effect sets `projectId` after mount.

In `mobile/src/components/TimeEntryForm.tsx`:

- Introduce a baseline snapshot captured **after** defaults settle, rather than
  comparing create-mode fields against empty:
  - Hold a `baselineRef` of `{ logDate, projectId, activityTypeId, hoursWorked,
    workDone }`.
  - For `mode === 'edit'`, seed it from `initialValues` on mount.
  - For `mode === 'create'`, seed it on mount from the initial state, then
    **re-seed** it in the same effect that applies the `'internal'` default and
    the first activity type (89-103) — only for fields that effect wrote, and only
    while the form is still pristine.
  - Compute `isDirty` as a field-by-field comparison against `baselineRef`,
    replacing both branches of the current predicate (106-121).
- Keep the existing `onDirtyChange?.(isDirty)` emission point and the
  `isInitialMount` suppression of the first emission.
- Clear dirty on successful submit **before** `onSuccess()` fires, so the parent's
  `navigateBack` is not intercepted by the guard it just armed.

### S1.2 — Dispatch `SET_DIRTY` from the shell

In `mobile/App.tsx`:

- Add a stable callback beside the existing nav dispatchers (71-87):

```tsx
const setFormDirty = useCallback((isDirty: boolean) => {
  dispatchNav({ type: 'SET_DIRTY', payload: { isDirty } });
}, []);
```

- Pass `onDirtyChange={setFormDirty}` to `LogTimeScreen` (already accepts it) and
  to `EditTimeScreen` (add the same optional prop and forward it to
  `TimeEntryForm`, mirroring `LogTimeScreen.tsx:12,57`).
- Reset dirty when a form screen unmounts for any other reason, so a stale `true`
  cannot block later navigation.

### S1.3 — Render the discard dialog

- Render a confirmation driven by `navState.showDiscardDialog` in the shell, in
  the same region as `OfflineBanner` inside `styles.screenContainer`, so it
  survives the screen swap it is mediating.
- Buttons: **Keep editing** → `dispatchNav({ type: 'CANCEL_DISCARD' })`;
  **Discard** → `dispatchNav({ type: 'CONFIRM_DISCARD' })`.
- There is no shared `Dialog` primitive in `mobile/src/components/` — the only
  modals are `DateChooserModal.tsx` and `SearchablePickerModal.tsx`, both built
  directly on RN `Modal`. Add a small `ConfirmDialog` component following
  `DateChooserModal`'s structure (transparent `Modal` → backdrop → `SafeAreaView`
  → card, with `useModalBounds` for Windows sizing, per
  `DateChooserModal.tsx:42,100-110`). Do not use `Alert`: it is not renderable in
  `react-test-renderer` assertions and its Windows presentation differs.
- `accessibilityViewIsModal` on the dialog; label the destructive action
  explicitly ("Discard unsaved entry").

### S1.4 — Resolve the `CONFIRM_DISCARD` stack rebuild

`CONFIRM_DISCARD` currently flattens to `['dashboard', destination]`. For the
routes this plan arms (`log-time`, `edit-time`, both pushed from one level), the
observable result is correct. Before shipping, assert the behavior for a
two-deep push in `navigation-reducer.test.ts`:

- If flattening is observable from any reachable path, change `CONFIRM_DISCARD` to
  pop to `pendingRoute`'s actual frame — reuse the slice-arithmetic already in the
  non-dirty `GO_BACK` branch rather than rebuilding the array.
- If it is not reachable, leave the reducer alone and record the constraint as a
  comment at the `CONFIRM_DISCARD` case so the next reader does not re-derive it.

### S1.5 — Tests

- `mobile/__tests__/navigation-reducer.test.ts`: `SET_DIRTY` sets the flag;
  `SWITCH_TAB` / `PUSH_ROUTE` / both `GO_BACK` branches set
  `showDiscardDialog` + `pendingRoute` instead of navigating while dirty;
  `CANCEL_DISCARD` restores the pre-prompt state exactly; `CONFIRM_DISCARD`
  navigates and clears `isDirty`/`pendingRoute`/`showDiscardDialog`; the
  two-deep stack assertion from S1.4.
- `mobile/__tests__/log-time-screen.test.tsx`: typing into "Hours Worked" calls
  `onDirtyChange(true)`; **an untouched form that receives the async project
  default does not report dirty** (the regression S1.1 exists to prevent);
  successful submit reports `false` before `onSuccess`.
- `mobile/__tests__/App.test.tsx` (or a new `discard-dialog.test.tsx`): with the
  form dirty, a tab switch renders the dialog and does not change the route;
  **Discard** navigates; **Keep editing** stays.

**Exit criteria.** Dirty state round-trips shell ↔ form; no false positive on an
untouched form; both exits from the dialog behave; Android back is covered.

## S2 — Fix the invisible quick-date chip label (Tier 1)

**Defect.** In light mode, the selected "Today"/"Yesterday" label is `#FFFFFF` on
a `#FFFFFF` chip.

In `mobile/src/components/TimeEntryForm.tsx`:

- Give the selected state a real background. Mirror
  `DateChooserModal.tsx:144-183`: when selected, `backgroundColor: palette.primary`
  and `borderColor: palette.primary`; when not, keep `palette.card` /
  `palette.border`. The label keeps `palette.onPrimary` when selected and
  `palette.foreground` otherwise — the existing ternaries at 334 and 348 then
  become correct rather than inverted.
- Apply the same treatment to the empty `chipActive` (823) / `chipTextActive`
  (825) pair used by project and activity chips if any call site sets a selected
  label to `onPrimary` without a primary background. Audit every use of
  `palette.onPrimary` in this file and confirm each is paired with a
  `palette.primary` surface.
- Either populate `presetButtonActive` / `presetTextActive` and use them, or
  delete the three empty style keys. Do not leave dead empty styles behind.
- `accessibilityState={{ selected }}` already exists on both chips (327, 341) —
  keep it.

**Tests.** Extend `mobile/__tests__/theme-tokens.test.tsx` (or add
`time-entry-form-contrast.test.tsx`): for both light and dark palettes, assert the
selected chip's resolved `backgroundColor` is not equal to the resolved text
`color`, and that the selected pair is (`palette.primary`, `palette.onPrimary`).
Assert the same for the unselected pair. This is a structural assertion on the
rendered style objects, not a pixel test, so it runs on Windows too.

**Exit criteria.** No rendered text color equals its own background in either
theme; no empty style objects remain in the touched block.

## S3 — Save confirmation: committed vs queued (Tier 1)

**Defect.** Saves give no feedback, and an offline-queued save is byte-identical
to a committed one.

### S3.1 — Make the outcome observable

In `mobile/src/auth/domains/timesheets.ts`:

- Change `createTimesheet` to `Promise<{ queued: boolean }>`. Set a closure flag
  inside the existing `onNetworkFailure` without altering the expression that
  feeds it, so the inferred generic `T` is unchanged:

```ts
let queued = false;
await withAuth((c, token) => c.createTimesheet(token, input, { idempotencyKey }), {
  errorMessage: 'You must be signed in to log time.',
  onNetworkFailure: () => {
    queued = true;
    return enqueueCreateTimesheet(input, idempotencyKey);
  },
});
await loadDashboard();
return { queued };
```

- This is additive: existing `await createTimesheet(...)` callers that ignore the
  value still typecheck. Do not touch `updateTimesheet` — it has no
  `onNetworkFailure`, so an offline edit throws and is reported as an error, which
  is the existing and correct behavior.
- Update the `useSessionActions()` type surface accordingly.

### S3.2 — Host the toast in the shell

`Toast` cannot live in `LogTimeScreen`: `onSuccess={navigateBack}` unmounts that
screen immediately, so a locally-owned toast would never be seen.

In `mobile/App.tsx`:

- Hold `{ message, type }` toast state in the shell and render `<Toast ... />`
  next to `<OfflineBanner />` inside `styles.screenContainer`, above
  `{screenContent}`.
- Replace `onSuccess={navigateBack}` with a handler that clears dirty, shows the
  toast, then navigates:
  - `log-time`, committed → `type="success"`, "Entry saved."
  - `log-time`, queued → `type="info"`, "Saved offline — will sync when you
    reconnect." Pair this with the `pendingCount` the `OfflineBanner` already
    shows so the two agree.
  - `edit-time` → `type="success"`, "Changes saved."
- Keep `durationMs` at the component default (3000) and let `onDismiss` clear the
  state. `Toast` already announces via `accessibilityLiveRegion="polite"`, so the
  confirmation reaches screen readers without extra work.

**Tests.** `log-time-screen.test.tsx`: a mocked `createTimesheet` resolving
`{ queued: false }` yields the success copy; `{ queued: true }` yields the offline
copy. A `timesheets-domain` unit test: when `withAuth` invokes
`onNetworkFailure`, `createTimesheet` resolves `{ queued: true }` **and**
`enqueueCreateTimesheet` is called exactly once with the same idempotency key as
the attempted request.

**Exit criteria.** Every successful create and update produces visible, announced
feedback; queued and committed saves read differently; the idempotency key is
provably unchanged.

## S4 — Human-readable dates where humans read them (Tier 1)

**Defect.** `2026-10-24` appears in card bodies, four accessibility labels, and —
most seriously — in two irreversible delete confirmations.

- `mobile/src/components/TimesheetEntryCard.tsx`: render
  `formatDatePreview(entry.log_date)` at line 71 and in the accessibility labels
  at 53, 89, 106, 118. Import from `../utils/dates`.
- `mobile/src/screens/HomeScreen.tsx:88` and
  `mobile/src/screens/TimesheetListScreen.tsx:228`: use the formatted date in the
  `Alert` body so the user confirms a date they can read.
- Leave the entry form alone — it already previews (`TimeEntryForm.tsx:281-283`).
- Leave machine-facing values alone: API payloads, `TimesheetListParams`,
  `TextInput` values, and the ISO value inside `DateChooserModal`'s input.
- `formatDatePreview` returns `'Invalid Date'`-equivalent handling via
  `isValidISODate` in its existing call site; confirm it degrades safely for a
  malformed stored value rather than throwing, and fall back to the raw string if
  not.

**Tests.** Extend `mobile/__tests__/ui-components.test.tsx` for the card, and
`home-screen.test.tsx` / `timesheet-list-screen.test.tsx` for the two confirms:
the alert body contains the formatted date and not the ISO string.

**Exit criteria.** No raw `YYYY-MM-DD` in any user-visible string or
accessibility label; machine-facing ISO values untouched.

## S5 — Real date picking in the entry form (Tier 2)

**Defect.** The primary entry form still requires hand-typing `YYYY-MM-DD`, while
a finished, tested picker ships in the app and is wired only into the duplicate
flow (`TimesheetListScreen.tsx:690`).

- In `mobile/src/components/TimeEntryForm.tsx`, make the date field open
  `DateChooserModal` (`title="Entry date"`, `initialDate={logDate}`,
  `onConfirm` → `setLogDate`), keeping the `-1d` / `+1d` steppers and the
  quick chips as fast paths.
- Keep manual typing available — the modal already contains a validated
  `TextInput` and `DateChooserModal.tsx:187` labels it; do not remove the inline
  field without confirming no flow depends on it. Preferred shape: the inline
  input stays, and a calendar affordance opens the modal.
- `DateChooserModal` hardcodes duplicate-flavored strings
  ("Duplicating to:", `accessibilityLabel="Duplicate target date"`,
  "Confirm Duplicate"). Parameterize these via optional props with the current
  values as defaults, so the existing call site is behaviorally unchanged.
- Verify Windows layout through `useModalBounds(480, 560)` — already covered by
  `mobile/__tests__/windows-modal-layout.test.tsx`; extend it to the new call
  site.

**Tests.** `log-time-screen.test.tsx`: opening the picker and confirming a date
updates the field and marks the form dirty; the duplicate flow's existing
assertions in `date-aware-duplication.test.tsx` still pass with the
parameterized copy.

## S6 — Inline validation and scroll-to-first-error (Tier 2)

**Defect.** Validation fires only on submit and reports into one box above the
form; on a long form the user may not see it, and never learns which field failed.

- In `mobile/src/components/TimeEntryForm.tsx`, move per-field validation to blur
  (and re-validate on change once a field has been touched), keeping the existing
  submit-time validation as the authoritative gate at ≈ 203-226.
- Render each field's message beneath that field, set `borderColor: palette.error`
  on the offending input, and set `accessibilityLabel`/`accessibilityHint` so the
  message is associated with the field for screen readers.
- Keep the summary box (251-255) for submit-time failures, and on submit failure
  scroll the first invalid field into view: hold a `ScrollView` ref plus per-field
  layout offsets (`onLayout`) and call `scrollTo`. Guard for Windows, where
  `scrollTo` behavior differs — no-op rather than throw.
- Do not change validation rules. This slice changes *when* and *where* errors
  appear, not *what* is valid.

**Tests.** `log-time-screen.test.tsx`: blurring an empty required field shows an
inline message; fixing it clears the message; submitting an invalid form keeps the
summary box and invokes the scroll ref.

## S7 — Touch-target compliance (Tier 2)

- `mobile/src/components/TimeEntryForm.tsx`: `chip` `minHeight: 38` → 44 (811);
  `hourStepChip` `minHeight: 36` → 44 (837). Where raising the height would break
  the horizontal chip scroller's density, keep the visual height and add
  `hitSlop` to reach 44.
- `mobile/src/components/BottomNavBar.tsx`: raise the 38×38 action button to 44×44
  (or 48 on Android) and keep its `hitSlop`.
- `mobile/src/components/TimesheetEntryCard.tsx`: the 22px checkbox keeps its
  visual size; raise its pressable bounds to 44 via a wrapper with
  `minHeight`/`minWidth` 44, consistent with `actionButton` (219-225).
- Add a disabled visual state to `PressableScale` — it currently only skips the
  press animation when `disabled` (lines 83, 99), giving no visual signal. Apply
  reduced opacity via style, not a new dependency.

**Tests.** Extend `mobile/__tests__/ui-components.test.tsx` with a target-size
assertion over the touched components: resolved `minHeight`/`minWidth` ≥ 44, or an
explicit `hitSlop` that closes the gap.

## S8 — Project shortcuts and form density (Tier 3)

- `TimeEntryForm.tsx:247` — replace `projects.slice(0, 4)` with recency ranking.
  `recentWorkStore` already exists (`mobile/__tests__/recent-work-store.test.ts`);
  read the user's recent project ids from it, rank those first, then backfill from
  the API order to four. Fall back to the current behavior when the store is
  empty, so a first-run user is unaffected.
- Collapse the Telegram preview card (626-636) behind a disclosure, default
  collapsed, so it stops consuming prime vertical space above the save action.
  Persist the open/closed choice if a settings surface already exists for it;
  otherwise keep it per-session.
- Keep the existing "Copy last entry" row (269-274) — it is the fastest path and
  should remain the first thing in the form.

**Tests.** `project-selection.test.tsx`: with recent work present, the shortcut
row leads with the most recent projects; with an empty store, it matches today's
first-four behavior.

## S9 — List ergonomics (Tier 3)

In `mobile/src/screens/TimesheetListScreen.tsx` and
`mobile/src/components/TimesheetEntryCard.tsx`:

- Make the card root pressable (it is a plain `View` at
  `TimesheetEntryCard.tsx:39`) so tapping a row opens edit, and add long-press to
  enter selection mode. Keep the explicit "Select" button (472-481) as the
  discoverable path; long-press is the accelerator, not the only route.
  `accessibilityRole="button"` plus an `accessibilityActions` entry for selection
  so the behavior is reachable without a long press.
- Group the list by day with a header per day showing that day's total hours.
  Compute totals from the already-loaded page; do not add a request. Preserve the
  existing request-coalescing (`nextLoadIdRef`/`activeLoadRef`), optimistic delete
  with rollback, and the `hasLoaded` empty-vs-failed distinction — these are
  load-bearing and must not regress.
- Replace `errors.join('\n')` in the two `Alert`s (331, 397) with a summarized
  message: counts of succeeded/failed plus the first one or two reasons, and a
  path to see the rest. Keep the full detail available; stop dumping it into a
  modal.
- Add an absolute date-range filter alongside the existing All / 7 / 30 relative
  options, reusing `DateChooserModal` for both bounds.

**Tests.** `timesheet-list-screen.test.tsx`: day headers and per-day totals match
the fixture; tapping a card opens edit; long-press enters selection; a partial
batch failure renders the summarized message and not the joined dump; existing
coalescing and rollback assertions still pass.

## S10 — Home and sign-in polish (Tier 4)

- `HomeScreen.tsx:176-207` — collapse three profile entry points to one. Keep the
  explicit "Profile" button; drop the redundant pressable wrapper on the identity
  block or vice versa, whichever survives a11y review.
- `HomeScreen.tsx:226-242` — resolve the `label="This Week"` /
  `dateLabel="Last 7 days"` contradiction. Decide which the dashboard actually
  returns (`dashboard.week`) and make the label match the data; do not relabel the
  UI to hide a semantic mismatch in the payload.
- `HomeScreen.tsx:220` — delete the dead `isLoading` branch (unreachable behind
  the early return at 153).
- `SignInScreen.tsx` — add `autoComplete="email"` / `textContentType="emailAddress"`
  and `autoComplete="current-password"` / `textContentType="password"` so platform
  password managers work. Keep the existing focus chaining and show-password
  behavior. Note this file is on the `theme-source-guard` allowlist because it is
  pre-branding UI — do not introduce `useTheme()` there as part of this slice.

**Tests.** `home-screen.test.tsx` for the single profile entry point and the
metric label; a sign-in render assertion for the autofill attributes.

## Deferred items

Each is deliberately out of scope with a stated reason.

- **Haptic feedback on save/selection.** Requires a dependency. The repo policy
  demands a documented RN 0.84 / new-architecture / Android / iOS / maintenance
  assessment first, and `react-native-windows` 0.84 — a shipped target — has no
  Vibration support, so an RN-core shim would need a platform branch for a purely
  decorative effect. Revisit as its own dependency-evaluation task.
- **Native date/time picker.** `DateChooserModal` is pure JS, already tested, and
  already handles Windows bounds. A native picker buys platform familiarity at the
  cost of a dependency and a third platform story. Not worth it now.
- **Gesture-based swipe actions on list rows.** Needs a gesture library; the
  long-press accelerator in S9 covers the same intent with zero dependencies.
- **Biometric unlock on sign-in.** Dependency plus a security review of how it
  interacts with the stored refresh token and `SessionController` lifecycle. Out
  of scope for a usability pass.
- **Navigation library migration.** The reducer is adequate once S1 activates what
  it already implements.

## Verification

Per slice, run the focused suites named in that slice. On the settled change set,
run the full mobile gate:

```bash
cd mobile && npm run lint && npm run typecheck && npm test && npm run test:windows
```

Also required before calling Tier 1 done:

- Manual pass on at least one real platform for: tab-switch-while-dirty,
  Android back-while-dirty, discard vs keep editing, a committed save, and an
  airplane-mode save showing the queued copy.
- Light **and** dark mode check of the date chips (S2) and the discard dialog
  (S1.3).
- Windows render check for the discard dialog and any modal touched by S5, since
  `jest.config.windows.js` covers component shape but not layout.
- `git status --porcelain` diffed against the S0 baseline: only the files the
  landed slices name should differ.

Report which checks passed, which were skipped, and why. Do not describe the
manual passes as done unless they were actually run on a device or emulator.

### Verification status after S5–S10

- **Earlier worktree verification**, reported at `7fb2317` with uncommitted
  changes present: `npm run lint` (0 errors; 45 warnings), `npm run typecheck`
  (0), `npm test` (54 suites / 381 tests), `npm run test:windows` (54 suites /
  381 tests). These results included separate session-lifecycle and date-shortcut
  audit work; they did not establish that a clean checkout of `7fb2317` worked.
- **Committed-source verification**, October 3, 2026: the isolated candidate
  committed as `8d3a81c` passed `npm run lint` (0 errors; 45 warnings),
  `npm run typecheck` (0), `npm test` (53 suites / 353 tests), and
  `npm run test:windows` (53 suites / 353 tests). The missing `ConfirmDialog`,
  queued-create return contract, dirty/outcome tests, and readable-date test
  adjustment are now committed. Existing installed dependencies were reused;
  unrelated working-tree source changes were excluded. Jest runs in band via
  the scripts' existing `--runInBand` default.
- **Windows production JavaScript bundle passed**, October 3, 2026, from an
  archive of committed source at `b66a511` (same application source as
  `8d3a81c`). Metro reused installed dependencies, with the shared `@vsis/*`
  packages explicitly resolved to the archive's source. This checks bundling,
  not a native Windows build or a device render.
- **Every Tier-1 review defect has a test that fails against the old code**:
  the three-deep discard (`navigation-reducer.test.ts`, plus the shell flow),
  the late-save/new-draft race and the repeated-toast lifetime
  (`discard-guard-shell.test.tsx`), and one assertion per ISO surface that the
  readable form renders and the ISO string does not.
- **Added or extended tests** for every behaviour this plan changes: chooser
  copy and Windows bounds (S5), blur/clear/scroll validation (S6), touch targets
  and the disabled state (S7), recency ranking and the collapsed preview (S8),
  day grouping, row tap/long press, the summarized batch report and the absolute
  range (S9), the single profile target, the rolling-window label and sign-in
  autofill (S10).
- **Skipped — not run at all:** the manual platform passes (tab-switch-while-dirty,
  Android back, discard vs keep editing, a committed save, an airplane-mode save)
  and the on-device Windows render check of the discard dialog and the modals
  touched by S5/S9. `jest.config.windows.js` covers component shape, not layout,
  so those remain open, and Tier 1 is not fully complete until they are recorded.
  Light/dark contrast for the date chips **is** covered by
  `time-entry-date-chips.test.tsx` as a structural assertion, not by eye.

## Risks

| Risk | Mitigation |
| --- | --- |
| Dirty wiring nags users on untouched forms | S1.1 lands the baseline-snapshot predicate **before** S1.2 wires it; a dedicated test asserts the async-default case |
| Guard blocks the post-save navigation | S1.1 clears dirty before `onSuccess`; covered by test |
| `CONFIRM_DISCARD` flattening surfaces a wrong back-stack | S1.4 asserts the two-deep case and fixes the reducer only if observable |
| Changing `createTimesheet`'s return type breaks callers | Additive (`void` → object); typecheck is part of the gate |
| Toast hides the offline banner | Both render in the same region; verify stacking and `zIndex: 999` against `OfflineBanner` in light and dark |
| Parameterizing `DateChooserModal` copy regresses the duplicate flow | Current strings become defaults; `date-aware-duplication.test.tsx` must pass unchanged |
| Touch-target growth breaks dense chip scrollers | Prefer `hitSlop` where height growth would reflow; assert via resolved style, not screenshots |
| S9 regresses list correctness | Request coalescing, optimistic-delete rollback and `hasLoaded` semantics are named as must-not-regress with existing tests as the gate |

## Implementation notes

Where Tier 1 landed differently from the slices above, and why.

- **S1.5 — the `CONFIRM_DISCARD` rebuild *was* observable; corrected in review.**
  The Tier-1 note here claimed the rebuilt stack equalled a clean `GO_BACK` for
  both routes that arm the guard. That was wrong: it compared only stacks where
  the tab beneath the form had been reached by `SWITCH_TAB`, which resets history
  to `[tab]`. The dashboard pushes `timesheets` (it does not switch to it), so
  `dashboard → timesheets → log-time` arms the guard three deep and the rebuild
  dropped the dashboard frame. `CONFIRM_DISCARD` now records the intercepted
  action (`pendingAction`) and replays it against a clean form, so a back press
  pops to its frame, a tab switch starts that tab, and a push appends its route —
  identical to the untouched transition by construction, with no duplicated
  stack arithmetic. `navigation-reducer.test.ts` pins that equality and fails
  against the old rebuild.
- **S1.1 — the baseline follows the defaults.** The plan called for re-seeding a
  snapshot after the `'internal'` default lands. Implemented as a `baselineRef`
  that the defaults effect advances only while the form still equals it, which
  keeps the original defaulting behavior (empty fields are still filled even if
  the user typed elsewhere first) and makes the first emission on mount `false` —
  so mounting a form also clears a stale dirty flag left by a previous one.
- **S1.1 — clearing the guard is the shell's job, not the form's.**
  `finishEntrySave` dispatches `SET_DIRTY(false)` before `GO_BACK` in the same
  tick, so the reducer sees a clean form regardless of whether the form's own
  post-submit reset runs. `LogTimeScreen`/`EditTimeScreen` needed no new
  contract for this.
- **S3 — `onSuccess` carries the outcome.** `LogTimeScreen.onSuccess` is now
  `(outcome: { queued: boolean }) => void`; `EditTimeScreen`'s stays argument-less
  because an offline edit cannot be queued (`updateTimesheet` has no
  `onNetworkFailure`). The domain flag is set inside the existing
  `onNetworkFailure`, leaving the inferred generic untouched.
- **S3 — queuing requires an idempotency-capable server.** `enqueueMutation`
  refuses unless the server advertises `durableIdempotency`, so against any other
  server an offline save surfaces as an error rather than a queued confirmation.
  The shell tests assert this by advertising the capability.
- **S2 — the project and activity chips were already correct.** Only
  `presetButton`/`presetText` were missing their selected state. The empty
  `chipActive` style was removed; `presetButtonActive`/`presetTextActive` now
  carry the elevation and weight that distinguish the selected chip, with the
  colors coming from the runtime palette at the call site (the theme source
  guard forbids a fixed primary here).

Where Tier 2–4 (S5–S10) landed differently, and why.

- **S5 — the range/entry chooser gained copy props, not a second modal.**
  `DateChooserModal` now takes `dateInputLabel`, `previewLabel`, `confirmLabel`,
  `confirmAccessibilityLabel` and `cancelAccessibilityLabel`, each defaulting to
  the duplicate-flow string it already had, so `date-aware-duplication.test.tsx`
  and `windows-modal-layout.test.tsx` pass unchanged. The entry form keeps its
  inline ISO field, the `-1d`/`+1d` steppers and the quick chips, and adds a
  calendar button as the new affordance.
- **S6 — scroll-to-error travels through a ref the screen owns.** The form does
  not own a `ScrollView` (its host screens do), so `TimeEntryForm` takes an
  optional `scrollViewRef` from `LogTimeScreen`/`EditTimeScreen` and combines
  per-field `onLayout` offsets with the container's own. Without a ref it still
  reports the failure; on Windows it deliberately no-ops instead of forcing a
  jump. Validation rules are unchanged and were moved into one
  `validateField(key, values)` that both the inline messages and the submit gate
  read, so the two can no longer drift apart.
- **S7 — the nav action grew rather than leaning on `hitSlop`.** `Float`ing the
  38×38 button to 44×44 needed the 56px tab row to become 60px; the existing
  `hitSlop` stays. `PressableScale` gained an explicit disabled opacity because a
  disabled control previously looked identical to an enabled one.
- **S8 — recency comes from the dashboard, not `recentWorkStore`.**
  `recentWorkStore` stores work-description strings only; it holds no project
  ids. Ranking therefore reads `dashboard.recentEntries` (already loaded, and the
  same source the form uses for "Copy last entry"), which is server-authoritative
  and survives restarts where the in-memory store does not. With no recent
  entries the row is exactly the previous first-four reference order. The
  Telegram preview collapses behind a Show/Hide disclosure whose state is
  module-scoped, so it survives screen switches for the session; it is not
  persisted because no settings surface owns it.
- **S9 — the list stays a `FlatList` over day rows rather than becoming a
  `SectionList`.** The grouped rows are flattened into `{kind: 'day'} |
  {kind: 'entry'}` items, which keeps every existing `FlatList` prop — request
  coalescing, pagination, `RefreshControl`, `ListEmptyComponent` — literally
  untouched, and makes day totals a pure function of the loaded page.
- **S9 — the card root is one accessibility element, so its actions moved with
  it.** A pressable card groups its children on iOS, which would have hidden the
  Edit/Duplicate/Delete buttons from VoiceOver. Every one of those actions —
  plus select/deselect — is therefore also declared in the root's
  `accessibilityActions`, so nothing needs a long press or a sighted guess. The
  explicit "Select" toolbar route remains.
- **S9 — batch failures are reported inline, not in an `Alert`.** Both bulk
  operations now set a dismissible report showing succeeded-of-total, the failed
  count, the first two reasons and a disclosure for the rest, keeping the full
  list available. Nothing joins server errors into a modal body any more.
- **S10 — the week metric was mislabelled, not the payload.** `dashboard.week`
  is a rolling 7-day window (`from = today - 6`, `to = today`;
  `lib/api/v1/services/dashboard.ts`). The label now says "Last 7 Days" and the
  caption shows that exact payload window. Because the plan forbids raw ISO in
  human-facing copy, the caption goes through a new compact
  `formatDateRangeShort` ("Aug 20 – Aug 26, 2026") rather than interpolating the
  two ISO bounds.
- **S4 gap closed while doing S10.** `HomeScreen`'s delete confirmation still
  interpolated `entry.log_date`; it now uses `formatDatePreview` like the list
  screen's confirmation, and `timesheet-list-screen.test.tsx` gained the
  regression test S4 asked for (the list screen is where that button is
  reachable in the test harness — see the follow-up below).

Review fixes (Tier 1 round two).

- **S3 — a save that outlives its form damaged the draft that replaced it.**
  Three paths, all now closed: the entry screens reported success after
  unmounting (so the shell navigated away from the newer draft),
  `TimeEntryForm`'s post-submit tail called `onDirtyChange(false)` from the dead
  form (clearing the newer draft's guard), and the shell's single `Toast`
  instance let a second confirmation inherit the first one's remaining lifetime.
  Screens and the form now check a mount ref before touching shell state, and
  each confirmation carries an id so it remounts the `Toast`; `Toast` also treats
  a changed message as a new lifetime. `discard-guard-shell.test.tsx` drives both
  races and fails against the previous behaviour.
- **S4 — the ISO sweep went past the two named surfaces.** The edit screen's
  header, the duplicate chooser's "from" line, the dashboard's Today caption and
  four leave surfaces (row text, delete label, leave-admin row, both leave delete
  confirmations) still printed the stored value. All now use `formatDatePreview`
  or the new compact `formatDateShort`.

### Follow-ups this work surfaced but did not take

- `SettingsAdminScreen` logs time for another user and reports "Timesheet logged
  successfully for user." even when the write only reached the offline queue. The
  information needed to distinguish the two is now available from
  `createTimesheet`'s return value; the copy was left alone as out of scope.
- Workspace brand colors are used verbatim as `palette.primary` in both themes
  with a fixed white `onPrimary`. A brand color light enough to fail contrast
  against white would make every primary button unreadable, not just these chips.
  The contrast test pins the shipped default (`#1E73BE`) but the general case is
  a theme-level decision.
- `HomeScreen` gates the dashboard entry card's delete button on
  `entry.user_id === actor?.id`, while the same screen resolves
  `effectiveActor = actor ?? dashboard?.actor` for its capability checks. When
  the session actor is not populated (the dashboard payload is the only source),
  the delete affordance silently disappears. The list screen already uses
  `effectiveActor || actor`. Left alone because it changes which users see a
  delete button and is not part of this plan.
- `MetricCard`'s "Today's Hours" caption still prints `dashboard.today.date`
  verbatim, i.e. a raw ISO date in user-facing copy. S4 named the card body, the
  accessibility labels and the two delete confirmations only; a compact
  day-level formatter would be the follow-up.
