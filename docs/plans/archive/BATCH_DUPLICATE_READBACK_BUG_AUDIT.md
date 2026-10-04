# B03: committed batch duplicate read-back failures

## Decision required

Treat a valid-ID successful create as committed even when its optional post-write read-back throws. Preserve synthesized-entry fallback, actor/ownership/backfill/daily-hours enforcement, response shape, and one write-budget charge per batch. Production ownership is transport_audit; this scout owns only this packet and the dedicated regression file. Initial review precedes production changes.

## Verified evidence

FACT: lib/domain/timesheets.ts batchDuplicateTimesheetsWork creates an entry, updates running totals, then awaits persistence.getById(createdId). Null read-back already synthesizes an entry from the authorized source and committed fields. A thrown read-back skips that fallback, reaches the outer catch, reports per-item failure, and does not increment duplicatedCount.

FACT: exported batchDuplicateTimesheetsDomain charges only for duplicatedCount > 0. The actual runWithWriteBudget implementation releases the reservation for non-chargeable results. Native adapter INSERT RETURNING ID is committed before separate read-back; Supabase getById throws on query errors. Thus read-back failure can turn a successful write into an apparently failed, refunded batch.

INFERENCE: clients may repeat apparently failed copies under new request keys; reservation refunds undercount committed writes. Database daily-hour triggers still cap totals; no concurrency bypass is alleged.

## Proposed minimal protocol

After successful create with valid ID, isolate optional read-back in a local try/catch. On null or thrown read-back, use the existing synthesized committed entry and report/count success. Keep source lookup/create failure as per-item failure. Do not swallow pre-write authorization, validation, or create errors; do not invent IDs for successful create lacking an ID. No migrations, transport/public contracts, or adapter changes.

## Alternatives and risk

Rolling back committed insert requires a new transaction contract and creates rollback races; reject for this bounded fix. Merely retaining budget while reporting failure leaves ambiguous retry semantics; prefer established fallback. Source-derived fallback may lack newly joined metadata, as it already does on null read-back; retain current behavior rather than expanding DTO design.

## Regression acceptance

tests/timesheet-batch-duplicate-readback.test.ts calls actual exported batchDuplicateTimesheetsDomain and its real write-budget orchestration with injected persistence/budget. Successful create returning created ID followed by thrown read-back must report synthesized success/count 1 and retain reservation. Genuine create failure must refund without read-back. Existing null fallback must remain successful/charged. No module mock factories are needed.

## Finding ledger

B03 | FACT | committed insert + thrown read-back reports failure/count 0 and refunds batch budget | reviewer approved local read-back fallback; production owner implemented | original reservation regression failed (committed create called once; release called once); settled suite passes 6/6 | independent closure approved; final root verification passed.

## Settled regression evidence

The six exported-domain tests cover thrown read-back synthesized success/count, retained real budget reservation, genuine create failure/refund/no read-back, existing null fallback, committed first copy consuming remaining daily capacity before the next item, and mixed item ordering with admin-preserved source ownership/target date/sanitized fallback work. Initial synthesized-success case used a target after its test clock and was correctly rejected before create; moving the fixed clock to target day corrected that fixture. The original reservation test independently demonstrated the actual post-commit bug before the production owner's patch. No production files changed by this scout.


## Settled closure verification

Sol 6.1 approved the combined B01/B02/B03 delta and exported-domain regression
coverage. Final root coverage includes all six B03 tests: 1,642 tests passed,
60 environment-gated tests skipped. Coverage gates, lint, types and both backend
production builds passed. No adapter, schema or migration change was required.
