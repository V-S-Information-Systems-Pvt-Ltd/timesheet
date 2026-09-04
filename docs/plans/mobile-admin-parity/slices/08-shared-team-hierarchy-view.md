# 08 Shared Team hierarchy view

**What to build:** Add the same role-gated searchable Team directory and
expandable reporting tree on web and mobile, with authorized member drill-down
to filtered Timesheets and Reports.

**Blocked by:** 04

## Acceptance criteria

- [ ] One pure projection handles roots, children, inactive/missing-manager
      profiles, stable ordering, and defensive cycle/orphan presentation.
- [ ] Web and mobile show equivalent names, titles, hierarchy labels,
      departments, reporting relationships, loading/error/empty states, and
      expand/collapse semantics.
- [ ] Only server-authorized profiles are returned; PM, engineer, and user do
      not gain Team access through client-side routing.
- [ ] Selecting a visible member opens member-filtered Timesheets and Reports,
      preserves relevant filters on return, and never enables unauthorized edits.
- [ ] Non-actionable rows are not announced as buttons; keyboard, screen reader,
      touch target, focus, and reduced-motion requirements are met.
- [ ] Projection, people-route scope, navigation, web component, mobile screen,
      and authenticated role-matrix tests pass.
