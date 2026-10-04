# Windows UI repair — 2026-09-30

## Decision and acceptance

Keep the existing React Native Windows shell and shared screens. Bound startup to the launch monitor's work area; give native modal children explicit viewport dimensions; make overflowing form content scroll and narrow actions wrap. Preserve data, authentication, and Android/iOS behavior.

Acceptance: startup stays above the taskbar; project and activity pickers scroll to their final item; duplicate date validation and cancel remain intact; short/narrow dialogs retain reachable controls; executable branding matches existing VSIS package assets.

## Evidence packet

- FACT: `VsisTimesheetMobile.cpp:76` hard-codes 1000 × 1000. Live window was at (1550,80) with height 1000 on a display whose taskbar begins at y=1040.
- FACT: `SearchablePickerModal.tsx` has an unconstrained FlatList. Live UI Automation reports its viewport height as 2654 pixels and vertical view size 100%; mouse-wheel input does not move the first or final project.
- FACT: installed RNW `WindowsModalHostViewComponentView::AdjustWindowSize` sizes native windows from child layout; `UpdateConstraints` supplies only a maximum of 90% of the display work area. Thus intrinsic content height still needs application constraints.
- FACT: `DateChooserModal.tsx` uses side-by-side footer actions and has no body scroll area. The supplied screenshot shows compressed title and confirm label.
- FACT: project/activity/leave/reminder/title admin dialogs use non-scrolling cards; user forms have scroll containers without an explicit viewport bound.
- FACT: `PressableScale` inserts a centered column wrapper regardless of callers' row layout. Live dashboard metric cards shrink to their labels inside wide clickable regions; `MetricCard` lacks an explicit card width.
- FACT: executable `.rc` uses `small.ico`, independently of the existing branded MSIX PNGs.
- INFERENCE: explicit Windows modal bounds plus flex-constrained lists address the verified intrinsic-height problem without replacing virtualization.
- FACT: the final native Release build and unsigned MSIX packaging succeeded. A separately registered development test copy launched and restored the existing account through the application's own authentication flow; no time entries or administration data were saved.
- FACT: live UI Automation measured initial bounds (1462,52,1728,936), fully within the launch monitor's (1366,0,1920,1040) work area. Dashboard metric contents now occupy the full card width.
- UNKNOWN: final mouse-wheel, duplicate-dialog, and native titlebar screenshot checks were blocked after Windows locked. Unit rendering cannot prove native wheel scrolling; the user was asked to unlock Windows.

## Alternatives and constraints

Use shared bounds at existing modal roots, rather than replacing navigation or native RNW internals. Keep mobile modal presentation unchanged. Make administration cards scroll inside these bounds. Keep signed production installation intact; validate a local build separately. No backend, schema, public API, or permission changes.

## Finding ledger

| ID | Failure | Fix | Verification |
| --- | --- | --- | --- |
| W1 | Startup extends past monitor work area | Monitor work-area placement | Native build and monitor geometry |
| W2 | Picker grows to content; wheel cannot scroll | Bounded Windows root and flex list | Picker tests and native wheel check |
| W3 | Duplicate actions/text compressed | Bounded root, scrolling body, compact footer | Duplication regression tests and screenshots |
| W4 | Other form dialogs overflow short windows | Bounded roots and scrolling cards | Mobile suite and visual checks |
| W5 | Pressable rows lose layout; metrics shrink | Inherit content layout and full-width metric card | Component suite and dashboard screenshot |
| W6 | Date controls overflow narrow form | Wrap controls with a usable input basis | Form regression tests and narrow screenshot |
| W7 | Default native icon | Use branded ICO and set AppWindow icon | Native build and titlebar screenshot |
| W8 | Administration dialogs ignore native window X / Android back | Wire onRequestClose to existing cancel state | User administration cancellation regression |

## Verification results

- Mobile suite: 46 suites / 286 tests passed on the final UI revision, including close-without-create, invalid-date refusal, and final picker-result selection.
- Dedicated Windows test command: the same 46 suites / 286 tests passed on the final revision.
- TypeScript passed; mobile lint completed with zero errors and 45 warnings.
- Windows Release build and unsigned packaging passed with zero errors and 15 toolchain/bundle warnings. Output: `mobile/build/windows/VsisTimesheetMobile.Package_1.0.3.0_x64.msix`.
- Existing Store installation and original development package were not replaced. Final interactive validation requires an unlocked desktop; administration screenshots also require an authorized administrator account.
