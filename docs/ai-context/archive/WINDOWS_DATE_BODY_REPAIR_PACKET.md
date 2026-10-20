# Windows date chooser repair decision — 2026-10-03

## Decision required and acceptance criteria

Resolve WIN-01: installed 1.1.5 renders the date chooser's header and footer but
no body. Both entry-date and duplicate flows must display shortcuts, editable
date, validation/preview, and reachable actions. Resizing must constrain the
dialog to the actual app viewport and preserve the selected date. Keep the
Windows app-root overlay and existing Android/iOS native-modal behavior.

## Verified evidence and architecture delta

- FACT — `DateChooserModal.tsx: styles.bodyScroll` supplies `flexGrow: 0`;
  `styles.windowsBodyScroll` supplies only `flex: 1`. Flattening retains both.
- FACT — the installed RN Yoga `Node.cpp: resolveFlexGrow` prioritizes an
  explicit `flexGrow` over `flex`; `processFlexBasis` gives positive flex a
  zero basis. This combination collapses the Windows scroll viewport.
- FACT — `ScrollView.windows.js: styles.baseVertical` defaults to grow/shrink
  1, then composes the supplied style over those defaults.
- FACT — Computer Use captured the missing body at 1714×921, 643×921,
  411×921, and 411×431. Header/footer width and height remained consistent with
  the original dimensions while the host resized; content clipped in the short
  window. UI Automation still exposes the body controls.
- INFERENCE — `useWindowDimensions` is insufficient for these installed RNW
  resize observations; the full-app backdrop's `onLayout` is the authoritative
  local viewport for this chooser.
- FACT — `WindowsModalHost` already handles owner registration, cleanup,
  background accessibility exclusion, focus redirection, and Escape. These
  mechanisms are independent of the body geometry and stay unchanged.

## Alternatives, constraints, and lifecycle

Selected: explicitly override Windows body `flexGrow` to 1 and use positive
backdrop layout measurements with the existing `modalBounds` calculation.
Window dimensions remain a fallback before the first layout. Ignore zero-size
layout events. React state updates only when the measured dimensions change;
resizing must not reset date input or register another overlay owner.

Rejected: changing shared mobile growth semantics, hard-coding body pixel
height, rebuilding native popup sizing, or adding a new modal package. These
expand platform impact or fail resizing/accessibility constraints.

Activation, reopening, completion, cancellation, loading lock, owner cleanup,
and competing owners keep the existing overlay protocol. This repair changes
only chooser layout; it introduces no retries, persisted artifacts, network
writes, or authentication/public-contract changes. A new package version keeps
the observed 1.1.5 artifact available for comparison and prevents accidental
reuse of that package as repair evidence.

## Validation and unresolved questions

Add a regression check for effective Windows body growth and layout-driven
resize while global window dimensions remain unchanged; cover invalid input
refusal and selected-date preservation. Run focused tests during repair and the
mobile standard/Windows suites, typecheck, lint, bundle, and x64 packaging on the
settled patch. Native retesting must verify pixels, scrolling, keyboard focus,
and valid/invalid duplicate outcomes. Actual new-package native rendering
remains UNKNOWN until the new build is run. This bounded local fix requires no
Astra escalation; the decision follows the repository packet template and
`ASTRA_ARCHITECT.md` scope policy.
