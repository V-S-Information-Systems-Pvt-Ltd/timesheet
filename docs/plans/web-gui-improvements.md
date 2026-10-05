# Plan: Web GUI improvements

> Scope: the **web** app only (`app/`). The mobile app (`mobile/`) is out of scope.
> Status: **complete** (verified 2026-10-04). All P0–P6 implementation items done; the two
> items resolved as deliberate decisions rather than code are noted below.
> P0 primitives + status tokens; P1 full sweep; P2 user-view grid + nav polish (change-password
> and keyboard-shortcuts now in the mobile drawer with visible labels); P3 async loading/error
> surfacing + import confirm/preview with a persistent results summary + leave-panel single-channel
> feedback + bulk-edit-modal (single Cancel, no misleading `required`); P4 ≥44px targets, `h-[38px]`
> removed, stacked user-whitelist/hierarchy, scroll affordance on the rest (plan's stated minimum);
> P5 dedicated icons (IconBotNumber/IconClear), `.card-in` motion, empty-state consistency, StatCard delta.
> P6 complete.
> **Decisions (no code, by design):** (1) admin tab is NOT split into labeled sections — fixed
> category headers conflict with the per-user tile reordering (PanelCustomizer); (2) the dashboard
> header and the cyan/red brand accents stay calm/auth-only per brand guidance ("color for hierarchy,
> not decoration"). Deferred: admin `/admin` route split, left-sidebar nav, sparklines.
> House style: follows `docs/plans/` (see `duplicate-ux-and-mutation-latency.md`).

## Context & goal

The web GUI is already in good shape. PR #11 (`0cf125a feat(ui): improve web
GUI and timesheet mutation UX`) recently delivered dark mode, a unified
date-range control, lazy-loaded charts, optimistic timesheet mutations, and
responsive polish. The design system in `app/components/ui.tsx` is mature
(Button/IconButton, Field/Input/Select/Autocomplete, Alert, Badge, Card,
StatCard, EmptyState, SegmentedTabs, `Th`/`Td`/`TableFrame`,
LoadingState/SkeletonCard/Spinner, AppShell), the theme flips cleanly through
semantic CSS variables, and there is real accessibility scaffolding (skip link,
focus trap, reduced-motion, accessible charts with data-table fallbacks) plus
e2e coverage in `e2e/a11y.spec.ts` and `e2e/ui-polish.spec.ts`.

So this is **refinement, not a rebuild.** The goal is to close the gap between
the strong primitives and the ~20 dashboard panels that bypass them, make the
visual language fully token-driven and brand-aligned, and tighten layout,
responsiveness, and in-panel feedback. The brand direction
(`docs/brand-guidelines.md`) is explicit: *professional, calm, task-focused;
use brand color to establish hierarchy rather than decoration.* Every change
below should pull the UI toward that.

### What is already good (do not redo)

- Theme tokens and dark mode: `app/globals.css`, `app/components/theme-provider.tsx`.
- Charts with accessible `<figure>`/caption + data-table fallback: `app/components/charts.tsx`.
- Reports page: consistent use of Card/StatCard/EmptyState/Alert/TableFrame, deep-linked filters, load-more, retry — `app/reports/page.tsx`.
- Optimistic entries mutations and reconciliation: `app/dashboard/page.tsx`, `app/dashboard/entries-table.tsx`.
- Login/forgot/reset auth screens: polished, brand-aligned, axe-clean (`app/page.tsx`, `e2e/a11y.spec.ts`).
- Every panel wraps itself in `Card` — the outer shell is already consistent.

## Guiding principles

1. **One primitive per job.** If `ui.tsx` has a primitive, panels use it. If a
   job is repeated and hand-rolled (checkbox, toggle, file input, data table,
   icon action, dropdown menu), promote it to a primitive first, then migrate.
2. **Tokens over literals.** No raw `emerald/amber/rose/slate` + `dark:` pairs in
   feature code; status color lives in semantic tokens like neutral/primary
   already do.
3. **Calm, scannable density.** Group long forms and admin panels; prefer
   whitespace and hierarchy over decoration (brand guidance).
4. **Every async surface has the four states** — idle, loading, empty, error —
   and never drops an error silently.
5. **Parity & presentation-only.** No auth, schema, repository, Server Action
   signature, or backend-selection changes; both `supabase` and `native` builds
   must stay green (`AGENTS.md`).

## Findings → workstreams (evidence-backed)

### W1 — Design-system consistency (most pervasive)

- **Tables are hand-rolled in two divergent dialects; `TableFrame`/`Th`/`Td` go unused.**
  Style 1 uses the `Th`/`Td` helpers (`activity-types-panel.tsx:85`,
  `leave-panel.tsx:196`, `global-reminders-panel.tsx:124`, `user-whitelist.tsx:204`);
  Style 2 uses raw `<th className="px-3.5 py-2.5">` with a different background
  and padding (`hierarchy-editor.tsx:140`, `team-view.tsx:211`,
  `super-admin-panel.tsx:377`). Header padding/casing/background differ
  table-to-table.
- **Icon actions hand-rolled as `<Button variant="ghost">` + `<span class="sr-only">` (or raw `<button>`) instead of `IconButton`** — `project-manager.tsx:138-156` (5 in a row), `activity-types-panel.tsx:117,121`, `leave-panel.tsx:244`, `reminders-panel.tsx:150`, `global-reminders-panel.tsx:143`, `telegram-panel.tsx:77`, and raw buttons at `user-whitelist.tsx:222-245`.
- **Raw `<select>` instead of `Select`** — `user-whitelist.tsx:249,269,281,303` (four, with a different radius/padding/font-size than the primitive, while `hierarchy-editor.tsx` uses `Select` for the same job).
- **Ad-hoc amber "warning" boxes instead of `Alert tone="warning"`** — `reminders-panel.tsx:81`, `global-reminders-panel.tsx:53`, `user-whitelist.tsx:197`, `add-user-form.tsx:120`, `team-view.tsx:108`, `telegram-panel.tsx:83`.
- **Inline colored `<p>` for success/error instead of `Alert`** — `leave-panel.tsx:172`, `reminders-panel.tsx:126` (duplicates the toast already fired).
- **Hand-rolled tab switcher instead of `SegmentedTabs`** — `team-view.tsx:159-186`.
- **Non-token colors** — `telegram-panel.tsx:74` hardcodes `bg-slate-900 text-emerald-300` (fixed dark regardless of theme); `team-view.tsx:82,167,180` use `shadow-xs`; `team-view.tsx:100` avatar is `bg-rose-600` (AppShell avatars use a primary gradient).
- **Button-styled `<span>`** — `backup-panel.tsx:103` (its `disabled:opacity-50` is inert on a span, so "Restore" never visually disables); two different file-input treatments (`import-panel.tsx:96` styles `file:`; backup styles a span).
- **Scale of the literal-color problem:** ~61 hardcoded status-color utility usages across 16 files (`bg|text|border|ring|from|to|via-(emerald|amber|rose|violet|indigo|blue|green)-`). `ui.tsx` holds 21 of them (centralized, fine); the other ~40 are scattered in feature code (the real inconsistency).
- **Missing primitives make hand-rolling unavoidable today:** `ui.tsx` has **no Checkbox, no Toggle/Switch, no file-input, no Menu/Dropdown** primitive. Each panel invents its own, differently.

### W2 — Information architecture & layout

- **User dashboard is a single tall column.** Tiles render full-width stacked
  (`page.tsx:677-681`, each in `<div class="mt-6">`), while the admin view uses
  `lg:grid-cols-2` with a width registry (`page.tsx:715`, `ADMIN_TILE_WIDTHS`).
- **Dead/contradictory layout hints.** `EntriesTable` still carries
  `className="md:col-span-2"` (`entries-table.tsx:599`) — a no-op without a grid
  parent — and its empty state says "using the form on the **left**"
  (`entries-table.tsx:623`), but on wide screens the form sits *above*, not left.
- **Admin tab holds up to 13 panels in one 2-col grid** (`page.tsx:453-499`) with
  no grouping — hard to scan.
- **Minimal nav / discoverability.** Top nav is only Dashboard + Reports
  (`lib/navigation.ts`); change-password is an unlabeled icon; keyboard
  shortcuts exist (`lib/shortcuts.ts`) but are only discoverable via the `?`
  dialog.

### W3 — Async feedback & state consistency

- **`useAsyncData`'s `loading`/`error` are discarded** in ~5 panels
  (`leave-panel.tsx:34`, `reminders-panel.tsx:18`, `activity-types-panel.tsx:18`,
  `global-reminders-panel.tsx:19,75`, `super-admin-panel.tsx:73,82,91,107`). A
  failed load shows an empty state or stale data with **no error surfaced** and
  no busy indication for screen readers.
- **Bulk results shown only in ephemeral toasts.** `import-panel.tsx:61-73`
  imports immediately on file-select (no preview/confirm) and reports per-row
  issues in a 4.2s toast truncated to 3 items; `bulk-edit-modal.tsx:50` reports
  "X skipped" the same way.
- **Dual feedback channels** — `leave-panel.tsx:111-118,172` sets inline
  message/error *and* fires a toast for one action.
- **Misleading controls** — `bulk-edit-modal.tsx` renders Cancel twice (`:73`,
  `:87`); its activity `Select` is `required` yet defaults to "Keep existing".

### W4 — Responsive / mobile

- **Dense admin tables overflow with no fallback** — 7 cols / 4 selects per row
  (`user-whitelist.tsx:204`), 5 cols / 3 selects (`hierarchy-editor.tsx:140`),
  plus `team-view.tsx:211`, `super-admin-panel.tsx:377`; all rely on
  `overflow-x-auto` with no stacked/card layout on phones.
- **Sub-44px touch targets** — hand-rolled selects `px-1.5 py-1 text-xs`
  (`user-whitelist.tsx:254+`), ghost icon buttons (`px-2`/`px-1.5`), customizer
  arrows (`panel-customizer.tsx:124-138`).
- **Magic fixed heights** to fake alignment — `h-[38px]`
  (`add-user-form.tsx:136`, `super-admin-panel.tsx:358`).
- **Entries-table mobile row menu is hand-rolled `fixed`-positioned** with
  manual coordinate math (`entries-table.tsx:800-820`) — fragile on
  scroll/resize; a `Menu` primitive would own this.

### W5 — Visual polish & motion

- **Empty states inconsistent** — some use the `EmptyState` primitive
  (`project-manager.tsx:113`, `leave-panel.tsx:189`), others hand-roll centered
  muted text (`user-whitelist.tsx:328`, `hierarchy-editor.tsx:229`,
  `team-view.tsx:203`, `super-admin-panel.tsx:386`).
- **Micro-inconsistencies** — "Saving…" (ellipsis) vs "Saving..." (three dots)
  (`super-admin-panel.tsx:599`); mixed iconography (`#` text glyph for Telegram
  number vs icons; `IconTrash` overloaded for "clear sort order",
  `project-manager.tsx:151`).
- **Motion is near-absent** — the `fadeIn` keyframe (`globals.css:124`) is used
  in exactly one place (`toast.tsx:59`). Cards/rows/tab panels appear with no
  entrance; reduced-motion is already respected globally, so tasteful motion is
  safe to add.
- **Brand accents are decorative-only** — `accent` (cyan) and `brand-red` tokens
  appear only in auth-page gradient blurs (`page.tsx`, `forgot-password`,
  `reset-password`); the authenticated app never uses them. The dashboard header
  is plain compared to the login screen's polish.
- **StatCards are static** — no trend/delta/sparkline, a natural upgrade for a
  time-tracking dashboard.

### W6 — Accessibility hardening (beyond the current baseline)

- **Partial ARIA tab pattern** — `team-view.tsx:160-185` sets `role="tab"` +
  `aria-selected` with no `role="tablist"` parent and no `role="tabpanel"`.
- **Empty labels for spacing** — `hierarchy-editor.tsx:125`, `team-view.tsx:189`
  (`label=""`), `report-export.tsx:63` (`label="&nbsp;"`).
- **Unlabeled file input** — `import-panel.tsx:87-97`.
- **Inconsistent icon-button naming** — `title`+`sr-only` vs `aria-label` within
  one file (`user-whitelist.tsx:222` vs `:237`).
- **PanelCustomizer reorder is sighted-only** — up/down arrow buttons work on
  touch + keyboard (`panel-customizer.tsx:119-140`), but there is no `aria-live`
  announcement on move, and the `<li tabIndex={0}>` has no role describing that
  arrows reorder it.
- **axe coverage gap** — the dashboard/admin/dialog axe test is gated behind
  `E2E_EMAIL`/`E2E_PASSWORD` (`e2e/a11y.spec.ts:75`); the admin panels and the
  PanelCustomizer are not scanned in the default fixture run.

## Key decisions

### D1 — Build the shared vocabulary first, then migrate

Promote the repeated hand-rolled widgets to `ui.tsx` **before** touching panels,
so the consistency sweep is a mechanical swap rather than a redesign. New
primitives: `Checkbox`, `Toggle` (switch), `FileField` (labelled file input),
`DataTable` (thin wrapper over `TableFrame`+`Th`+`Td` with the one canonical
header style), and `Menu` (accessible dropdown; backs the entries-table row
menu). All are presentation-only and additive.

### D2 — Tokenize semantic status colors (success / warning / danger / info)

Add raw status vars to `:root` and `.dark` in `globals.css` as semantic triplets
(`--success-surface` / `--success-text` / `--success-ring`, likewise warning /
danger / info), expose them through `@theme inline`, and refactor `Alert`,
`Badge`, `StatCard`, and `RoleBadge` to consume them. This removes the need for
`dark:` variants on status styling (the raw var flips in one place, exactly like
the neutral tokens) and gives the panel sweep a single target.

Brand mapping (`docs/brand-guidelines.md` §2): success `#10B981`, warning
`#F59E0B`, info = primary blue. **Danger stays rose, not corporate red** — the
brand doc is explicit that red is a corporate accent and destructive UI uses
rose so "brand emphasis and danger remain distinguishable." Keep that invariant.

### D3 — Keep Admin as a tab, but group it; keep the route map

A dedicated `/admin` route is tempting but higher-risk (it would move the
role-gated panel registry and the `?tab=admin` deep links). Lower-risk, higher
value: keep the tab and group the ~13 panels under labeled sections — **People**
(whitelist, add-user, hierarchy, leave-admin), **Projects & activities**
(project-manager, activity-types), **Time rules** (settings/backfill,
global-reminders), **Workspace** (branding/super-admin defaults), **Data**
(import, backup), **Danger zone** (super-admin). Record the `/admin` split as a
future option, not part of this plan.

### D4 — Fix the user-view layout within the existing pattern

Give the user view the same width-registry treatment the admin view already has:
a `TILE_WIDTHS` map (mirroring `ADMIN_TILE_WIDTHS`, `page.tsx:387`) and a
`lg:grid-cols-2` grid, with the entry form + entries table laid out as a
two-column pairing on wide screens. Remove the dead `md:col-span-2`
(`entries-table.tsx:599`) and correct the empty-state copy
(`entries-table.tsx:623`). This respects the user-customizable tile order rather
than fighting it.

### D5 — Presentation-only, parity-safe, incremental

No change to Server Action names/signatures, auth, repository, schema, or
`NEXT_PUBLIC_BACKEND` behavior. Each phase is independently shippable and
testable, ordered so later phases depend on earlier primitives.

## Phased execution

Effort/impact are rough (S/M/L). Each phase is its own PR with its own Conventional Commit.

### P0 — Primitives & tokens (foundation) · M

- `app/globals.css`: add status token triplets to `:root` + `.dark`; expose via `@theme inline` (D2).
- `app/components/ui.tsx`: add `Checkbox`, `Toggle`, `FileField`, `DataTable`, `Menu` (D1); refactor `Alert`/`Badge`/`StatCard`/`RoleBadge` to consume status tokens (no visual change intended — verify in both themes).
- Tests: extend `tests/*` primitive coverage (there is existing `confirm-dialog`/`confirm` precedent); snapshot or role-based assertions for the new primitives. Verify `e2e/a11y.spec.ts` + `e2e/ui-polish.spec.ts` stay green.

### P1 — Consistency sweep across panels · L

Mechanical migration onto P0 primitives (W1). Group by file to bound review:
- **Tables → `DataTable`:** `activity-types-panel`, `leave-panel`, `global-reminders-panel`, `user-whitelist`, `hierarchy-editor`, `team-view`, `super-admin-panel`.
- **Icon actions → `IconButton`:** `project-manager`, `activity-types-panel`, `leave-panel`, `reminders-panel`, `global-reminders-panel`, `telegram-panel`, `user-whitelist`.
- **Raw `<select>` → `Select`:** `user-whitelist`.
- **Checkboxes/toggles/file inputs → `Checkbox`/`Toggle`/`FileField`:** `add-user-form`, `super-admin-panel`, `import-panel`, `backup-panel`, `time-entry-form` (the "Copy Telegram command" checkbox), `entries-table` (select-all/row checkboxes).
- **Ad-hoc amber boxes & colored `<p>` → `Alert`:** `reminders-panel`, `global-reminders-panel`, `user-whitelist`, `add-user-form`, `team-view`, `telegram-panel`, `leave-panel`.
- **Custom tabs → `SegmentedTabs`; non-token colors → tokens:** `team-view` (tabs, avatar, shadows), `telegram-panel` (code block uses a `bg-muted`/mono token pair, theme-aware).
- Replace the hand-rolled fixed-position row menu with `Menu`: `entries-table.tsx:786-822`.

### P2 — Layout & IA · M

- User-view width registry + `lg:grid-cols-2`; remove dead `md:col-span-2`; fix empty-state copy (D4) — `app/dashboard/page.tsx`, `app/dashboard/entries-table.tsx`.
- Group admin panels into labeled sections (D3) — `app/dashboard/page.tsx` (+ a small section-label component or `Card` grouping).
- Minor nav polish: give change-password a visible label in the drawer; surface a "Keyboard shortcuts (?)" affordance in the shell footer/header — `app/components/ui.tsx` (AppShell).

### P3 — Async feedback & form correctness · M

- Surface `useAsyncData`'s `loading`/`error` in all async panels: `SkeletonCard`/`LoadingState` while loading, `Alert` (with retry) on error (W3) — `leave-panel`, `reminders-panel`, `activity-types-panel`, `global-reminders-panel`, `super-admin-panel`.
- Import: add a confirm/preview step and a persistent results summary (not just a truncated toast) — `import-panel.tsx`.
- Collapse dual feedback to one channel (prefer toast + inline `Alert` only where it persists) — `leave-panel`, `reminders-panel`.
- Fix `bulk-edit-modal`: single Cancel, drop misleading `required` on the "Keep existing" select.

### P4 — Responsive / mobile · M

- Dense admin tables: stacked "card" layout under `md` (or at minimum a scroll-shadow affordance + larger controls) — `user-whitelist`, `hierarchy-editor`, `team-view`, `super-admin-panel`. The `DataTable` primitive can own a `stackOnMobile` mode.
- Enforce ≥44px tap targets on migrated controls (handled centrally once P0 primitives set the min size).
- Replace `h-[38px]` alignment hacks with the `Field`/control baseline — `add-user-form`, `super-admin-panel`.

### P5 — Visual polish & motion · S/M

- Standardize empty states on `EmptyState` (W5) — `user-whitelist`, `hierarchy-editor`, `team-view`, `super-admin-panel`, `global-reminders-panel`.
- Normalize spinner/label strings ("…"), iconography (dedicated icons for Telegram-number and clear-sort; stop overloading `IconTrash`) — `app/components/icons.tsx`, `project-manager`, `activity-types-panel`.
- Add tasteful, reduced-motion-safe entrance motion for cards/tab-panel changes (reuse/extend the `fadeIn` keyframe) — `globals.css`, `Card`.
- Elevate the dashboard header to match auth-screen polish and give the cyan `accent`/`brand-red` tokens an intentional role (or consciously keep them auth-only) — `app/dashboard/page.tsx` (`PageHeader`), decision recorded.
- Optional: StatCard trend/delta variant (e.g. "+3.5h vs last month") — `ui.tsx`, dashboard `monthStats`.

### P6 — Accessibility hardening · S/M

- Fix the `team-view` tab pattern (use `SegmentedTabs`, done in P1) and remove empty/`&nbsp;` labels (use `labelAsText`/`aria-label` or a spacer) — `hierarchy-editor`, `team-view`, `report-export`.
- Label the import file input (handled by `FileField` in P1).
- PanelCustomizer: add an `aria-live="polite"` status announcing moves, and describe the reorder affordance on the list — `panel-customizer.tsx`.
- Extend axe coverage: add a fixture-based dashboard/admin/customizer scan to `e2e/ui-polish.spec.ts` (the fixture sign-in already exists there) so admin panels are scanned without live creds.

## P1 implementation decision packet

**Decision required:** Migrate existing panels to shared controls without changing
mutation, permission, or layout contracts; make the Menu safe inside table scroll containers.

**FACT:** `ui.tsx:Menu` initially positions the popup absolutely, while
`entries-table.tsx` renders row controls in an overflow-scrolling wrapper. It
also allows native-disabled items into its focus index. `FileField` initially
retains the native value, while import/backup reset their inputs after use.
`hierarchy-editor.tsx` and `user-whitelist.tsx` contain stateful inline editors.

**Chosen approach:** Use DataTable for simple display tables and TableFrame/Th/Td
for stateful editors. Keep all handlers, guards, action signatures, tile ordering,
and URL state intact. Portal the Menu to the document body with viewport-clamped
positioning; focus the first/last item on opening, support arrow/Home/End/Escape/
Tab navigation, prevent disabled activation, close on outside pointer/focus,
scroll and resize, and return focus before opening another dialog. Use
`aria-disabled` menu items so keyboard navigation never stalls on disabled rows.
FileField snapshots the selection and resets the native input after dispatch so
the same file can be selected again without changing import/restore workflows.

**Alternatives rejected:** Replacing every complex table with callbacks adds
indirection without UX benefit; an absolute popup is clipped by table overflow;
adding a dependency is unnecessary for this bounded menu.

**Lifecycle/rollback:** Open → measure/focus → navigate/select/dismiss → clean up
listeners and return focus where appropriate. No auto-retry or new optimistic
writes; existing mutation lifecycle remains authoritative. Revert individual
presentation migrations if needed; no database rollback is required.

**UNKNOWN:** Live backend availability and production proxy configuration. Browser
fixtures verify presentation, not hosted persistence or authorization.

**Acceptance:** Focused render/navigation tests, browser success/failure and
keyboard/touch checks, lint/typecheck, full unit/coverage suite and both backend
compiles; disclose any unavailable production/DB checks.

## Recommended default scope

If the user wants a single first increment: **P0 + P1** (plus the P2 user-view
layout fix). That removes the two table dialects, routes icon actions/selects/
status styling through primitives and tokens, and fixes the most visible layout
inconsistency — the bulk of the "feels inconsistent" problem — while keeping each
PR reviewable. P3–P6 then layer on feedback, responsiveness, polish, and a11y.

## Out of scope / boundaries

- **No** auth, authorization, repository, schema/migration, or Server Action
  signature changes; **no** `NEXT_PUBLIC_BACKEND` behavior change. Both backend
  builds must stay green (`AGENTS.md`).
- **No** mobile (`mobile/`) changes.
- **No** new data fetching or endpoints; this is presentation + existing data.
- The `/admin` route split and a left-sidebar nav shell are explicitly deferred
  (noted as future options under D3).
- Preserve existing identifiers, deep-link params (`?tab=`, report filters,
  entries `?user/page/size`), keyboard shortcuts, and the tile-customization
  model.

## Verification

Per `AGENTS.md` and `package.json`:

- `npm run lint`, `npm run typecheck` (production build includes TS checking).
- `npm run test` / coverage — add/extend unit tests for new primitives
  (`tests/`), keep aggregate gates (lines/functions/statements 60%, branches
  50%) and the security-file thresholds green.
- Both backends: `NEXT_PUBLIC_BACKEND=supabase npm run build` and
  `NEXT_PUBLIC_BACKEND=native npm run build`.
- `npm run a11y` / `e2e/a11y.spec.ts` and `e2e/ui-polish.spec.ts` — must stay
  green per phase; P6 extends `ui-polish` to scan the dashboard/admin/customizer
  via the existing browser fixtures (no live creds).
- Per-phase manual/preview check in **both themes** at 320/390/768/1024/1440 px,
  asserting no horizontal overflow (the `expectNoHorizontalOverflow` helper in
  `ui-polish.spec.ts` is the pattern), focus-visible rings, and that migrated
  controls meet the ≥44px target on mobile.
- Use RTK for noisy build/test output (`RTK.md`); report skipped DB/e2e checks
  explicitly (e.g. when `TEST_DATABASE_URL` / `E2E_*` are unset).

## Risks & sequencing notes

- **Token refactor regressions:** D2 touches `Alert`/`Badge`/`StatCard`/
  `RoleBadge`, used everywhere. Treat P0 as "no visible change" and verify in
  both themes with the existing axe + overflow checks before P1 depends on it.
- **Sweep breadth:** P1 is large; split into per-file commits and lean on the
  type checker + both-backend builds. The primitives (P0) make each swap
  mechanical and low-risk.
- **Customizer order vs grid (D4):** the 2-col user grid must honor the saved
  tile order; mirror the admin view's registry rather than inventing a new
  layout engine.
- **Motion (P5):** keep durations short and gate on `prefers-reduced-motion`
  (already handled globally in `globals.css`); avoid motion that competes with
  content (brand guidance against "excessive gradients"/decoration).
