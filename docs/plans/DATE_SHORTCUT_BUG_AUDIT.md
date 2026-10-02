# Date chooser shortcut audit

## M2 decision packet

### Decision required

Refresh calendar shortcuts when a retained date chooser reopens after midnight.
Use the current local date for Today/Yesterday while preserving explicit
`initialDate` and existing validation/loading behavior. No timer architecture or
backend/API change is required.

### Current architecture and evidence

- FACT: `DateChooserModal.tsx:45` memoizes `todayISO()` once per mount, then derives
  Yesterday from it. Its opening effect separately recomputes the default date.
- FACT: `TimesheetListScreen.tsx:690` retains the chooser in the component tree and
  controls its `visible` property; shortcuts therefore survive closed sessions.
- FACT: fake local clock reproduction opened at 2026-10-01 23:59, closed, advanced
  to 2026-10-02 00:01 and reopened. The default became October 2, but confirming
  Today submitted October 1 and Yesterday submitted September 30. Both regression
  cases failed on the original modal; explicit September 15 initial date passed.
- FACT: existing invalid-input test disables confirmation and permits corrected
  input. This behavior must remain unchanged.
- INFERENCE: a long-lived screen can duplicate entries onto unintended dates.
- UNKNOWN: production frequency; no telemetry consulted.

### Lifecycle invariant and alternatives

Each visibility transition should derive shortcuts from the current local date.
Opening initializes the selection from explicit `initialDate` or that current
date. User edits during one opening must not be reset on unrelated rerenders.
Closing retains the modal instance; reopening obtains fresh shortcuts. There is
no persisted artifact or concurrent external transition to coordinate.

- Proposed: make Today memoization depend on `visible`; Yesterday still derives
  from Today. This refreshes the anchor on open/close without timers or changes to
  selection initialization.
- Alternative: compute Today every render; simple but also changes shortcuts on
  arbitrary rerenders while an opening spans midnight.
- Rejected: interval or midnight timer; unnecessary for the verified reopen bug.

### Compatibility and acceptance

No prop, callback, mobile bearer, browser cookie, persistence or API changes.
Run date-aware duplication tests, focused mobile lint/typecheck, relevant screen
tests, then coordinator's settled mobile suite. Check both Today and Yesterday,
explicit initial date preservation and invalid input guards. Independent review
should verify the opening lifecycle and absence of user-input resets.

## Finding ledger

| ID | Source | Failure | Proposed repair | Verification | Remaining blocker |
| --- | --- | --- | --- | --- | --- |
| M2 | `DateChooserModal.tsx:45` | Reopening after midnight confirms stale shortcuts | Recompute calendar anchor on visibility transition | Original tests: 2 regressions fail, 6 pass; repaired chooser component 7 pass; mobile typecheck and scoped lint pass | Independent closure approved; final standard and Windows mobile suites passed |

### Settled implementation and verification boundary

Today memoization now depends on `visible`; its intentional lifecycle dependency
is documented. Four regressions cover Today, Yesterday, explicit initial date,
and custom input surviving an unrelated visible rerender. Existing invalid-input
and cancel behavior pass. Remaining continuously open across midnight is separate
scope; no timer was added.

The focused chooser component run passed 7 tests and deliberately skipped 2
screen integration cases. The combined date-aware/timesheet-list run failed 13
screen tests during concurrent M1 session-lifecycle edits (9 passed); mobile lint
failed on `SessionProvider.tsx:280` unnecessary `store` dependency. Those files are
owned by the M1 agent and remain untouched here. Repeat integrated verification
after M1 settles. Mobile typecheck and scoped modal/test lint passed; diff checks
passed. No architecture delta is required for this local UI correction.


## Settled integration verification

After M1 settlement, standard and Windows mobile configurations each passed all
49 suites / 324 tests, including date-aware and timesheet-list integration. Mobile
types, lint and Windows bundle passed. The earlier concurrent-edit failures are
resolved. Full batch evidence is in CONTINUOUS_BUG_AUDIT.md.
