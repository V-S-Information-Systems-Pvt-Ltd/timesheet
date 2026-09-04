# 05 Date-aware timesheet duplication

**What to build:** Require the user to choose and confirm a target date before
single or bulk timesheet duplication, then pass that date through the existing
versioned API and domain validations.

**Blocked by:** none, can start immediately

## Acceptance criteria

- [ ] Single duplicate opens an accessible date chooser instead of mutating
      immediately; cancel performs no request.
- [ ] Bulk duplicate accepts one target date for the selected batch and includes
      it for every item; partial failures remain attributable per row.
- [ ] Default target date is explicit in the UI and never silently inferred by
      the server after confirmation.
- [ ] Invalid/future/out-of-window dates, unauthorized rows, and daily totals
      above 24 hours use existing policy/error semantics on both backends.
- [ ] Repeated taps are locked while submitting and optimistic insertion rolls
      back or reports errors without corrupting counts/selection.
- [ ] Targeted single/bulk route tests and mobile date-dialog tests pass.
