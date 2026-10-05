# Windows device acceptance — 2026-10-03

> Archived 2026-10-04 as supporting reference. Recorded evidence, contracts and
> unverified limitations retain their scope; this move marks no pending check complete.
> Current work follows the [active plans](../../README.md#active).

## Current target and gate

The user selected a Windows PC and confirmed a test workspace where test entries
may be saved, copied, and deleted. The user reported building and installing
**1.1.6** on 2026-10-03. Computer Use verified **v1.1.6** on the More
screen, replacing the earlier 1.1.5 acceptance target. The user subsequently
resumed acceptance and restricted Computer Use to **monitor 2**. The newly
opened window initially reported **v1.1.0**. After the user opened the repaired
app, Computer Use reverified **v1.1.6** and resumed checks in that selected window.
The user subsequently confirmed "computer use part completed" on 2026-10-03.
The Computer Use work item is **COMPLETED — USER CONFIRMED**; no further native
interaction or resize is scheduled. Individual results below retain their
observed evidence and are not automatically converted to PASS by this completion.

The previous 1.1.5 acceptance artifact was
`mobile/build/windows/VsisTimesheetMobile.Package_1.1.5.0_x64.msix`.
Read-only package inspection confirmed manifest version **1.1.5.0**, an
`AppxSignature.p7x` entry, and the `windows-modal-overlay` repair marker in both
packaged Windows bundles. Signature presence was checked; certificate trust was
not independently validated. Computer Use subsequently observed the installed
app's More screen reporting **v1.1.5**.

Acceptance artifact SHA-256:
`886FC1499E9A9FD7580CF338F5929719ED5E2790F667AE58D0E02C2AEDD8588A`.

The bundled Computer Use skill's `node_repl` / `@oai/sky` runtime provided native
Windows controls on 2026-10-03. The earlier statement that native controls were
unavailable applied to the separate browser-control surface and is superseded.
Installed 1.1.5 checks found WIN-01. Installed 1.1.6 verifies the duplicate
chooser rendering repair, with partial keyboard and validation acceptance.
The Computer Use work item is **COMPLETED — USER CONFIRMED**, with partial
recorded technical coverage: entry-date rendering in a wide window, valid
copying, idle keyboard cycling, and project selection were verified. Narrow/short
entry-date rendering, pending Escape behavior, offline flow, and screen-reader
speech have no recorded final result. WIN-02 remains an unresolved observation.
Unit tests do not substitute for those device checks.

### Resumed target check — monitor 2

The user instructed Computer Use to use only monitor 2, then opened a new app
window and explicitly selected it. The selected window belongs to
`Chankramana.VSISTimesheet_dmq8jgh51zaj0!App`; its dashboard contains the retained
synthetic entry. Keyboard navigation opened More, which visibly reports
**VSIS Timesheet v1.1.0 · Mobile Edition**. This window cannot verify the 1.1.6
repair. No window was moved, and no entry was created, copied, or deleted during
this target check. The user was asked to open the installed 1.1.6 app on monitor 2.
The user then opened `VsisTimesheetMobile_mgw7vmeh768pp!App` and replied ready.
More reported **v1.1.6**. Subsequent checks below use this repaired app, without
moving its window to another monitor. The automated resize attempt left the
1714×921 window unchanged; a user-assisted resize was requested at that time.
The later user completion confirmation closes the Computer Use work item without
adding a recorded resize result.

## Repair build — 1.1.6

`DateChooserModal.tsx` now explicitly overrides Windows body `flexGrow` to 1,
preventing the shared `flexGrow: 0` from collapsing its scroll viewport. Windows
bounds and compact actions now use positive backdrop `onLayout` measurements,
with window dimensions as the initial fallback. Resizing preserves the selected
date and ignores zero-size layout events. Android/iOS keep their native modal
and existing body growth behavior. Decision packet:
[`WINDOWS_DATE_BODY_REPAIR_PACKET.md`](../../ai-context/WINDOWS_DATE_BODY_REPAIR_PACKET.md).

Verification on the settled 1.1.6 source:

- Regression reproduced the old `flexGrow: 0` failure before the fix; 15 focused
  layout/overlay tests pass after the fix.
- Standard mobile suite: 55 suites / 389 tests passed.
- Windows mobile suite: 55 suites / 389 tests passed.
- TypeScript passed; lint passed with 0 errors / 45 existing warnings.
- Windows bundle and x64 Release package passed, with 0 build errors / 13
  warnings. The sandboxed attempt failed with MSBuild FileTracker access denied;
  the authorized local build outside the sandbox succeeded.

Unsigned repair artifact:
`mobile/build/windows/VsisTimesheetMobile.Package_1.1.6.0_x64.msix`.
SHA-256:
`0B7220E110A8FB9C95A3EEE1B8FE66B8D9C93436D638EADA20B4F081F5449A80`.
Package inspection confirmed manifest version 1.1.6.0 and the measured-backdrop
marker in both bundles; there is no signature entry. The signed 1.1.5 artifact
remains unchanged. Signing configuration is absent from this session, and the
previous package signer's private key is absent from both personal certificate
stores. No certificate was created or exported.

The unsigned artifact and signing observations above describe the repair build
at creation time, not the subsequently installed package. The user subsequently
installed 1.1.6; native UI version verification succeeded. The table below
retains earlier 1.1.5 results where no retest occurred and records the new 1.1.6
duplicate-chooser checks explicitly.

## Acceptance checklist

Use the confirmed test workspace. Give new entries a distinct test description,
keep hours within the daily limit, and clean up only the entries created by these
checks after recording results. Report pass/fail and the observed behavior for
each case. Results below distinguish completed checks from partial observations.

| ID | Check | Expected result | Result |
| --- | --- | --- | --- |
| W01 | Open a new entry without changing it; navigate away. | No discard prompt on an untouched form. | PASS: navigation to Timesheets without a discard prompt. |
| W02 | Change a field, switch tabs, choose Keep editing, then repeat and Discard. | Keep retains the draft; Discard follows the intended navigation. | PASS: description retained with Keep editing; a subsequent hours draft was discarded and navigation reached Timesheets. |
| W03 | Save a valid test entry online. | One entry appears, the form closes, and the saved confirmation is visible. | PARTIAL: save closed the form, dashboard showed 0.5h, and Timesheets showed exactly one labeled entry. Transient saved confirmation was not captured. |
| W04 | After online initialization, disconnect, create a timesheet, then reconnect. | On a backend advertising durable idempotency, the queued confirmation and pending state appear, then exactly one entry syncs. If offline writes are unsupported, refusal is explicit and this case is recorded as unsupported. | NOT RUN |
| W05 | Inspect date chips and the discard dialog in light and dark mode. | Labels, selection, focus, and actions remain readable. | PARTIAL (1.1.6): date chips, selected Today/Yesterday, discard title/body, Keep editing, and Discard are readable in both themes. Discarded synthetic drafts follow the intended navigation. Dark theme restored. Native discard-popup keyboard focus remains unverified because input targets the parent window. |
| W06 | Open entry-date selection and duplicate-to-date in wide, narrow, and short windows; resize while open. | The date chooser stays inside the app; no tall native popup; scrolling and stacked actions remain reachable. | PARTIAL (1.1.6): prior Duplicate body visible at 1714×921 and 451×921; actions stack at 351×921; body scroll exposes date and preview at 351×431, and selected date survives resizing. Resumed entry-date check at 1714×921 shows all body controls and footer inside the app. Escape cancels without changing the form date; Use This Date applies the selected date. Narrow/short entry-date check awaits user-assisted resizing. |
| W07 | Enter an invalid duplicate date, cancel, reopen, and copy to a valid date. | Invalid input cannot submit; cancellation writes nothing; valid copy produces exactly one entry on the chosen day. | PASS (1.1.6, combined sessions): prior 2026-02-30 validation disables Confirm; Escape cancels with one original remaining. Resumed valid copy to 2026-10-02 produces exactly one 0.5h copy, retaining the original on 2026-10-03; list shows two labeled entries. |
| W08 | Use Tab, Shift+Tab, Enter, and Escape in the open date chooser. | Background actions cannot activate; all enabled dialog controls are reachable; Escape cancels, except during a pending operation. | PARTIAL (1.1.6): resumed entry-date forward cycle date → Cancel → Use This Date → overlay root → Close → Today → Yesterday → date reaches every enabled control and no background control. Shift+Tab reaches Yesterday; Enter selects it; Escape cancels. Duplicate pending state hides Close and disables shortcuts/Cancel/Confirm. Request completed by the next Escape capture, so pending Escape lock is inconclusive. See WIN-02 for an intermittent field/preview mismatch; a fresh direct Shift+Tab/Enter retest showed matching values. |
| W09 | Open a project picker with many options, search, and select its final result. | The list scrolls and the selected project persists. | PASS (1.1.6): full picker contains 43 options; scrolling advances the list. Search Support returns the final option, and selecting it closes the picker with Support selected on the form. The unsaved draft was discarded. |
| W10 | With a screen reader, inspect the open chooser and validation feedback. | Controls have meaningful labels; underlying content is not exposed as active dialog content. | PARTIAL: UI Automation tree contains chooser labels and excludes underlying app controls; no screen-reader speech or validation announcement check performed. |

## Finding ledger and retained test data

| ID | Evidence | Failure scenario | Next action | Remaining verification |
| --- | --- | --- | --- | --- |
| WIN-01 | Native screenshots and UI Automation on installed 1.1.5; resumed 1.1.6 checks | Entry date and Duplicate Timesheet previously rendered the header/footer without the body. | FIXED IN SOURCE; Duplicate rendering verified across wide/narrow/short windows, entry-date rendering verified wide, and valid copy verified on installed 1.1.6. | Narrow/short entry-date rendering, pending-operation Escape lock, and screen-reader acceptance. |
| WIN-02 | Native screenshots and UI Automation during entry-date keyboard cycling on installed 1.1.6 | After focusing the date field, completing a forward focus cycle, then Shift+Tab/Enter on Yesterday, preview showed 2026-10-02 while the field still showed 2026-10-03 in the immediate and subsequent capture. Use This Date applied 2026-10-02 correctly. | OPEN OBSERVATION: source updates selectedDate and customInput together in DateChooserModal.tsx; cause is unknown. Mouse selection in Duplicate and a fresh direct field → Shift+Tab → Enter retest both showed matching values. | Reproduce the full-cycle scenario manually and distinguish native input/render timing or capture behavior from a persistent application defect before patching. |

One test entry was saved on **2026-10-03**, project **Internal**, activity
**Certification**, **0.5 hours**, description
`CUA acceptance 1.1.5 2026-10-03 synthetic test only`.
The original remains retained. The resumed 1.1.6 check created one copy on
**2026-10-02**, retaining the same project, activity, hours, and description.
Exactly two entries were observed after completion. No persisted entry was
deleted; cleanup remains pending. Other date/project/theme drafts were discarded
without saving. Dark theme was restored. No offline/network-setting or
screen-reader changes were made. At the last observed state, the entry-date
chooser was open with Yesterday selected. Its state and cleanup were not
reinspected after the user's completion confirmation.

W01–W10 cover the selected Windows leg of
`MOBILE_UI_USABILITY_IMPROVEMENT_PLAN.md` and the archived duplicate-dialog repair.
Android-specific back navigation and iOS/Android parity remain separate device
legs. Installed-app loading measurements remain pending: Computer Use capture
latency is not an application performance measurement. Independent loading
regression and migration readiness work can proceed.
