# 01 Mobile modules and customizable layouts

**What to build:** Replace hard-coded mobile feature lists with a typed,
capability-filtered module registry. Let super-admin set one default module
layout and let each user save or reset a synchronized override without hiding
essential time/security destinations.

**Blocked by:** none, can start immediately

## Acceptance criteria

- [ ] Registry metadata is the single source for eligible routes, labels, icons,
      capability requirements, default order, and essential status.
- [ ] A super-admin can save/reset the default mobile layout and a regular user
      can save/reset only their own override on both backends.
- [ ] Unknown/duplicate IDs are discarded, new essential IDs are merged, and
      Log Time, Timesheets, and Profile/Security remain reachable.
- [ ] Capability filtering overrides saved visibility, and direct route/API
      access still returns 403 when unauthorized.
- [ ] Offline users may view a cached effective layout but cannot mutate it.
- [ ] Focused migration, repository parity, route authorization, reducer, and
      mobile layout UI tests pass.
