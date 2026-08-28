# VSIS Web and Mobile Experience Unification Plan

## Document status

- Prepared: 2026-08-27
- Baseline branch: `mobile-dev`
- Status: **COMPLETE** (WP-00 through WP-08 implemented & verified)
- Execution target: Antigravity
- Verification: Dual-backend `next build` (Native + Supabase), 64 Vitest test suites (523 tests), 27 Mobile Jest suites (93 tests), 0 typecheck errors, 0 lint warnings.

## 1. Goal

Unify the web and React Native experiences around the same product language,
capability rules, data contracts, task outcomes, visual identity, feedback
states, and accessibility standards while keeping platform-native navigation
and interaction.

“Unified” does not mean pixel-identical:

- Web keeps a responsive top shell, pointer/keyboard affordances, shareable
  URLs, and dense data views where useful.
- Phones keep touch-first forms, cards, bottom navigation, native back
  behavior, safe areas, and read-only offline fallback.
- Windows React Native uses an adaptive navigation rail, visible keyboard
  focus, hover states, and wider content layouts.
- The same role must see the same authorized data and be able to complete the
  same agreed task, even when the presentation differs.

## 2. Executive comparison

| Area | Web app | Mobile app | Unification decision | Priority |
| --- | --- | --- | --- | --- |
| Authentication | Sign in, self-registration, pending state, password change, logout | Workspace connect, sign in, pending state, password change, logout/logout-all | Preserve workspace bootstrap as mobile-only; add capability-driven registration; repair pending lifecycle | P0/P1 |
| Dashboard | Month hours, month entries, today state, customizable user/admin panels | Today hours, trailing-week hours, recent entries, feature hub, offline banner | Define personal metrics once; use Dashboard as the shared destination name; keep platform-specific layouts | P0/P1 |
| Log time | Searchable project, activity choice, date/hours rules, recent work, smart hours, copy last, Telegram copy | Searchable project/activity, date/hour shortcuts, create only | Keep the mobile form strengths; add the verified web conveniences without weakening validation | P1 |
| Timesheets | Pagination, role-aware user filter, edit, delete, duplicate, selection, bulk edit/delete, Telegram copy | First 50 rows, all/7/30-day filters, delete own | Add correct DTOs, edit, pagination, duplicate, filters, then bulk productivity | P0/P1 |
| Leave | Multi-day marker range, optional reason, monthly view, admin target | Single-day own marker labeled “Request Leave” | Use “Mark Leave”; add date ranges using the existing batch contract; do not invent approval states | P1 |
| Personal reminders | Create, dismiss, delete | Create, toggle done, delete, quick presets | Keep both; repair timezone conversion and align feedback/copy | P0/P1 |
| Global reminders | Due view/dismiss for users; admin create/delete | Missing | Add user read/dismiss before admin mutation | P1 |
| Profile | View and edit department/title | View identity/roles/workspace; password/security controls | Add full self-profile GET/PATCH; preserve mobile security controls | P1 |
| Reports | My hours, summaries, project/user reports, custom periods, compare, missing days, CSV | Three presets and project/activity totals | Fix report DTO first; then add filters, compare, missing days, team scope, and export/share | P0/P2 |
| Team | Role-scoped user filter in entries/reports | Searchable directory; rows are dead controls | Correct role policy and add member drill-down to entries/reports | P0/P2 |
| Project/admin tools | Full role-gated web suite | Missing | Add safe management features incrementally; keep destructive/file-transfer operations web-only initially | P3 |
| Visual identity | Verified VSIS crimson/slate, Geist, light-only, inline SVG | Blue palette, system type, light/dark, Unicode/emoji glyph icons | VSIS crimson is the shared brand source; platform fonts remain native; replace structural glyphs with vectors | P1 |
| States | Strong primitives, but some panels hide fetch errors | Explicit loading/empty/error on most screens; dashboard-only offline state | Adopt one state contract and never render an API failure as empty data | P0/P1 |
| Accessibility | Skip link, focus ring, labelled controls, dialog focus trap; incomplete field association and small controls | Many labels/roles/live regions; contrast, touch size, headings, focus restoration, and Dynamic Type gaps | Meet WCAG 2.1 AA plus native touch/focus requirements on both | P1 |
| Tests | Strong server/data tests; thin authenticated UI/a11y E2E | 17 Jest suites/43 tests; mostly happy-path render checks | Add contract fixtures, failure paths, role matrix, authenticated a11y, and cross-platform navigation tests | P0-P2 |

## 3. Findings that change implementation order

### P0 — must be repaired before treating either UI as authoritative

1. Live v1 timesheet payloads use nested `projects`, `profiles`, and
   `activity_types`, while mobile expects flat `project_name` and
   `activity_name` plus unsupported `notes` and `status` fields.
2. Live report buckets are `{ label, hours, entries }`, while mobile expects
   `{ key, name, hours, entries }`. Existing tests mock the wrong shape.
3. Inactive users can log in as pending, but `/api/v1/auth/me` and all other
   bearer routes use an active-only gate. Pending sessions therefore cannot
   restore or reliably detect activation.
4. v1 timesheet, leave, and reminder mutations bypass the write-budget policy
   used by web Server Actions.
5. Mobile exposes Team to PM users, although the product policy grants PM
   project management, not team visibility.
6. Mobile dashboard totals use all actor-visible rows for managers/admins while
   presenting the numbers as personal totals.
7. `/api/v1/config` advertises `bearerAuth: false` while the client ignores the
   flag and bearer endpoints exist. The capability document and rollout gate
   are not truthful to each other.
8. Web ordinary confirmation dialogs never unlock when `confirmValue` is
   omitted, blocking common delete/bulk-delete flows.
9. Web report exports can contain only the rows currently loaded while claiming
   to export the selected report.

### P1 — major experience gaps

- Web panels can convert request failures into false empty states.
- Mobile pending approval “Check Status” does not transition to signed in.
- Reminder date/time conversion shifts values outside UTC and accepts invalid
  strings until generic failure.
- Mobile root tabs push onto an ever-growing history stack; header labels and
  actual back destinations can disagree.
- Log Time can lose unsaved work through a tab or hardware-back action.
- Team rows announce themselves as buttons but have no supplied action.
- Mobile primary-on-dark, error-on-dark, and input-border contrast fail target
  ratios.
- Multiple mobile controls are 36–40 dp instead of the Android 48 dp target;
  the central bottom action is 38 × 38.
- Web and mobile use conflicting brand primaries.
- Mobile structural icons include font-dependent emoji/Unicode glyphs.
- Timesheet history stops at 50 rows without load-more despite a total count.
- Mobile form errors are mostly page-level rather than field-linked.

### P2/P3 — parity and polish

- Advanced reports, member drill-down, global reminders, profile editing,
  self-registration, dashboard preferences, safe admin tooling, Windows
  productivity, durable read-only cache, richer skeleton states, and optional
  web dark mode.

## 4. Product decisions for this plan

These decisions remove ambiguity for the implementation agent.

1. **No invented domain features.** Do not add approvals, rejection comments,
   leave balances/types, reminder recurrence, SSO, MFA, or biometric sign-in.
   They are not part of the current web product or data model.
2. **No schema changes are expected.** Existing repository methods cover the
   agreed web capabilities. If a packet appears to require a migration, stop
   and amend this plan before creating either native or Supabase SQL.
3. **Role decisions use two axes.** `permission_role` controls admin, PM, and
   CO capabilities. `hierarchy_role` controls manager/team-lead visibility.
   Legacy `role` is display/compatibility data only.
4. **Capability checks are server-authored.** Mobile navigation must not
   recreate role logic ad hoc. The actor DTO exposes normalized capabilities
   derived by shared server helpers.
5. **VSIS crimson is the brand source.** Use the existing web palette derived
   from the VSIS logo. Blue may remain an informational accent, not the primary
   brand/action color.
6. **Dark mode is not a parity gate.** Preserve and correct mobile dark mode.
   Web remains light-only until every web component uses semantic tokens. Do
   not ship a partial web dark theme and do not remove mobile dark mode.
7. **Dashboard metrics are personal.** Canonical metrics are Today Hours, This
   Week Hours, This Month Hours, Month Entries, and Today Logged/Not Logged.
   Team metrics must be a separately labelled report, never mixed into personal
   dashboard totals.
8. **Leave is a marker, not a request.** Use “Mark Leave” and “Remove Leave”
   until the product gains an actual approval workflow.
9. **Safe admin parity is staged.** Project/activity/user/hierarchy/settings
   management may reach mobile after employee/manager parity. Import,
   backup/restore, domain/title administration, global layout defaults, resets,
   and permanent deletion remain web-only in this plan.
10. **Offline remains read-only.** Cache safe reads and clearly label stale
    data. Do not queue offline mutations.
11. **No new native dependency without a three-platform proof.** Vector icons,
    file sharing, date pickers, or storage packages must prove Android, iOS, and
    Windows compatibility with React Native/RNW 0.84 before adoption.

## 5. Target experience contract

### 5.1 Shared vocabulary

| Concept | Canonical label |
| --- | --- |
| Product | VSIS Timesheet |
| Root destination | Dashboard |
| Create entry | Log Time |
| Entry collection | Timesheets |
| Personal absence | Mark Leave |
| Team directory | Team |
| User settings/security | Profile |
| Destructive entry action | Delete Entry |
| Successful create message | Time entry saved |

### 5.2 Shared state model

Every data surface must distinguish:

1. Initial loading — skeleton or stable placeholder.
2. Refreshing — preserve visible data and show non-blocking progress.
3. Empty — successful request with zero rows.
4. Error — request failed; show message and Retry.
5. Offline/stale — cached data with timestamp, mutations disabled with reason.
6. Submitting — lock the mutation immediately and expose busy semantics.
7. Success — non-blocking toast/live announcement plus correct destination.
8. Destructive confirmation — explicit target and reversible rollback/undo
   where safe.
9. Dirty form — protect navigation or preserve a draft.

An error must never be represented as an empty collection.

### 5.3 Shared design direction

- Style: restrained enterprise minimalism, clear grid, high contrast, low
  visual noise, no decorative AI gradients.
- Brand: VSIS crimson for brand and primary actions; slate surfaces/text;
  emerald success; amber warning; rose destructive; blue information only.
- Spacing: a documented 4/8-based rhythm; retain mobile’s
  4/8/12/20/28/36 scale and map web spacing to the same semantic tiers.
- Type: semantic roles instead of identical fonts. Web keeps Geist; native
  uses the platform system face. Use equivalent hierarchy for title, section,
  body, label, caption, and badge.
- Radius: semantic small/medium/large/round tokens; avoid per-screen values.
- Icons: one vector outline family and one stroke convention per platform.
  No emoji or Unicode characters as structural icons.
- Motion: subtle 150–250 ms feedback; no layout-shifting interaction;
  reduced-motion users receive final states without decorative animation.
- Contrast: normal text at least 4.5:1; large text and meaningful non-text
  controls at least 3:1.
- Touch: at least 44 pt on iOS and 48 dp on Android; expand compact visuals
  with hit slop.
- Focus: visible focus on web/Windows, logical traversal, focus restoration
  after modal/navigation transitions.

### 5.4 Shared information architecture

Phone root navigation:

1. Dashboard
2. Timesheets
3. Log Time (primary action)
4. Reports
5. More

`More` contains role-filtered destinations:

- Mark Leave
- Reminders
- Team (admin, CO, manager, team lead only)
- Projects (admin and PM, after admin packet)
- Administration (admin only, after admin packet)
- Profile

Windows/wide native uses a rail with the same destination names and a persistent
Log Time action. Web retains its top shell but uses the same root names and
capability ordering.

## 6. Architecture rules

1. `lib/api/v1/contracts.ts` owns explicit external DTO definitions and mappers.
   Routes must not leak `app/types.ts` database/domain shapes.
2. Mobile’s `mobile/src/api/contracts.ts` mirrors the v1 wire contract exactly.
   Unsupported phantom fields are removed.
3. Server Actions and v1 routes call the same actor-parameterized domain
   operations for validation, authorization, backfill, 24-hour caps, write
   budgets, and audit behavior.
4. Both database adapters retain parity through `Repository`; v1 services do
   not add backend-specific logic.
5. Mobile navigation uses one typed route registry and one history reducer.
   Screens do not mutate route stacks directly.
6. Web and mobile share token names and component behavior specifications, not
   JSX/React Native source files.
7. Mobile cache keys include canonical server origin, actor ID, and schema
   version. Tokens never enter the non-secret cache.
8. Existing Server Action names/signatures and existing web URLs remain
   backward compatible.

## 7. Primary impact map

| Subsystem | Existing files | Planned new files |
| --- | --- | --- |
| v1 contracts | `lib/api/v1/contracts.ts`, `lib/api/v1/services/*.ts`, `app/api/v1/**/route.ts` | `[NEW] tests/mobile-contract-parity.test.ts` |
| Auth/policy | `app/api/v1/_http.ts`, `lib/roles.ts`, `app/actions/_shared.ts`, `mobile/src/auth/session-controller.ts`, `mobile/src/auth/SessionProvider.tsx` | service helpers only if the existing files cannot host them cleanly |
| Web reliability | `app/components/confirm.tsx`, `app/hooks.ts`, `app/reports/page.tsx`, affected dashboard panels | `[NEW] e2e/critical-actions.spec.ts`, `[NEW] e2e/reports-export.spec.ts` |
| Design system | `app/globals.css`, `app/components/ui.tsx`, `app/components/icons.tsx`, `mobile/src/theme.ts`, `mobile/src/components/*.tsx` | `[NEW] docs/architecture/unified-experience-contract.md`; vector adapter files after compatibility proof |
| Mobile navigation | `mobile/App.tsx`, `mobile/src/components/BottomNavBar.tsx`, `mobile/src/platform/useAndroidBackHandler.ts` | `[NEW] mobile/src/navigation/routes.ts`, `[NEW] mobile/src/navigation/navigation-reducer.ts`, `[NEW] mobile/src/components/AdaptiveNavigation.tsx`, `[NEW] mobile/src/screens/MoreScreen.tsx` |
| Time workflow | `lib/api/v1/services/timesheets.ts`, `app/api/v1/timesheets/**`, `mobile/src/api/*.ts`, `mobile/src/auth/SessionProvider.tsx`, `mobile/src/screens/LogTimeScreen.tsx`, `mobile/src/screens/TimesheetListScreen.tsx` | `[NEW] app/api/v1/timesheets/[id]/duplicate/route.ts`, `[NEW] mobile/src/components/TimeEntryForm.tsx`, `[NEW] mobile/src/screens/EditTimeScreen.tsx` |
| Personal tools | `mobile/src/screens/LeavesScreen.tsx`, `mobile/src/screens/RemindersScreen.tsx`, `mobile/src/screens/ProfileScreen.tsx` | `[NEW] lib/api/v1/services/profile.ts`, `[NEW] app/api/v1/profile/route.ts`, `[NEW] lib/api/v1/services/global-reminders.ts`, `[NEW] app/api/v1/global-reminders/**` |
| Reports/team | `lib/api/v1/services/reports.ts`, `app/api/v1/reports/route.ts`, `mobile/src/screens/ReportsScreen.tsx`, `mobile/src/screens/TeamScreen.tsx` | report export/platform adapter files only after compatibility proof |
| Safe administration | existing repository methods and web actions/panels | role-gated v1 admin services/routes and focused mobile screens, one feature group per packet |
| Verification | `tests/mobile-*.test.ts`, `mobile/__tests__/*.test.tsx`, `e2e/*.spec.ts` | contract, navigation, role, failure-state, and authenticated a11y suites |

No file is planned for deletion.

## 8. Dependency order

```text
WP-00 contract truth
  -> WP-01 auth, scope, capabilities, write policy
    -> WP-02 reference-app correctness
      -> WP-03 shared design and accessibility foundation
        -> WP-04 navigation and adaptive shell
          -> WP-05 employee time workflow
          -> WP-06 personal tools
            -> WP-07 reports and team workflows
              -> WP-08 safe administration
                -> WP-09 hardening and release gates
```

Do not start a downstream packet while an upstream acceptance criterion is
failing.

## 9. Work packets

### WP-00 — Establish explicit v1 contract truth

**Goal:** Make real route output, mobile types, test fixtures, and rendering
agree before adding features.

**Read first**

- `lib/api/v1/contracts.ts`
- `app/types.ts`
- `lib/db/repository.ts`
- `lib/api/v1/services/dashboard.ts`
- `lib/api/v1/services/timesheets.ts`
- `lib/api/v1/services/reports.ts`
- `mobile/src/api/contracts.ts`
- `mobile/src/api/client.ts`
- Relevant Next.js 16 route-handler guide:
  `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`

**Changes**

1. Define explicit wire DTOs and mapping functions in
   `lib/api/v1/contracts.ts`:
   - Actor: identity, separate permission/hierarchy roles, active state, and
     normalized capability keys.
   - Timesheet: IDs, display names/email, date, hours, work text, timestamps.
   - Reference: actual project/activity fields only, including SO/Telegram
     values only when the domain contains them.
   - Dashboard: personal metrics and mapped recent entries.
   - Report bucket: `label`, `hours`, `entries`.
   - Leave/reminder/person/profile shapes.
2. Do not return raw `Timesheet` rows from v1 services.
3. Remove mobile `notes`, `status`, and other unsupported fields. Do not create
   schema columns to satisfy stale client assumptions.
4. Make report UI consume `label`.
5. Make dashboard queries explicitly personal with `userId: actor.id`.
6. Update all route tests to assert exact production wire shapes.
7. Add a contract-parity test that sends server-shaped fixtures through
   `ApiClient` and the affected screen/card tests. Test mocks must not invent a
   second shape.

**Acceptance**

- A real mapped timesheet renders project/activity/user names on mobile.
- Report groups render their server label.
- Manager/admin personal dashboard totals exclude other users.
- TypeScript contains one documented v1 shape per resource.
- No approval/status/notes schema work appears.

**Targeted verification**

```powershell
npx vitest run tests/mobile-dashboard-route.test.ts tests/mobile-timesheets-route.test.ts tests/mobile-reports-route.test.ts tests/mobile-contract-parity.test.ts
npm run typecheck
Set-Location mobile
npm run typecheck
npm test -- --runTestsByPath __tests__/api-client.test.ts __tests__/ui-components.test.tsx __tests__/reports-screen.test.tsx __tests__/home-screen.test.tsx
```

**Stop condition:** Report exact DTOs and test results. Do not start WP-01 in
the same Antigravity turn.

### WP-01 — Repair auth lifecycle, role scope, capabilities, and write policy

**Goal:** Give web and mobile identical authorization and mutation policies.

**Changes**

1. Split `requireMobileActor` into:
   - a valid-session/known-actor gate allowed for inactive users on
     `me/status/logout/logout-all`;
   - an active-actor gate for dashboard/data/mutations.
2. Add a status refresh operation to `SessionController` and
   `SessionProvider`. “Check Status” must move an activated actor to signed in,
   keep a still-inactive actor pending, and show actionable network failure.
3. Centralize role/capability helpers in `lib/roles.ts`. Web gates and actor DTO
   capabilities use the same functions. Mobile navigation reads capabilities,
   not legacy `role` strings.
4. Correct PM Team visibility and explicitly normalize `listPeopleService`
   behavior before the adapter call so native and Supabase cannot diverge.
5. Make `/api/v1/config` granular and truthful. The client must honor
   `mobileApi` and `bearerAuth`. Keep bearer sign-in disabled until the secure
   storage proof required by `docs/plans/REACT_NATIVE_MOBILE_API_IMPLEMENTATION_PLAN.md`
   is complete; never flip the flag only to make UI testing easier.
6. Extract actor-parameterized mutation orchestration shared by Server Actions
   and v1 services. Preserve:
   - validation and sanitization;
   - ownership/role checks;
   - backfill rules;
   - 24-hour daily cap;
   - one write-budget check per operation/batch;
   - consume only on successful writes;
   - stable non-sensitive error codes.
7. Apply the shared policy to timesheets, leave, and reminders first.

**Acceptance**

- Pending sessions survive restart and can detect activation.
- Inactive users cannot access data routes.
- PM cannot see Team unless hierarchy independently permits it.
- Native and Supabase return the same people scope.
- Web and v1 writes consume the same budget semantics.
- Disabled bearer rollout is visible and blocks sign-in with a useful message.

**Targeted verification**

```powershell
npx vitest run tests/mobile-config-route.test.ts tests/mobile-login-route.test.ts tests/mobile-me-route.test.ts tests/mobile-request-auth.test.ts tests/mobile-timesheets-route.test.ts tests/mobile-leaves-route.test.ts tests/mobile-reminders-route.test.ts tests/action-policy.test.ts
npm run typecheck
Set-Location mobile
npm test -- --runTestsByPath __tests__/session-controller.test.ts __tests__/session-provider.test.tsx __tests__/App.test.tsx
```

**Stop condition:** Do not continue if any role/backend case differs.

### WP-02 — Stabilize the reference behavior

**Goal:** Fix confirmed web/mobile defects before copying behavior across
platforms.

**Changes**

1. In `app/components/confirm.tsx`, ordinary confirmations unlock when no
   typing token is required; typed high-risk confirmations retain exact-token
   behavior.
2. In `app/reports/page.tsx`, export only a complete, role-scoped result:
   - fetch all required pages before generating CSV; or
   - disable export with an accurate incomplete-data explanation.
   Do not label a partial file as the selected report.
3. Preserve and display load/load-more errors in reports.
4. Make every `useAsyncData` consumer distinguish loading, error, empty, and
   refreshing. Add a shared retry presentation only when it reduces actual
   duplication.
5. Repair reminder local-value/UTC serialization in
   `mobile/src/screens/RemindersScreen.tsx`. Add strict date/time validation
   before calling `toISOString`.
6. Align the Log Time hours minimum with the stated 0.25-hour rule.
7. Remove the web reminder emoji and use the existing SVG icon.

**Acceptance**

- Ordinary delete confirmation is actionable.
- Typed super-admin confirmation remains locked until the token matches.
- Export row count and filter scope match the complete server result.
- Failed panel loads never render “No items.”
- Reminder presets round-trip correctly in Asia/Colombo and UTC.
- Hours below 0.25 are rejected with field-specific guidance.

**Verification**

```powershell
npx vitest run tests/reports.test.ts tests/data-client-pagination.test.ts tests/actions.test.ts
npm run typecheck
Set-Location mobile
npm test -- --runTestsByPath __tests__/reminders-screen.test.tsx __tests__/log-time-screen.test.tsx
```

Add and run focused Playwright coverage for confirmations and complete exports
when seeded credentials are available.

### WP-03 — Build the shared visual, component, and accessibility foundation

**Goal:** Establish equivalent tokens and component behavior before restyling
feature screens.

**Changes**

1. Create `docs/architecture/unified-experience-contract.md` from Section 5 of this plan.
   Record token names, component states, canonical copy, role labels, and
   allowed platform differences.
2. Expand `app/globals.css` and `mobile/src/theme.ts` into matching semantic
   token groups: background, surface, raised surface, primary/secondary text,
   border, focus, brand/action, information, success, warning, destructive,
   disabled, overlay, and skeleton.
3. Map mobile primary actions to VSIS crimson. Preserve blue as information.
4. Correct measured mobile contrast failures in both themes and extend
   `tests/mobile-tokens.test.ts` with contrast assertions.
5. Standardize semantic component states in web `ui.tsx` and mobile shared
   components: button, field, card, badge, notice, loading, empty, toast,
   confirmation, header, filter/tab, and metric.
6. Web fields must link help/errors through IDs and expose
   `aria-invalid`/`aria-describedby`. Mobile fields expose labels, hints,
   errors, and live announcements without double-speaking visible labels.
7. Raise all mobile touch targets to platform minimums; do not merely enlarge
   the visual glyph.
8. Add semantic headings and focus restoration to mobile screen/modal
   transitions.
9. Respect reduced motion in `PressableScale` and other animations.
10. Run a vector-icon compatibility spike for Android/iOS/Windows RN 0.84.
    Record the proof before adding a dependency. Replace all structural
    Unicode/emoji icons only after the proof passes.
11. Add Windows hover and visible focus states without forking whole screens.
12. Do not attempt web dark mode in this packet.

**Acceptance**

- Light-mode brand/action colors match across web and mobile.
- Mobile dark text/icons/controls meet contrast targets.
- All audited touch targets meet 44 pt iOS / 48 dp Android.
- Dynamic Type does not clip bottom navigation or compact controls.
- No structural emoji/Unicode icon remains after the vector proof.
- Reduced-motion behavior is testable and deterministic.

**Verification**

```powershell
npx vitest run tests/mobile-tokens.test.ts
npm run lint
npm run typecheck
Set-Location mobile
npm run lint
npm run typecheck
npm test -- --runTestsByPath __tests__/ui-components.test.tsx __tests__/sign-in-screen.test.tsx
```

Manually verify light/dark, 320/375/430 dp widths, largest Dynamic Type,
reduced motion, keyboard focus, and Windows resize.

### WP-04 — Replace ad hoc navigation with an adaptive typed shell

**Goal:** Make root tabs, child history, active states, back behavior, and
wide-screen navigation predictable.

**Changes**

1. Add a typed route registry with:
   - route key and parameters;
   - root-tab ownership;
   - title/back label;
   - required capability;
   - phone/wide visibility.
2. Add a reducer that differentiates:
   - switching a root tab (replace that tab’s root, do not push cycles);
   - pushing a child;
   - popping a child;
   - resetting after auth/logout/workspace change.
3. Build `AdaptiveNavigation`:
   - phone: Dashboard, Timesheets, Log Time, Reports, More;
   - wide/Windows: navigation rail with the same semantics;
   - active root remains selected while a child screen is open.
4. Add `MoreScreen` with role-filtered destinations.
5. Make header back labels reflect the actual parent.
6. Add dirty-form protection for Log Time/Edit Time on tab, header, Android
   back, Windows Escape, and workspace disconnect.
7. Until Team drill-down lands in WP-07, render Team rows as non-interactive
   content rather than false buttons.
8. Add Windows keyboard focus/Enter/Space/Escape behavior and preserve Android
   hardware back.
9. Do not introduce a navigation library in this packet. A future migration
   requires a separate RN/RNW compatibility decision.

**Acceptance**

- Repeated root-tab switching never grows history.
- Back text and destination always agree.
- Child Reports/Leave/Reminder/Profile screens keep the correct root active.
- Dirty forms cannot be discarded silently.
- Unauthorized destinations are absent and deep navigation is rejected.
- Phone, tablet, and Windows layouts use the same route vocabulary.

**Verification**

```powershell
Set-Location mobile
npm run typecheck
npm test -- --runTestsByPath __tests__/App.test.tsx __tests__/useAndroidBackHandler.test.tsx __tests__/ui-components.test.tsx
npm run test:windows
```

Add reducer tests for root switch, child push/pop, dirty guard, capability
rejection, logout reset, and Android/Windows back.

### WP-05A — Add mobile timesheet edit, pagination, filters, and duplicate

**Goal:** Reach daily employee workflow parity before bulk productivity.

**Changes**

1. Refactor reusable form fields/state from `LogTimeScreen` into
   `TimeEntryForm` with explicit `create` and `edit` modes.
2. Expose the already-existing `ApiClient.updateTimesheet` through
   `SessionProvider`.
3. Add `EditTimeScreen` and open it from `TimesheetEntryCard`.
4. Add an actor-scoped duplicate domain operation and
   `POST /api/v1/timesheets/[id]/duplicate`. Reuse create validation, 24-hour
   cap, backfill, rate limit, and audit behavior.
5. Add load-more/infinite pagination based on the real total count. Preserve
   current rows while filters refresh.
6. Add custom date range and project filters. Add user filter only when the
   actor capability allows team/all visibility.
7. Show user identity on non-self rows.
8. Preserve scroll/filter state when editing and returning.
9. Use optimistic update/delete/duplicate with rollback and duplicate-submit
   locks.

**Acceptance**

- Create, edit, delete, duplicate, refresh, and pagination work against both
  backends.
- Ownership/admin/backfill/daily-cap behavior matches web.
- No entry disappears due to a stale response.
- Team rows are clearly identified and never editable without authorization.
- All failure paths restore the last correct visible state.

**Verification**

```powershell
npx vitest run tests/mobile-timesheets-route.test.ts tests/actions.test.ts tests/action-policy.test.ts
npm run typecheck
Set-Location mobile
npm run typecheck
npm test -- --runTestsByPath __tests__/log-time-screen.test.tsx __tests__/timesheet-list-screen.test.tsx __tests__/ui-components.test.tsx
```

### WP-05B — Add verified web productivity conveniences

**Goal:** Reduce daily entry friction without importing desktop UI patterns.

**Changes**

1. Add copy-last entry.
2. Add smart-hours suggestions using the same inputs and result cases as
   `lib/smart-hours.ts`. If source sharing is not feasible with Metro, use one
   parity fixture suite rather than untested divergent logic.
3. Add recent-work suggestions stored per server and actor. Never cross users
   or workspaces.
4. Add Telegram command copy/share using the current
   `lib/telegram.ts` behavior and actual reference DTO fields.
5. Add multi-select and bulk edit/delete/duplicate after single-entry paths are
   stable. Prefer a contextual selection mode on phone and denser selection on
   Windows.
6. Batch operations rate-limit once per batch and return per-row outcomes.

**Acceptance**

- Common Log Time flow uses sensible defaults and remains two screens or fewer
  from Dashboard to confirmation.
- Smart-hours and Telegram outputs match web fixtures.
- Recent work is isolated by server/user.
- Bulk failure identifies affected rows and preserves successful outcomes.

### WP-06 — Unify profile, leave, reminders, global reminders, and registration

**Goal:** Complete the current web employee feature set without inventing new
domain states.

**Changes**

1. Add actor-scoped self-profile GET/PATCH for department/title and title
   reference data. Reuse `Repository.getProfileById` and
   `Repository.updateMyProfile`.
2. Extend mobile Profile with editable department/title while retaining
   password, logout-all, server, backend, and disconnect information.
3. Extend mobile leave input to a date range and submit the existing bounded
   row array contract. Use “Mark Leave,” not “Request Leave.”
4. Add due global-reminder read/dismiss v1 endpoints and mobile presentation.
5. Keep personal reminder CRUD; apply the common field/error/state patterns.
6. Add v1 self-registration only when the server capability enables the web’s
   current whitelist-aware signup flow. Reuse existing validation and generic
   security responses.
7. Do not add approval, balance, leave type, recurrence, or notification
   delivery fields.

**Acceptance**

- Profile edits and titles match web and persist in both backends.
- A leave range creates the same dates as web and respects the 366-row bound.
- Due global reminders can be dismissed and do not reappear for that actor.
- Registration appears only when enabled and enters active/pending state
  correctly.

**Verification**

```powershell
npx vitest run tests/mobile-leaves-route.test.ts tests/signup-route.test.ts tests/mobile-me-route.test.ts
npm run typecheck
Set-Location mobile
npm run typecheck
npm test -- --runTestsByPath __tests__/profile-screen.test.tsx __tests__/leaves-screen.test.tsx __tests__/reminders-screen.test.tsx __tests__/sign-in-screen.test.tsx
```

Add focused route tests for profile and global reminders with forbidden and
not-found cases.

### WP-07 — Unify reports and team workflows

**Goal:** Give authorized users equivalent reporting outcomes with
platform-appropriate controls.

**Changes**

1. Build mobile filter state for today, yesterday, week, 7 days, current/last
   month, custom range, project, and authorized user.
2. Support project/activity/user grouping only when the actor can see that
   scope.
3. Build period comparison from two validated aggregate calls.
4. Build missing weekdays from actor-scoped timesheets plus leave markers,
   matching current web rules.
5. Wire Team member selection to member-filtered Timesheets and Reports.
6. Preserve filters when navigating between Team, Reports, and Timesheets.
7. Add CSV generation and platform share/save behind a tested platform
   adapter. Adopt a dependency only after Android/iOS/Windows proof.
8. Keep web URL-backed filters; make segmented controls wrap/scroll safely at
   375 px and ensure every select has a programmatic label.

**Acceptance**

- Personal and team filters show only authorized rows.
- Compare/missing-day values match the web helper cases.
- Export is complete, correctly scoped, and named; cancel/failure is recoverable.
- Team cards have a real destination and correct accessible semantics.
- A manager, team lead, CO, admin, PM, and user each see the correct controls.

**Verification**

```powershell
npx vitest run tests/reports.test.ts tests/reports-route.test.ts tests/mobile-reports-route.test.ts tests/hierarchy.test.ts
npm run typecheck
Set-Location mobile
npm run typecheck
npm test -- --runTestsByPath __tests__/reports-screen.test.tsx __tests__/team-screen.test.tsx __tests__/timesheet-list-screen.test.tsx
```

### WP-08 — Add safe role-specific administration

**Goal:** Add high-value management parity after employee/manager flows are
stable, without exposing destructive or file-transfer operations.

Implement as separate Antigravity turns:

1. **WP-08A Projects:** admin/PM list, create, rename, SO number, Telegram
   number, delete with referenced-entry failure.
2. **WP-08B Activity types:** admin list active/all, create, rename, activate,
   Telegram number.
3. **WP-08C People/hierarchy:** admin create user, activate/deactivate, edit
   name, set permission and hierarchy roles independently, set manager.
4. **WP-08D Operations:** backfill settings, admin leave markers, admin global
   reminders.
5. **WP-08E Preferences:** map common dashboard tile visibility/order to the
   mobile feature hub without copying the desktop grid.

For every sub-packet:

- Extract/reuse actor-parameterized service logic before adding a route.
- Read the local Next.js 16 route-handler guide.
- Gate service and UI independently.
- Return stable API errors and field errors.
- Add happy, forbidden, validation, conflict, and dual-backend parity tests.
- Do not start another sub-packet in the same turn.

Explicitly out of scope for mobile in this plan:

- CSV import
- backup/restore
- domain and standard-title administration
- global default layouts
- reset operations
- permanent user/activity deletion

Mobile may show a clear “Open the web app for this operation” explanation, but
must not present a dead control.

### WP-09 — Hardening and release evidence

**Goal:** Prove the unified experience across roles, themes, sizes, failures,
backends, and platforms.

**Changes**

1. Complete the secure token-storage and rollout gates in
   `docs/plans/REACT_NATIVE_MOBILE_API_IMPLEMENTATION_PLAN.md` before advertising bearer
   auth.
2. Replace in-memory dashboard cache with an approved non-secret persistent
   adapter only after platform proof. Keep offline data read-only.
3. Add cached/skeleton-first rendering for dashboard, timesheets, and reports.
4. Add authenticated web E2E/a11y coverage for:
   - Dashboard and Reports;
   - drawer and keyboard-shortcuts dialog;
   - validation and confirmation dialogs;
   - 375 px responsive layouts;
   - admin/PM/CO/manager/team-lead/user visibility.
5. Add mobile failure-state tests for offline reads, rejected writes, stale
   cache, cross-server/user isolation, duplicate taps, back/dirty guards,
   Dynamic Type, reduced motion, and screen-reader state.
6. Validate Android, iOS device build, and Windows Debug/Release behavior.
7. Record screenshots for phone light/dark and Windows wide layouts; do not use
   screenshots as the only accessibility proof.

## 10. Verification gates

### After each server/web packet

```powershell
npm run lint
npm run typecheck
npm test
git diff --check
```

Run the smallest relevant Vitest files before the full root suite.

### After each mobile packet

```powershell
Set-Location mobile
npm run lint
npm run typecheck
npm test
npm run test:windows
```

### Release candidate

```powershell
Set-Location ..
npm run lint
npm run typecheck
npm test
npm run test:coverage

$env:NEXT_PUBLIC_BACKEND='supabase'
npm run build

$env:NEXT_PUBLIC_BACKEND='native'
npm run build

npm run e2e
npm run a11y

Set-Location mobile
npm run lint
npm run typecheck
npm test
npm run test:windows
npm run build:windows:release
```

Android/iOS release builds and installed-device tests remain mandatory even
when they run in cloud/macOS infrastructure.

## 11. Definition of done

### Contract and policy

- Real v1 responses match mobile runtime/types/tests.
- Web and bearer routes use identical business and write-budget policy.
- Role/capability behavior is identical in native and Supabase modes.
- Pending accounts restore/check activation without receiving active data.
- Bearer rollout is advertised only after secure storage proof.

### Experience

- Canonical labels, personal metrics, brand palette, feedback states, and
  capability visibility match across platforms.
- Create/edit/delete/duplicate time, leave, reminders, global reminders,
  profile, reports, and team drill-down meet the agreed parity tier.
- Platform-specific navigation feels native and never creates a dead end.
- Errors are actionable and never masquerade as empty data.
- Unsaved forms are protected.

### Quality

- No structural emoji/Unicode icon remains.
- Contrast, touch targets, Dynamic Type, reduced motion, safe areas, keyboard
  focus, and screen-reader semantics pass the target matrix.
- Lists paginate/virtualize and preserve visible data while refreshing.
- Offline data is read-only, scoped, timestamped, and isolated by server/user.
- Root/mobile suites, both backend builds, E2E/a11y, and native platform checks
  pass with exact evidence recorded.

### Repository hygiene

- No unrelated changes, generated packages, signing material, or probe files.
- No schema migration unless the plan was explicitly amended first.
- `git diff --check` is clean and `git status --short` contains intended work
  only.

## 12. Antigravity execution protocol

Gemini Flash 3.7 High should receive one bounded packet at a time.

1. Read `AGENTS.md` and this plan completely.
2. Check `git status --short --branch` and inspect all existing diffs before
   reading broad repository areas.
3. Execute only the named work packet/sub-packet.
4. Read exact target files and one-hop callers/tests before editing.
5. For Next.js route work, read
   `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
   first.
6. Preserve Server Action signatures, repository abstraction, dual-backend
   behavior, user changes, and all out-of-scope files.
7. Use existing dependencies unless the packet contains an explicit
   compatibility gate.
8. Implement happy and at least one meaningful failure/forbidden path.
9. Run targeted verification, then the packet-level gate.
10. Re-read the diff and report:
    - files changed;
    - behavior changed;
    - exact commands/results;
    - skipped external/device checks;
    - residual risks.
11. Stop and wait for review. Do not silently begin the next packet.

## 13. First Antigravity instruction

```text
Read AGENTS.md and docs/plans/WEB_MOBILE_EXPERIENCE_UNIFICATION_PLAN.md completely.
Execute WP-00 only.

Start from the current working tree; preserve all user-owned changes. Read the
local Next.js 16 route-handler guide before changing any route or service that
feeds a route. Define and map explicit v1 DTOs, align mobile contracts, remove
phantom fields, and replace invented mocks with real contract fixtures.

Do not change database schemas, navigation, visual styling, or feature scope.
Run the WP-00 targeted verification, npm run typecheck at the root, mobile
typecheck, and the named mobile Jest tests. Re-read the final diff and report
exact files, commands, results, and any blocker. Stop after WP-00.
```
