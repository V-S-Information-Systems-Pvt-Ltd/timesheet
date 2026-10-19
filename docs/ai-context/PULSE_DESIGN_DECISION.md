# Pulse visual alignment — 2026-10-09

## Decision and acceptance

Apply the design language of the signed-in Internal Pulse website to the existing
web timesheet module. Match typography, white/slate surfaces, green accents,
270px desktop navigation, compact headers, rounded controls and quiet tables.
Keep routes, authorization, data operations, workspace names/logos, mobile drawer,
and theme preferences intact. Verify responsive navigation, light/dark contrast,
existing UI regressions, type/lint checks and both backend builds.

## Evidence

- FACT: Browser inspection of `/service-management/manage-sla-coverages` found
  Public Sans 400–700, white background, `#1C252E` text, `#637381` secondary text,
  `#F4F6F8` neutral surface, `#00A76F` primary, `#007867` dark primary, 8px nav
  corners, 44px navigation rows and a 72px desktop header.
- FACT: Atlas and Serena locate the shared shell, cards, controls, tables and
  page headings in `app/components/ui.tsx`; semantic colors are in
  `app/globals.css`. `app/layout.tsx` self-hosts fonts and injects branding shades.
- FACT: `lib/branding.ts:derivePalette` is shared branding behavior. The web
  presentation should adapt the built-in VSIS blue without changing persisted
  settings, the API or mobile defaults. Custom workspace colors retain their
  existing derived palette.
- FACT: `e2e/ui-polish.spec.ts` provides isolated browser fixtures for navigation,
  responsive layouts and axe checks. `e2e/a11y.spec.ts` also covers auth screens.
- INFERENCE: Shared components plus the login/dashboard decorative elements are
  sufficient; adopting Pulse's component framework would add unnecessary scope.
- UNKNOWN: Future hosting, SSO and module routing contracts are not specified and
  are outside this visual change.

## Alternatives and constraints

Choose semantic token and shell restyling over a framework replacement or a
second UI. Self-host the observed font assets to preserve offline builds.
Use Pulse dark green for white-text actions (AA contrast), with its main green
for highlights. Preserve custom branding via the existing palette derivation;
map the built-in default blue to the Pulse palette only at the web layout.

No persistence, lifecycle, retry or concurrency changes. No architecture model
escalation is required. Initial worktree was clean. Superdesign CLI could not
load from the restricted npm cache; signed-in browser DOM/computed-style
inspection supplies the reference evidence instead. No private page data is
sent to an external design service.
