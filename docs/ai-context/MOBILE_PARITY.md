# Mobile ↔ Web Feature Parity

Snapshot: 2026-10-20 (branch `ci/parallel-e2e`, HEAD `3ee70c5`). Method: diffed the `/api/v1`
paths called by `lib/data/client.ts` / `lib/auth/client.ts` / `app/**` against `mobile/src/**`
and `mobile/App.tsx`, then confirmed each gap in source. Labels: **F** = FACT (seen in the cited
file), **I** = INFERENCE, **U** = UNKNOWN.

## Gaps (web has it, mobile does not or only partly)

| Feature | Web location | Mobile | /api/v1 endpoint(s) | In mobile client? | Effort | Notes |
|---|---|---|---|---|---|---|
| Missing-days month strip (logged / missing / leave / holiday; tap a missing day to log it) | `app/dashboard/missing-ribbon.tsx` | **present (2026-10-20)** | `GET /timesheets`, `GET /leaves` | y | S–M | F: `mobile/src/components/MissingDaysStrip.tsx` on Home. Holiday list moved to `@vsis/core` (`packages/core/src/work-calendar.ts`). Mobile does not hide days outside the backfill window; the server rejects them on save. |
| Bulk edit of selected entries | `app/dashboard/bulk-edit-modal.tsx`, `entries-table.tsx` | partial | `POST /timesheets/batch-update` | n | M | F: mobile `TimesheetListScreen` already multi-selects for batch delete/duplicate; edit is the missing action. |
| Log an entry for another user (admin backfill) | `app/dashboard/backfill-form.tsx` (`dataClient.logYesterday`) | present (equivalent) | web `POST /timesheets/yesterday`; mobile `POST /timesheets` with `userId` | y | — | F: `SettingsAdminScreen.tsx:208` logs for a selected user. Corrected 2026-10-20. |
| Report CSV export | `app/reports/page.tsx` (export buttons) | partial | `GET /reports/export` | y | L | F: domain action exists, but `createPlatformReportFileExporter` returns `native-file-export-not-ready` (`mobile/src/services/reportFileExport.ts:303`). Needs a native file/share module, i.e. a **new dependency**. |
| Report charts, expected-hours card, holiday & missing-days calendars | `app/reports/page.tsx`, `app/components/charts.tsx`, `app/reports/holiday-calendar.tsx` | missing | `GET /reports` | y | M–L | F: no charts in mobile. I: charts would need a chart lib, or plain `View` bars. |
| Department admin (CRUD) | `app/dashboard/departments-panel.tsx` | missing | `/admin/departments`, `/admin/departments/:id` | n | M | F: mobile never loads `/departments`, and its department fields are free text, which the server rejects for unlisted names (`lib/db/native/people.ts:101`). See plan P1.1/P3.1. |
| User department scope | `lib/data/client.ts:585` (user admin) | missing | `PUT /admin/users/:id/department-scope` | n | S | F. |
| Delete a user's timesheets | `lib/data/client.ts:747` | missing | `DELETE /admin/users/:id/timesheets` | n | S | F. Destructive admin operation. |
| CSV timesheet import | `app/dashboard/import-panel.tsx` | missing | `POST /admin/timesheets/import` | n | L | I: needs a native file picker (new dependency). |
| Backup export / restore | `app/dashboard/backup-panel.tsx` | missing | `/admin/backup`, `/admin/backup/restore` | n | L | I: file I/O; better kept web-only. |
| Superadmin: reset, permanent user delete, whitelist | `app/dashboard/super-admin-panel.tsx`, `user-whitelist.tsx` | missing | `/admin/superadmin/*` | n | L | I: destructive and rarely used; candidate to exclude from mobile on purpose. |
| Forgot / reset password | `app/forgot-password`, `app/reset-password` | partial | `/auth/browser/forgot-password`, `reset-password` | n/a | — | F: `SignInScreen.tsx:100` opens the web page. This is acceptable as is. |

Implementation plan: `docs/plans/mobile-web-parity-plan.md`.

## At parity (present on both)

Sign-in, sign-up, change password, logout / logout-all (`ProfileScreen`), pending approval; log time
with classification v2 and last-entry prefill (`TimeEntryForm`); edit, delete and duplicate entries,
batch delete and batch duplicate (`TimesheetListScreen`); personal and privileged reports with filters;
team view (`/people`); leaves; reminders and global reminders (with dismiss); admin screens for users
(roles, hierarchy), projects, activity types, titles, global reminders, branding and backfill policy;
layout/panel customizer; my profile. All F (screens are in `mobile/src/screens/`).

**Mobile-only:** leave admin (`/admin/leaves`, `LeaveAdminScreen`) and the offline queue/sync (`mobile/src/sync`).

## Excluded from mobile on purpose

`app/verify-email` and `app/maintenance` are link targets and server states, not app features.
`app/page.tsx` is the web login page, which mobile covers with `SignInScreen`. `/cron/cleanup`, `/health*`
and `/api/branding/logo` are infrastructure.
