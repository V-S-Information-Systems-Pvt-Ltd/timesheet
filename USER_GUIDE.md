# VSIS Time Sheet System — User Guide

A practical guide to using the VSIS Time Sheet System day-to-day: logging time,
managing your entries, generating reports, and what each role can do.

## Contents

1. [Roles and permissions](#roles-and-permissions)
2. [Signing in](#signing-in)
3. [Logging time](#logging-time)
4. [Your recent entries](#your-recent-entries)
5. [Keyboard shortcuts](#keyboard-shortcuts)
6. [Reports](#reports)
7. [Leave](#leave)
8. [Reminders](#reminders)
9. [Telegram bot commands](#telegram-bot-commands)
10. [Customizing your dashboard](#customizing-your-dashboard)
11. [Admin guide](#admin-guide)
12. [Troubleshooting & FAQ](#troubleshooting--faq)

---

## Roles and permissions

Every account has **two independent roles**: a **permission role** (what you
are allowed to do) and a **hierarchy role** (where you sit in the reporting
tree). They are set separately by an admin.

**Permission role** — what you can do:

| Permission role | What you can do |
| --- | --- |
| **User** | Log, edit, and delete your own time entries; mark leave; set personal reminders; change your password. |
| **PM** | Everything a User can, plus manage projects. |
| **CO** | Everything a User can, plus view all profiles/timesheets and generate reports. |
| **Admin** | Everything — manage users and roles, projects, activity types, backfill, global reminders, import, backup & restore, and change settings. |

**Hierarchy role** — where you sit in the reporting tree:

| Hierarchy role | What it means |
| --- | --- |
| **User** | A leaf: no direct reports. |
| **Team Lead** | A reporting target; view and filter the entries of users who report to you. |
| **Manager** | A reporting target; view and filter the entries of users who report to you. |

The two axes are independent — e.g. someone can be an **Admin** by permission
and a **Manager** by hierarchy, or a **CO** who reports to a Manager.

**Super Admin** — the single configured account (`SUPER_ADMIN_EMAIL`, also an
Admin): everything an Admin can, plus destructive operations (reset the
database, delete users/activity types) and setting the default panel order.

> Your individual reports-to relationship (who to ask for approvals) is held
> in **My Profile → Report to** — configured by an admin.

## Signing in

- Accounts are created by an admin; there is **no public self-signup**.
- New accounts start **inactive**. If you cannot sign in, ask an admin to
  activate your account.
- Use the email + password your admin provided, then visit
  **Change Password** (top right) to set a private password.
- If you forget your password, an admin must reset it for you (native mode has
  no email service).

## Logging time

Open the **Log Time** tile on the dashboard.

1. **Project** — pick the project (type to search).
2. **Activity type** — pick the kind of work (e.g. development, testing).
3. **Hours** — enter hours (e.g. `8`, `3.5`). Need a nudge? If the system has
   found a pattern in your recent weekday entries, a **Quick-fill** button
   appears suggesting your most common hours — click it to fill the field.
4. **Work done** — describe what you worked on. As you type, suggestions from
   your recent entries appear; use **↑/↓** and **Enter** to pick one, or just
   keep typing.
5. **Copy from last entry** — fills project, activity type, and description
   from your most recent entry (handy when you continue yesterday's work).
6. Optional: tick **Copy Telegram command** to copy a ready-to-send bot command
   to your clipboard when you submit.
7. Click **Submit Entry**.

Notes:

- You can log **multiple entries per day**, but the **24-hour daily cap** is
  enforced — total hours for a day cannot exceed 24.
- The **backfill window** (default: today + yesterday) controls how far back you
  can create or edit entries. Entries older than the window are read-only;
  admins are never restricted.

## Your recent entries

The **Recent Entries** tile lists entries newest-first, grouped by day
(Today / Yesterday / date). When you have many entries, the list is
**paginated**: use **Previous / Next** and the **entries-per-page** selector
(25 · 50 · 100) at the bottom to move through pages. The page resets to the
first page when you change the user filter.

- **Edit** — hover a row (desktop) or tap the **⋯** menu (mobile), then Edit.
  Change the project, type, hours, work done, or date and save.
- **Delete** — same menu; you'll be asked to confirm.
- **Duplicate** — same menu, or select one or more rows and press **D** (or use
  the bulk **Duplicate** button).
- **Bulk actions** — tick the checkboxes on the left of rows (or the header
  box to select all). The action bar lets you:
  - **Bulk Edit** — change the **project** or **activity type** of every
    selected entry at once (leave a field blank to keep each entry's existing
    value).
  - **Copy Commands** — copy the Telegram bot commands for every selected row.
  - **Duplicate** — duplicate every selected entry.
  - **Delete** — delete every selected entry (confirmed first).
  - **Clear** — clear the selection.
- **Today** — jump the list to today's entries.
- **Filter by user** (admins, COs, managers, team leads) — narrow the list to a
  specific person's entries.

## Keyboard shortcuts

Also shown in-app with **?**.

| Key | Action |
| --- | --- |
| `N` | Focus the time entry form |
| `/` | Focus the project picker |
| `E` | Edit your last entry |
| `U` | Delete (undo) your last entry |
| `D` | Duplicate the selected entries |
| `?` | Show/hide this shortcut help |
| `Esc` | Close the drawer or modal |

Shortcuts are ignored while you're typing in a form field, and the browser
default actions (e.g. Ctrl+D bookmark) are never hijacked.

## Reports

Open **Reports** from the navigation bar (visible to all users; admins/COs see
all data, others see their own).

- **Date range** — pick a preset: **Today**, **Yesterday**, **This Week**,
  **Last 7 Days**, **This Month**, **Last Month**, or a **custom** start/end.
- **Project filter** — narrow the report to one project.
- **Comparison** — compare one period against another (e.g. this month vs
  last month) to see the difference.
- **Export** — admins can download the current report as a **CSV** file
  (Reports panel in the admin dashboard).

## Leave

Open the **Leave** tile.

- Mark days you're on leave so your team sees your availability.
- Your leave markers are recorded per day alongside your timesheet data.
- Admin-only tools live in the admin dashboard under **Leave Admin**
  (e.g. viewing team leave).

## Reminders

- **Reminders** (your tile) — personal reminders, shown on your dashboard.
- **Global Reminders** (admin) — reminders shown to everyone.

## Telegram bot commands

If your organization uses the Telegram bot, open the **Telegram Bot Commands**
tile. It lists the commands the system generates, and the log form can copy the
command for each entry automatically (see [Logging time](#logging-time)).

The commands are also available in the entry table via **Copy Commands**
after selecting rows.

## Customizing your dashboard

- Everyone can **add, remove, and reorder tiles** on their dashboard (and
  admins on the admin dashboard) using the customization controls on the page.
- Your layout is saved per account; changes apply immediately.
- The **default** order/visibility (what you see before customizing, and what
  new users start with) is set by the **Super Admin** under **Super Admin →
  Default panel order**.

## Admin guide

Everything below is **Admin only** (unless noted) and lives in the **Admin**
section of the app.

- **Users** — activate/deactivate accounts, set **permission role** and
  **hierarchy role**, set **Report to** (manager/team lead), and edit profile
  details.
- **Add User** — create new accounts (email + temporary password), choosing
  the permission and hierarchy roles. The account stays inactive until you
  activate it.
- **Projects** — create, rename, archive, or remove projects.
- **Activity Types** — manage the activity-type list used on the log form.
- **Backfill** — add or correct timesheet entries for any user.
- **Settings** — change the **backfill window** (how far back regular users
  can edit entries).
- **Global Reminders** — reminders displayed to all users.
- **Leave Admin** — view/manage team leave.
- **Report Export** — generate and download CSV reports for any period.
- **Import** — bulk-import timesheet entries from a CSV file. Limited to
  **10 imports per day**.
- **Backup & Restore** — download a JSON backup of the database, and restore
  from a backup file.
- **Super Admin** (super-admin account only) — destructive: **reset the
  database** (wipe all data), **delete users** or **activity types**, and set
  the **default panel order**. Use with extreme care.

## Troubleshooting & FAQ

**I can't sign in — my account isn't active.**
Ask an admin to activate it. Until an admin activates you, login is rejected.

**I forgot my password.**
An admin must set a new one for you (there is no self-service email reset).

**Why can't I edit an entry?**
The entry is outside your backfill window (older than the configured window,
default today + yesterday). Ask an admin to backfill/change it, or an admin
can adjust the window in Settings.

**I hit the 24-hour cap.**
You've logged 24 hours for that day already — a new entry for the same day is
rejected. Keep your per-day total at or below 24 hours.

**My recent-work suggestions disappeared.**
The suggestions come from your browser's local storage for this site. Clearing
browser data removes them; they rebuild as you log new entries.

**The shortcuts aren't working.**
Shortcuts are intentionally disabled while you're typing in a text field —
click outside the field first. Ctrl/Cmd/Alt combinations are never intercepted.

**Which backend am I on?**
It doesn't matter day-to-day: Supabase and native deployments behave the same.
Ask your administrator if you need account/billing specifics.

**I got a "Rate limit exceeded" message when logging time or importing.**
The system limits how often you can perform certain actions to protect against
abuse:
- **Login** — a small number of failed attempts per hour are allowed before the
  account is temporarily blocked. Wait and try again later.
- **Editing/logging entries** — up to **100 write actions per day** per user.
- **Importing** (admin) — up to **10 imports per day**.
Wait for the window to reset (the error tells you roughly how long), or ask an
admin if you need a higher limit.

**My work-done description looks like it had some text removed.**
Free-text entries are sanitized before they are stored: HTML tags and script
content are stripped and extra whitespace is collapsed. This is to prevent
malicious content (XSS) from being saved or displayed. Plain text notes are
unaffected.

**The app is faster with many entries now — is that expected?**
Yes. The dashboard now loads paginated entry pages, uses skeleton loading while
data is fetched, and the database has a composite index on the most common
query, so large history stays responsive.