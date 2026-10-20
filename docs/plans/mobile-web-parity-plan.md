# Mobile ↔ Web Parity: Comparison and Implementation Plan

Snapshot 2026-10-20, branch `ci/parallel-e2e`. Mobile v1.4.0 (with the missing-days strip).
Evidence: the data-client calls in each web component (`app/dashboard/*`, `app/reports/*`) compared
with the session actions used by each mobile screen (`mobile/src/screens/*`). Labels: **F** = seen
in source, **I** = inference. Summary matrix: `docs/ai-context/MOBILE_PARITY.md`.

## 1. Detailed comparison

### 1.1 Time entry and timesheets

| Capability | Web | Mobile | Gap |
|---|---|---|---|
| Log entry, classification v2 | `time-entry-form.tsx`, `classification-fields.tsx` | `TimeEntryForm.tsx`, `LogTimeScreen` | none (F) |
| Today/Yesterday date chips | yes | yes | none |
| Backfill window enforced in UI | `backfillMinDate()` hides older dates (`dashboard-client.tsx:175`) | **no**: any date can be picked, and the server rejects it on save (F) | **G1** |
| Missing-days month strip | `missing-ribbon.tsx` | `MissingDaysStrip.tsx` (added 2026-10-20) | none |
| Edit / delete / duplicate one entry | `entries-table.tsx` | `EditTimeScreen`, `TimesheetListScreen` | none |
| Multi-select: batch delete, batch duplicate | yes (with the D shortcut) | yes | none |
| Multi-select: **bulk edit** | `bulk-edit-modal.tsx` → `POST /timesheets/batch-update` | missing (F) | **G2** |
| Delete last entry / undo | `deleteLastTimesheet`, `getLastTimesheet` | missing; mobile prefills from the last entry only (F) | G3 (low) |
| Offline queue, sync, manual review of queued writes | n/a | `sync-engine.ts`, `offline-queue.ts` | mobile-only |
| Admin: log an entry for another user | `backfill-form.tsx` (yesterday only, `POST /timesheets/yesterday`) | `SettingsAdminScreen` "log for user" (`createTimesheet({userId})`, F) | equivalent |

### 1.2 Reports

| Capability | Web (`app/reports/page.tsx`) | Mobile (`ReportsScreen`, `PrivilegedReportsScreen`) | Gap |
|---|---|---|---|
| My hours, date presets | yes | yes | none |
| Grouped totals (project / user / activity / type) | Group Report | `groupBy` project / user / activity / type (F) | none |
| Filter by project or user (privileged) | yes | yes | none |
| Expected hours, after-office hours, leave hours cards | `expectedHours`, `afterOfficeHours`, `leaveHours` | missing (F) | **G4** (the functions now live in `@vsis/core`) |
| Daily-hours bar chart, trend chart | `charts.tsx` | missing | **G5** |
| Missing-days calendar in reports | `MissingDaysCalendar` | Home strip only | covered by the strip (I) |
| Sri Lanka holiday calendar view | `holiday-calendar.tsx` | missing | G6 (low) |
| Project summary: hours per user on a project | yes | partly, via group-by-user with a project filter (I) | G7 (low) |
| Compare a project across two periods | yes | missing | **G8** |
| CSV export (filtered, per user, monthly, last 3 months) | `GET /reports/export` | domain action exists, but the platform exporter returns `native-file-export-not-ready` (F) | **G9** (needs a dependency) |

### 1.3 Leaves, reminders, team, profile

| Capability | Web | Mobile | Gap |
|---|---|---|---|
| Own leaves: add single / range, delete | `leave-panel.tsx` (own) | `LeavesScreen` (range mode) | none |
| Leave admin across users | `leave-panel.tsx` (admin) | `LeaveAdminScreen` | none |
| Personal reminders | yes | yes | none |
| Global reminders: due / dismiss / admin CRUD | yes | yes | none |
| Team / org tree | `team-view.tsx` (`getOrgTree`) | `TeamScreen` (tree and list, `/people`) | none |
| Profile: department and title | `my-profile-panel.tsx`, department **picker** | `ProfileScreen`, department **free text** | **G10 (bug)** |
| Change password, logout everywhere | yes | yes | none |
| Forgot / reset password, verify email | pages | opens the web page (`SignInScreen.tsx:100`) | acceptable |

### 1.4 Administration

| Capability | Web | Mobile | Gap |
|---|---|---|---|
| Users: create, roles, name, hierarchy, manager, status toggle | `add-user-form`, `user-whitelist`, `hierarchy-editor` | `UserAdminScreen` (create / edit / activate, F) | none |
| User department | picker of listed departments | **free text** (`UserAdminScreen.tsx:746`, `:887`); the server rejects unlisted names (`lib/db/native/people.ts:101`) | **G10 (bug)** |
| User department scope (limited admins) | `setDepartmentScope` | missing | **G11** |
| Delete a user's timesheets | `deleteUserTimesheets` | missing | G12 (destructive) |
| Titles CRUD, impact, reclassify | super-admin panel | `UserAdminScreen` titles tab (F) | none |
| Departments CRUD | `departments-panel.tsx` | missing; mobile never loads `/departments` (F) | **G13** |
| Projects CRUD and S.O. | `project-manager.tsx` | `ProjectAdminScreen` | none |
| Activity types CRUD | yes | yes | none |
| Branding, backfill policy | yes | `SettingsAdminScreen` | none |
| Default layouts, personal layout | `menu-customizer`, `default-panel-order` | `LayoutCustomizerScreen` | none |
| CSV import | `import-panel.tsx` | missing | web-only (see §3) |
| Backup / restore | `backup-panel.tsx` | missing | web-only |
| Super admin: DB reset, permanent user delete, domain whitelist, auto-activate, test user | `super-admin-panel.tsx` | missing | web-only |

## 2. Implementation plan

Ordered by value ÷ effort, with correctness first. Every item stays inside `mobile/` unless it is flagged
otherwise, uses only existing `/api/v1` endpoints, and adds no new dependency except G9.
Each item ships with Jest tests covering the success path and at least one failure path, and must pass
`npm run lint && npm run typecheck && npm test` in `mobile/`.

### Phase 1: correctness (S, ~1–2 days)

**P1.1: Department picker (G10).**
- Add `listDepartments()` to `mobile/src/api/client.ts` (`GET /api/v1/departments`), expose it through `admin-reference` / `SessionProvider`, and cache it with the reference data.
- Replace the free-text Department inputs in `UserAdminScreen` (create and edit) and `ProfileScreen` with `SearchablePickerModal` plus a "None" option.
- Done when: an unlisted department cannot be entered, and the server's unknown-department error is shown if the list is stale.

**P1.2: Client-side backfill window (G1).**
- Read `GET /api/v1/settings/backfill` (bearer-enabled, any active user). Add `getBackfillWindow()` to the client, separate from the admin `getBackfillSettings`.
- Use it to set the minimum selectable date in `TimeEntryForm` / `DateChooserModal`, and to make the strip's taps stop at that date (`MissingDaysStrip` gets a `minLogDate` prop, like the web).
- Move `backfillMinDate` / `minLogDateISO` from `lib/validation.ts` into `@vsis/core` the same way `work-calendar` was moved, so both platforms share it.
- Done when: dates before the window cannot be picked and are not tappable in the strip.

### Phase 2: daily-use parity (M, ~3–4 days)

**P2.1: Bulk edit (G2).**
- Add `batchUpdateTimesheets(entries)` → `POST /api/v1/timesheets/batch-update` (1–500 rows) to the client and the timesheets domain.
- In `TimesheetListScreen` selection mode, add an "Edit" action that opens a modal with the same fields as `bulk-edit-modal.tsx` (project / type / activity / hours / work done, applied only to changed fields).
- Report `{ updated, errors }` with the existing `batchReport` UI. When the device is offline, block bulk edit with a message: it is not queued, the same as web direct writes.

**P2.2: Report insight cards (G4).**
- In `ReportsScreen`, add metric cards for expected hours, after-office hours and leave hours, computed with the `@vsis/core` functions from the report rows and `listLeaves`.

**P2.3: Daily hours bars (G5).**
- Draw plain `View` bars (no chart library) for the selected range in `ReportsScreen`, and skip the trend chart.
- If a chart library is later wanted, it needs dependency approval.

### Phase 3: admin parity (M, ~3 days)

**P3.1: Departments admin (G13).**
- Add a new `DepartmentAdminScreen` (list, add, rename, delete) on `/api/v1/admin/departments[/:id]`, registered in `navigation/modules.ts` and `routes.ts` as `admin-departments`.
- Gate it on org-admin status. **F:** no `isOrgAdmin` capability exists in `packages/contracts` or `lib/api/v1` today; org-admin status is only resolved in SQL (`lib/db/native/visibility.ts`). Adding it to the capabilities DTO is a contract change: confirm first, then add an `ARCHITECTURE_DELTA` entry. Until then, show the screen to `admin`, and the server's 403 is the real gate.

**P3.2: Department scope (G11).**
- Add a multi-select of departments in the `UserAdminScreen` edit modal → `PUT /api/v1/admin/users/:id/department-scope`, shown only to org admins.

**P3.3: Project comparison across periods (G8).**
- Add a two-period picker and a single project to `PrivilegedReportsScreen`: two `getReports` calls and a side-by-side total.

**P3.4: Delete user timesheets (G12), optional.**
- Behind `ConfirmDialog` with typed confirmation (the user's email) → `DELETE /api/v1/admin/users/:id/timesheets`.
- Ship only if admins ask for it on mobile.

### Phase 4: report CSV export (L, dependency gate)

**P4.1: Native file export (G9).**
- Implement `createPlatformReportFileExporter` for Android, iOS and Windows (R2.2 spike in `reportFileExport.ts`). The contract and state machine are already in place and tested.
- Requires choosing a native file/share module. **Stop for approval before adding the dependency.**
- Then add export buttons to both report screens, and monthly presets like the web.

### Low priority / later

- G3 delete-last / undo.
- G6 holiday calendar view: one screen over `SRI_LANKA_HOLIDAYS`, cheap now that it is in core.
- G7 project-summary layout.

## 3. Web-only by design (no mobile work)

- CSV import and backup/restore: file-heavy, run rarely, by one operator.
- Super-admin DB reset, permanent user delete, domain whitelist, test user: destructive and rare; keep the attack surface off mobile bearer tokens.
- Verify-email / reset-password pages: mobile already hands off to the web.

## 4. Sequencing, risks, verification

- **Order:** P1.1 → P1.2 → P2.1 → P2.2/2.3 → P3.x → P4.
- **Parallel work:** P1.1 and P2.1 touch separate files and can run in parallel. P1.2 edits `TimeEntryForm` and `MissingDaysStrip`; avoid running it at the same time as other form work.
- **Shared-package moves (P1.2):** update `tests/*.test.ts` imports and add an `ARCHITECTURE_DELTA` entry. Run the web `typecheck`, `lint` and vitest suite in addition to the mobile checks.
- **Capabilities (P3.1/P3.2):** if `isOrgAdmin` is not on the mobile actor DTO, a contract change in `packages/contracts` is needed. Stop and confirm first.
- **Per release:**
  - `mobile/`: `npm run lint && npm run typecheck && npm test`
  - Root: `npm run typecheck && npx vitest run`
  - Then `npm run package:windows` (signed; reads `.env.local`) and an install smoke test on Windows and Android.

## 5. Status (2026-10-20)

- **Done (uncommitted):** P1.1, P1.2, P2.1, P2.2, P2.3, P3.1, P3.2, P3.3.
  - Mobile checks: lint 0 errors, typecheck, Jest 514/514.
  - Root checks: typecheck, vitest (1633 passed, 51 DB tests skipped without `TEST_DATABASE_URL`).
- **Deviations from the plan:**
  - P2.1 bulk edit mirrors the web modal's fields; hours and work done are not editable.
  - P2.2/2.3 cards and bars are hidden when a member filter is active, and they ignore the type and activity filters.
  - P3.1 Departments is a fixed More-screen card gated on `canManageSettings`, not a `MobileModuleId`; adding one would be a contract change. The list is read from `GET /api/v1/departments`.
- **Not started:** P3.4 (optional, destructive) and P4 (CSV export; needs dependency approval).
- **Unverified:** on-device behaviour, including nested picker modals inside the UserAdmin and BulkEdit modals on iOS and Windows.

## 6. Re-audit after Phases 1–3 (2026-10-20)

Rechecked against this checkout and against `origin/dev`, which is 6 commits ahead: PR #47, "carry department scope on the actor".

**Still open**

| # | Gap | Web | Mobile today | Effort | Notes |
|---|---|---|---|---|---|
| G9 | Report CSV export (filtered, per user, monthly) | `app/reports/page.tsx` | exporter stub returns `native-file-export-not-ready` | L | Needs a native file/share dependency; awaiting approval. |
| G14 ✅ done | Filter the timesheet list by user (managers) | "Filter by user" select in `entries-table.tsx:731` | only reachable via Team → member (`filterUser` param); no picker on the list | S | Add a member picker to `TimesheetListScreen`, using `listPeople` (already wired). |
| G15 ✅ done | Month totals (hours and entries this month) | dashboard month stat cards (`dashboard-client.tsx:701`) | Home shows Today and Last 7 days; the strip shows month status but not totals | S | One `MetricCard` from the strip's existing month read, or from `getReports`. |
| G3 | Delete last entry / undo | `deleteLastTimesheet` | missing | S | Low value; mobile has per-entry delete. |
| G6 | Holiday calendar view | `holiday-calendar.tsx` | missing | S | Data is already in `@vsis/core`. |
| G7 | Project summary layout (hours per user on one project) | Project Summary card | possible via group-by-user plus a project filter | S | Presentation only. |
| G12 | Delete a user's timesheets | `deleteUserTimesheets` | missing | S | Destructive; only if admins ask. |

**Alignment items from `dev` (do these after merging `dev` into the mobile work)**

- **A1:** `dev`'s web no longer calls `setDepartmentScope` when a user leaves admin/CO, because the server clears the scope in the role update (`people.ts` sets `scope_departments = null`). Mobile `UserAdminScreen.tsx` (~line 267) still sends `[]` in that case. Against `dev` this is harmless (it writes null again) but redundant, so drop it to match the web.
- **A2:** `dev` adds server-side `isOrgAdmin(actor)` in `lib/roles.ts` and loads `scope_departments` onto the actor, but `ActorCapabilities` still does not expose it to mobile.
  - Mobile's Departments screen and scope editor gate on `canManageSettings` (admin), and rely on the server's 403 for scoped admins.
  - Adding `isOrgAdmin` to the capabilities DTO would let mobile hide those controls for scoped admins. This is a contract change, so confirm it before doing it.

**At parity, newly confirmed in this pass:** reminders (`remindAt` on both), global reminders, leave admin, layouts, branding, team tree. The web's `access` and `saved` dashboard keys are layout configuration, not features.
