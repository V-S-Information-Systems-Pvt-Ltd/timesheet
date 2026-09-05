# 06 Reliable mobile project selection

**What to build:** Select the seeded project named Internal by default for new
time entries and make the complete searchable project collection usable in the
Windows picker as well as Android and iOS.

**Blocked by:** none, can start immediately

## Acceptance criteria

- [ ] Create mode selects the exact Internal project when present regardless of
      sort order; edit mode and explicit copied/recent selections are unchanged.
- [ ] If Internal is absent, the form shows an unselected state rather than
      silently choosing an unrelated project.
- [ ] Reference count and picker count agree, and a large list can reach/select
      first, middle, and last projects on Windows, Android, and iOS.
- [ ] Search matches project name and SO code without dropping unrendered items;
      empty/error/loading states remain distinct.
- [ ] A Windows failure artifact or regression test is captured before the
      picker implementation is changed.
- [ ] Reference route, TimeEntryForm, picker, and Windows Jest tests pass.
