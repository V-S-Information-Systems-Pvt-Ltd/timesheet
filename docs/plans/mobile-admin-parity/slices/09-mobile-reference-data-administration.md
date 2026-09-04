# 09 Mobile reference-data administration

**What to build:** Add modular mobile administration for projects and activity
types using the same validation, capability boundaries, and conflict behavior as
the web app.

**Blocked by:** 01

## Acceptance criteria

- [ ] Admin and PM can list/create/rename/configure permitted project fields;
      only admin can manage activity types, matching server-authored capabilities.
- [ ] Activity create/rename/activate/deactivate and Telegram-number changes
      match web behavior; bounded safe deletion requires confirmation and honors
      reference conflicts.
- [ ] Collections are searchable, paginated/bounded, refreshable, and preserve
      visible data during background refresh.
- [ ] Validation, duplicate names/numbers, referenced deletion, 403, 409, 500,
      offline, and repeated-submit states provide actionable feedback.
- [ ] Mutations invalidate reference/dashboard/form caches so all projects and
      activity types appear without cross-workspace or cross-user leakage.
- [ ] Native/Supabase repository parity, admin route, role matrix, and mobile
      module tests pass.
