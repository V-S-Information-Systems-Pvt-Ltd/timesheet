# Practical exercises

Exercises are assigned one at a time after their prerequisites. This list is a future exercise bank, not an instruction to start Lesson 1 or run commands now. Use synthetic data and a development/test environment. Do not record passwords, tokens, connection strings, or private user data in learning notes.

## Read-only progression

| Exercise | Prerequisites | Task and source | Deliverable | Acceptance criteria |
| --- | --- | --- | --- | --- |
| E01 — Read a small function | L1.1–2 | Inspect `requiresProject` in [classification helpers](../../packages/contracts/src/timesheets.ts), lines 75–77 | Label parameter, literal, comparison and return; predict three calls | Correct predictions plus an explanation of input → evaluation → output |
| E02 — Transform a row | L1.4–5, L2.1 | Inspect `timesheetToLogEntry` in [smart-hours helpers](../../packages/core/src/smart-hours.ts) | Write the returned object for one synthetic input and list omitted fields | Explain new-object creation, numeric conversion and unchanged input |
| E03 — Trace a calculation | L1.3–5, L2.8 | Follow [computeSmartHours](../../packages/core/src/smart-hours.ts) using the weekday examples in [tests](../../tests/smart-hours.test.ts) | A table of entry → included/excluded → count → final result | Explain no-consensus, invalid hours and tie behavior without running code first |
| E04 — Resolve imports | L1.6 | Follow [test imports](../../tests/smart-hours.test.ts) through [re-export](../../lib/smart-hours.ts) to shared core | A path/symbol chain | Distinguish a re-export from another implementation |
| E05 — Trace UI state | L3.1–3 | Read [welcome page](../../app/page.tsx), lines 16–22 and 44–76 | State timeline for successful and failed sign-in | Explain the setter, awaited result, catch and finally paths |
| E06 — Map a save | L4.1–3 | Use [execution guide](05-code-execution-flows.md), verifying each linked symbol | A diagram with input/output/error shape at every layer | Trace actual `/api/v1` path; include both persistence choices without inventing ORM or Server Action hops |
| E07 — Explain relational changes | L4.3–4 | Compare [initial timesheets schema](../../db/migrations/0001_initial_schema.sql) with [classification migration](../../db/migrations/0039_timesheet_classification.sql) | Relationship/nullability sketch and valid/invalid examples | Explain why nullable project references do not make every classification combination valid |
| E08 — Explain access control | L4.5 | Inspect [auth facade](../../lib/auth/index.ts), [versioned guard](../../app/api/v1/_http.ts), and one adapter create method | Gate table for anonymous, inactive, own-user and other-user requests | Distinguish identity, active state, role, origin and ownership; qualify uninspected paths |
| E09 — Reason about concurrent writes | L4.4 | Read [daily-hours SQL](../../db/migrations/0015_data_integrity_and_concurrency.sql) | Timeline for two 16-hour entries on one day | Explain the precheck race and where committed-data enforcement lives |
| E10 — Design a debugging session | L5.1 | Select a form/route failure and inspect [form](../../app/dashboard/time-entry-form.tsx) and [route](../../app/api/v1/timesheets/route.ts) | Hypothesis, breakpoint/request observations, expected branches | Identify evidence that can falsify the hypothesis; avoid changing code just to guess |
| E11 — Read tests before execution | L5.2 | Read a success and failure test in [smart-hours tests](../../tests/smart-hours.test.ts) or [domain tests](../../tests/timesheet-domain.test.ts) | Predictions plus statement of test scope/mocks | Explain what a passing unit test establishes and what requires real DB/browser evidence |
| E12 — Review deployment boundaries | L6.4 | Compare [Dockerfile](../../Dockerfile), [Next config](../../next.config.ts) and [CI](../../.github/workflows/ci.yml) | Build/runtime configuration map and backend-switch checklist | Explain rebuild requirement, server-only secrets and tests for both backend modes |

## Observing a local runtime

After a suitable development/test environment is available, inspect a known flow using browser Network, React Developer Tools, editor breakpoints and existing focused tests. Predict first, observe second, reconcile discrepancies third. A browser save writes data even if you do not edit source; use authorized test records.

An existing pure test can be run from the repository root with:

```powershell
npm test -- tests/smart-hours.test.ts
```

That is an exercise command, not a claim that it was executed during setup. Type checking, linting, DB integration, mobile and browser checks answer different questions. Consult [the stack guide](01-technology-stack.md) and current manifests/configuration before selecting commands.

## Isolated coding progression — explicit permission required

The tutor must present the intended files, behavior and checks, obtain your explicit permission, then work within that scope. Prefer a scratch exercise or isolated branch/check-out. Permission to discuss an exercise is not permission to edit application code, run database migrations, restore backups, deploy, or contact external systems.

| Exercise | Prerequisites | Proposed work | Acceptance criteria |
| --- | --- | --- | --- |
| C01 — Standalone function | L1.1–5 | Write a small typed function in an agreed scratch file; do not alter shared production helpers | Correct input/output plus explanation of one failure/boundary case |
| C02 — Pure test | L2, L5.2 | In an isolated exercise, implement a pure calculation with success and invalid-input tests | Predict then run meaningful tests; explain failures before fixing them |
| C03 — Small form change | L3, L5.1–3 | Select a bounded presentation/feedback improvement after inspecting current UI | Explain component/state impact; verify relevant accessibility and UI behavior |
| C04 — Bounded application feature | L4, L5.4 | Agree acceptance criteria, ownership and impacted contracts before implementation | Test success/rejection; consider both adapters and mobile consumers; report skipped checks |
| C05 — Protocol/design exercise | L6.1–4 | Write a design for retry/concurrency/provider behavior before touching sensitive code | Cover activation, completion, recovery, stale artifacts and concurrent transitions; justify trade-offs |

Choose concrete feature scope at the lesson, based on current repository state and your interests. Avoid deliberately weakening authorization or editing applied migrations as practice.

## Reflection and assessment

For each exercise, submit your prediction or artifact and a short explanation of why it works. The tutor evaluates the reasoning, gives precise feedback, and records evidence in [progress](08-learning-progress.md). A correct outcome with uncertain reasoning can remain “needs practice.” An AI-authored solution alone does not demonstrate your competency.
