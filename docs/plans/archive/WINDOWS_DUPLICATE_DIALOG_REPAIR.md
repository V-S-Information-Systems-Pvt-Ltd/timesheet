# Windows duplicate dialog repair — 2026-10-03

## Decision required

Render the shared date chooser inside the Windows application window rather than
letting the React Native Windows native modal determine its viewport.

## Evidence and constraints

- FACT: the supplied screenshot shows a tall, narrow native window with a title
  bar around the duplicate dialog.
- FACT: `DateChooserModal.tsx` bounds its backdrop, but RNW 0.84.0
  `Libraries/Modal/Modal.windows.js` wraps that child in its own `flex: 1` view.
  `WindowsModalHostViewComponentView.cpp` creates an overlapped window with a
  border/title bar, sizes it from the wrapper, and constrains it to the display
  work area rather than the application viewport.
- INFERENCE: bounding the nested backdrop does not reliably constrain that native
  wrapper. Existing renderer tests assert child styles and cannot detect this.
- FACT: `ThemedAppShell` owns the full application content, including navigation.
  A host here can cover navigation as well as the requesting screen.
- Preserve the date chooser's props, date validation, quick options, loading
  behavior, and Android/iOS native modal presentation. Other modal flows are out
  of scope. No persistence, authentication, or backend decision is involved.

## Alternatives and chosen protocol

Changing child dimensions again leaves the native wrapper and separate title bar
in control. Patching RNW's installed source is not a durable repository fix.
Choose a Windows-only application overlay host with owner IDs and cleanup.

Activation registers the visible chooser with the shell; normal close and screen
unmount remove only that owner's entry. Rerenders update the current content;
resizing recalculates the bounded dialog while the backdrop fills the shell.
Separate owner IDs prevent a stale unmount from dismissing a newer chooser.
Underlying content rejects pointer input and is hidden from accessibility while
an overlay is open; focus entering it redirects to the overlay. Escape follows
the existing cancel callback and is ignored during a pending operation.

## Acceptance checks

Windows renders no native `Modal` for this chooser. The overlay covers the shell,
the dialog stays inside narrow/short viewports, and its body scrolls. Verify
confirmation, invalid-input refusal, cancellation, loading lock, content updates,
close/reopen, unmount cleanup, and ownership isolation. Run mobile tests, lint,
TypeScript, and Windows bundling. Native interactive rendering remains a separate
check requiring an accessible Windows app session.

## Verification results

- Mobile and dedicated Windows test commands each passed 55 suites / 388 tests.
  Regressions cover resizing, invalid input, confirmation, reopening, cancellation,
  loading lock, focus redirection, and owner-specific unmount cleanup.
- Mobile TypeScript passed. Lint passed with zero errors and 45 warnings.
- Production Windows bundling passed. Windows x64 Release unsigned packaging
  passed with zero errors and 13 toolchain/bundle warnings after retrying outside
  the sandbox (the first attempt failed in Visual Studio's file tracker with
  access denied).
- Output: `mobile/build/windows/VsisTimesheetMobile.Package_1.1.4.0_x64.msix`.
  The package archive contains the updated overlay code and no AppxSignature.
- Live Windows visual, keyboard traversal, and screen-reader verification remain
  pending. The installed application was not updated. Web/database builds were
  not run because no web, shared domain, or persistence source changed.
