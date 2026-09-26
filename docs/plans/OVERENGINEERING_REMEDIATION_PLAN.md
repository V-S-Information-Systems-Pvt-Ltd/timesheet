# Overengineering remediation: current assessment

Reviewed 2026-09-19 against `637a8f6` on
`arch/dual-backend-modular-implementation`. The original proposal was written
for `codex/master-architecture-remediation` on 2026-09-11. This document
records which proposals still fit the goal of reducing complexity **without
changing externally observable behavior** in either backend.

## Decision

No code removal from the original proposal is currently justified. The
Supabase effect layer implements a distinct durable replay guarantee, the logo
proxy's socket transport enforces DNS pinning, and the safe dead-code and CSV
deduplication items have already been completed. Keep the existing code and
regression tests. Reopen a specific cleanup only with a concrete simplification
and focused evidence that its behavior and security properties are preserved.

This assessment does not decide whether the product should retire Supabase
durable offline replay. That would be a separate capability change with a
deployment and migration plan.

Keep the explicit Server Actions facade in `app/actions.ts`, the separate web
cookie and mobile bearer authentication routes, and the existing plan archive.

## 1. Supabase idempotency: retain

**Original proposal:** delete the Supabase effect-stamp layer, its migration
files, adapter helpers, capability flag, and tests while retaining the native
ledger.

**Current evidence:**

- `lib/idempotency.ts` still routes stamped operations through
  `runSupabaseStampedDelivery`. Supabase effect handling lives in
  `lib/db/supabase/timesheets.ts` and
  `lib/db/supabase/leave-reminders.ts`; `lib/db/supabase.ts` is now a
  composition facade. The original method and line-number edit list is stale.
- `lib/auth/mobile-config.ts` advertises durable replay for native mode and
  for Supabase only when `DURABLE_IDEMPOTENCY_ENABLED=true`.
  `mobile/src/auth/SessionProvider.tsx` uses that capability to gate queued
  replay. Removing the effect path would change behavior when enabled.
- The archived implementation record at
  `archive/MASTER_ARCHITECTURE_REMEDIATION_NOTES.md` records a hosted
  Supabase migration ledger through `20260927000000` on 2026-09-13,
  including the effect migration. That is historical evidence, not proof of
  every environment's current state. The full eight-operation hosted replay
  check remained open there, so the Supabase flag stayed disabled.
- `20260923000001_close_immutable_idempotency_transaction.sql` closes the
  transaction opened by the effect follow-up migration. Later files
  `20260927000000_harden_security_definer_ownership_and_mobile_guard.sql` and
  `20260929000000_reconcile_baseline_amendments.sql` reference effect functions.
  Deleting or editing applied migration files would break migration history
  and fresh installs. The native `0031_idempotency_effects.sql` is an
  intentional no-op migration retained for audit continuity.
- `tests/idempotency-stamp-recovery.test.ts`,
  `tests/idempotency-supabase.test.ts`,
  `tests/supabase-migrations.test.ts`, and
  `tests/mobile-config-route.test.ts` cover the retained behavior.
  Removing these tests would erase useful regression coverage.

**Disposition:** remove Phase 1 from this behavior-preserving cleanup. Do not
delete the SQL, types, effect helpers, capability flag, or tests. If retiring
Supabase replay becomes a product requirement, first record current capability
settings and migration state for every deployment, specify mobile queue
behavior, then use additive migrations and a staged rollout. Preserve native
ledger semantics independently.

## 2. Branding proxy: retain DNS-pinned transport

**Original proposal:** replace `https.request` and its timeout handling with
standard `fetch` plus `AbortController`.

`lib/branding-proxy.ts` now has 402 lines. `validateSafeUrl` checks all DNS
answers, and `fetchPinned` passes the validated address to the actual
`https.request` socket through a custom `lookup` while retaining the
hostname for TLS and HTTP. Standard `fetch` does not provide that
connection-level lookup hook in this codebase. A direct swap would leave a DNS
rebinding window after validation. The existing response size, MIME, redirect,
and deadline checks also span the whole request.

**Disposition:** remove Phase 2 as written. Consider a transport refactor only
with a documented, supported way to pin the actual socket to the validated
address for every redirect and tests proving the connection target, timeout,
size cap, MIME rejection, and redirect behavior. Do not trim SSRF tests to
match a simpler implementation.

## 3. Small cleanup candidates

| Original item | Current state | Disposition |
| --- | --- | --- |
| Remove `getActiveTransactionClient` from `lib/db/pool.ts` | Absent; native transactions use `transaction` and its local AsyncLocalStorage. | Done; no edit. |
| Remove `releaseWriteRateLimit` from `app/actions/_shared.ts` | Absent; reservations release through `lib/domain/write-budget.ts`. | Done; no edit. |
| Collapse `lib/reports.ts` CSV helpers | It already re-exports `TIMESHEET_CSV_HEADERS` and `timesheetCsvRows` from `lib/reports/csv-export.ts`; chunk formatting lives only there. | Done; no edit. |
| Collapse super-admin predicates | `lib/auth/super-admin.ts` already re-exports the predicate from `lib/roles.ts`. | Done; retain the server-only entry point. |
| Remove `lib/db/migrate.ts` | It remains the typed boundary for pool and CLI migration entry points. | Retain. |
| Consolidate single and batch timesheet duplicate/delete | `lib/domain/timesheets.ts` has distinct result shapes, partial batch outcomes, write-budget charging, and batch running-day totals. | No safe mechanical dedupe identified. |
| Collapse report export handlers | `app/reports/page.tsx` already shares `runExport`; the small wrappers select different date, filter, and filename behavior. | Keep unless a concrete simpler form is demonstrated. |
| Merge web and mobile CSV export routes | Both use `lib/reports/csv-stream.ts`; the routes differ in authentication, validation envelopes, user alias, preflight, 204 response, and count header. | Keep their transport-specific wrappers. |

The original estimate of 3,200–3,300 deleted lines is obsolete. It counted
regression tests and applied migrations, and its branding estimate was smaller
than the work needed to preserve socket pinning. LOC reduction alone is not an
acceptance criterion.

## Verification for this assessment

Check the current source paths and migration references above, then run a
Markdown/path review and `git diff --check`. This is a documentation update,
so runtime tests and builds are unnecessary. For a future code change, select
focused success and failure tests for the affected contract, run typecheck,
and run both backend builds when shared runtime behavior changes. Preserve
existing migrations and tests unless a separate, reviewed capability change
explicitly replaces them.
