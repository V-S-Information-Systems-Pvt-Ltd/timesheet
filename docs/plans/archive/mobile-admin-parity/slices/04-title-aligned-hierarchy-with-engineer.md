# 04 Title-aligned hierarchy roles with engineer

**What to build:** Classify every configurable title as manager, team lead,
engineer, or user; add non-leadership engineer to profile hierarchy roles; and
keep title selection and hierarchy role aligned without changing permission
roles.

**Blocked by:** none, can start immediately

## Acceptance criteria

- [ ] New forward migrations widen both backends, add title classification, and
      map engineer to legacy user while preserving existing profile access.
- [ ] Manager and team lead remain the only reporting targets/team leaders;
      engineer has the same visibility as user.
- [ ] Creating/editing a user derives hierarchy role from the selected title,
      and contradictory title/role writes are rejected server-side.
- [ ] Self-service title edits are limited to titles in the actor's current
      hierarchy classification; changing classification remains admin-only.
- [ ] Reclassifying a title displays affected-user impact and either updates
      atomically after confirmation or preserves users until explicit reassignment.
- [ ] Cycles, self-management restrictions, and independent permission roles
      behave exactly as before.
- [ ] Migration, role matrix, hierarchy, action, repository parity, and RLS
      regression tests pass.
