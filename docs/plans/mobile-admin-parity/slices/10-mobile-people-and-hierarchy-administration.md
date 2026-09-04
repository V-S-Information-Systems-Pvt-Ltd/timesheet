# 10 Mobile people and hierarchy administration

**What to build:** Add admin mobile workflows for creating users, activating or
deactivating accounts, assigning independent permission roles and classified
titles, and maintaining cycle-safe reporting lines. Include super-admin title
creation/classification without permanent user deletion.

**Blocked by:** 01, 04

## Acceptance criteria

- [ ] Admin can search users, create an account, edit display name, activate or
      deactivate eligible accounts, and assign permission role/title/reporting line.
- [ ] Super-admin can add, classify, reclassify, and remove unused titles with
      affected-user/conflict handling; other admins can select but not administer titles.
- [ ] Self-role, self-deactivation, self-reporting, cycle, invalid manager,
      contradictory classification, and last-representable-value guards match web.
- [ ] Password creation follows the existing password policy and secrets never
      enter logs, caches, audit detail, or persisted form state.
- [ ] Successful mutations refresh Team, actor capabilities where relevant, and
      admin lists without exposing profiles outside the actor's scope.
- [ ] Action/API parity, audit, role matrix, cycle, dual-backend, and mobile form
      failure-state tests pass.
