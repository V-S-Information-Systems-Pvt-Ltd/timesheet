# B01 bulk-edit validation decision packet

## Decision required and acceptance

Validate per-row timesheet edits before deriving persistence aggregate parameters,
while preserving partial results and the daily 24-hour cap. Rejecting a row must
not remove its unchanged original hours from another row's accounting. Retain
one batch rate charge/refund, authorization and backfill gates, and backend parity.
Duplicate IDs follow the reviewed first-eligible-occurrence policy described below.
No migrations or transport edits are proposed.

## Current architecture and evidence

- FACT: `batchUpdateTimesheetsSchema` validates structural string/number fields;
  its comment explicitly delegates per-row field validation to the domain
  (`packages/contracts/src/timesheets.ts:47–57`).
- FACT: `bulkUpdateTimesheetsWork` derives date pairs and prefetches daily sums
  from raw inputs before parsing `logEntrySchema` (`lib/domain/timesheets.ts`,
  original lines 621–650).
- FACT: native prefetch casts `$2::date[]`; Supabase filters its date column with
  raw strings and throws provider errors (`lib/db/native/timesheets.ts:301`,
  `lib/db/supabase/timesheets.ts:428`). No live database reproduction was run.
- FACT: runtime reproduction passed `not-a-date` to persistence before any schema
  parsing. New direct-domain tests reproduce malformed-date batch failure,
  aggregate query for all-invalid dates, and invalid original hours incorrectly
  subtracted from the 24-hour check.
- INFERENCE: real adapters abort mixed batches instead of preserving valid edits.

## Lifecycle and accounting invariant

Activate one budget reservation for a bounded batch. Parse and gate each row;
retain its position for ordered error reporting. Only candidates allowed by
schema, existence, ownership, and original/replacement backfill checks contribute
aggregate query parameters or expected replacement accounting. Rejected rows
remain unchanged in persistence and therefore in daily totals. Prefetch once for
eligible dates; no aggregate/write call if none qualify. Enforce 24-hour cap and
sanitize accepted replacements, then delegate transactional/concurrency checks
and row failures to existing persistence. Refund the reservation if nothing is
updated. Database failure handling and concurrency boundaries stay unchanged.

## Alternatives and unresolved questions

- Proposed: prevalidate/gate candidates before aggregate collection; use those
  candidates for replacement accounting and ordered per-row results.
- Rejected: merely catch date-cast failures; still queries malformed values and
  discards valid rows. Rejected: whole-batch schema refinement; violates documented
  partial-result semantics.
- Approved accounting protocol: index all errors by original position. Only
  parsed, authorized, backfill-eligible candidates qualify. The first eligible
  occurrence of each ID is scheduled; later eligible occurrences receive a
  per-row duplicate error. An invalid occurrence does not suppress a later valid
  occurrence. Each scheduled original is removed from baselines exactly once.
- Stable admission: start with all eligible candidates, compute baselines from
  stored totals minus their originals, and greedily admit in input priority.
  Whenever a daily-limit row is rejected, permanently remove it from candidates,
  restore its original by recomputing baselines, and recompute remaining rows.
  Repeat until no more rejections. This monotonic process terminates in at most
  the bounded batch size and preserves valid swaps while preventing a rejected
  removal from financing another edit. Return indexed errors in input order,
  then persistence row errors in their existing order.

## Persistence boundary and remaining risks

- FACT: native `bulkUpdate` performs one UPDATE statement and reports IDs that
  were not returned; SQL scope can skip ownership/backfill-ineligible rows
  (`lib/db/native/timesheets.ts:406–485`). Supabase rechecks owners and calls its
  existing bulk RPC, likewise reporting missing returned IDs
  (`lib/db/supabase/timesheets.ts:536–595`).
- INFERENCE: rows skipped after the preflight can retain originals that were
  removed in the domain estimate. Preflight is not a concurrency/atomicity
  guarantee; existing backend constraints remain authoritative. The B01 patch
  does not solve persistence-race or partial-write coordination.
- FACT: both backends retain daily-hours BEFORE INSERT/UPDATE triggers with a
  user/date advisory lock and stored-total check excluding the updated row
  (`db/migrations/0015_data_integrity_and_concurrency.sql:18–27`,
  `supabase/migrations/20260831000000_data_integrity_and_concurrency.sql:18–27`).
  Trigger exceptions roll back the UPDATE statement. Valid domain swap projection
  may still meet intermediate stored-row limits during execution; database
  integration was not run, and no commit guarantee is claimed.
- FACT: both adapters may return a top-level write `error` with `updated: 0` and
  empty row errors. The domain currently ignores that field. This is a separate
  existing reporting issue, reported to the coordinator rather than folded into
  the candidate-accounting repair.

## Verification and reviewer request

Review candidate selection, unchanged hours, source/destination moves, ordered
errors, duplicate IDs, role/backfill parity, failed writes, and rate refunds.
Required regressions: mixed valid/malformed dates with aggregate rejecting bad
dates; all-invalid rows with zero aggregate/write calls; invalid row original
hours retained when another edit moves onto that date. Add further accounting
cases required by the approved invariant; run focused domain/browser batch tests,
lint/typecheck, then coordinator's settled full matrix. No Next code edits planned.

## Finding ledger

| ID | Failure | Repair | Verification | Remaining blocker |
| --- | --- | --- | --- | --- |
| B01 | Raw invalid dates reach aggregates; rejected edits' hours are subtracted | Eligible unique candidates plus monotonic admission recomputation | Three original failures reproduced; settled domain/browser/actions 110 tests pass; typecheck/scoped lint pass | Independent closure approved; final root coverage, lint, types and both builds passed |

## Settled implementation evidence

The domain now parses/gates rows and captures indexed errors before aggregating.
Only uniquely scheduled candidates remove originals; no-candidate batches bypass
aggregate and write calls. Daily-cap rejections permanently leave the admission
set, causing original-hour restoration and another bounded pass until stable.
Nine new cases cover malformed dates, all-invalid batches, unchanged invalid
originals, rejection cascades, simultaneous domain swap projection, duplicate
accounting, invalid-then-valid duplicate occurrences, authorization/backfill
gates, and ordered persistence row failures. Existing one-charge/refund tests
pass. Backend adapters, schemas and routes remain unchanged.

## B02 decision: propagate aggregate write failure

- FACT: both persistence adapters return a top-level error for aggregate failure
  with zero committed rows; native statement rollback and Supabase RPC rejection
  do not produce successful partial writes. Domain bulk updates ignored this
  field, returning successful `{ updated: 0, errors: undefined }`.
- FACT: regression reproduced that false success when persistence returned
  `Daily total would exceed 24 hours.`; the expected STORAGE_ERROR assertion failed.
- Approved repair: immediately return the existing domain shape
  `{ ok: false, error: { code: 'STORAGE_ERROR', message: result.error } }` when
  `bulkUpdate` reports an aggregate error. Do not reinterpret partial row outcomes
  with null top-level error. The existing budget wrapper refunds the reservation
  because a failed result is not chargeable; existing transports map the failure.
- Compatibility: preserve successful count/row errors and one charge when at least
  one row commits; preserve ordinary zero-update/no-error refund. No adapter,
  schema, migration or production transport change is needed.
- Checks: failed message/refund; successful partial errors/charge; existing
  successful, ordinary zero-update and transport-mapping cases. No retries added.

| ID | Failure | Repair | Verification | Remaining blocker |
| --- | --- | --- | --- | --- |
| B02 | Aggregate write failure incorrectly reports success | Return established STORAGE_ERROR before processing row results | Original regression failed; repaired domain/browser/actions 110 tests pass, typecheck/scoped lint pass | Independent closure approved; final root coverage, lint, types and both builds passed |

The API compatibility test confirms existing service mapping remains HTTP 400 /
VALIDATION_ERROR with the original storage message. The Server Action returns its
established `{ error: message }` shape. Both refund one reservation. The direct
domain still returns STORAGE_ERROR; no transport mapping changes were made.


## Settled closure verification

Independent Sol 6.1 closure review approved B01/B02/B03 without remaining findings.
On the settled domain patch, root coverage ran 143 passing files / 1,642 passing
tests; 13 files / 60 integration tests remained environment-gated. Coverage gates,
lint, TypeScript, and Supabase/native production builds passed. Backend checks
used CI-equivalent compile-only settings, not live databases. Prior mobile checks
remain applicable because this batch did not modify mobile/shared-client source.
Full batch evidence is recorded in CONTINUOUS_BUG_AUDIT.md.
