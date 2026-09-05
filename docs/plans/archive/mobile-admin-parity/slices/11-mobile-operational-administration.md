# 11 Mobile operational administration

**What to build:** Add modular mobile admin workflows for backfill policy,
logging time for another user, leave markers, and global reminders while
preserving all web policy and audit behavior.

**Blocked by:** 01

## Acceptance criteria

- [ ] Admin can read/update backfill mode/window settings with the same bounds
      and explanation as web; non-admin writes return 403.
- [ ] Admin backfill selects user/date/project/activity explicitly and enforces
      validation, daily cap, duplicate-submit lock, and audit behavior.
- [ ] Authorized leave administration lists/adds/removes markers with explicit
      user/date/reason and scoped confirmation; regular personal leave is unchanged.
- [ ] Admin can list/create/update/delete global reminders with bounded message
      and time validation; user dismissals and stale caches remain correct.
- [ ] Every module distinguishes loading, refresh, empty, error, offline,
      submitting, success, destructive confirmation, and dirty-form states.
- [ ] Settings, timesheet, leave, reminder, authorization, audit, adapter parity,
      and mobile screen tests pass.
