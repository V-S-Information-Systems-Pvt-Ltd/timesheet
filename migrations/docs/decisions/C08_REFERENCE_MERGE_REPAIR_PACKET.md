# C08 reference merge transaction repair — 2026-10-04

## Decision required

Make the reviewed merged reference state writable without transient unique-key
collisions or lost field selections. Preserve applied schema, transactionality,
fencing, source records and destination-only rows.

## Verified evidence

- FACT: `migrations/tool/src/import.ts:applyEntries` inserts creates before
  updates, and collects existing-row writes only for `entry.action === 'update'`.
- FACT: `merge-plan.ts:materialize` accepts field selections on `map` and `update`,
  and applies explicit security selections to resolved rows. These changes appear
  in the expected result even when the corresponding entry is a map.
- FACT: Both backend Telegram migrations create immediate partial unique indexes
  on nullable `projects.telegram_no` and `activity_types.telegram_no`.
- FACT: Actual-data rehearsal resolve passed, with zero duplicate nonnull Telegram
  numbers in either final expected reference table. One existing row in each table
  changes Telegram number. Apply rolled back with `activity_types_telegram_no_key`.
- FACT: All rehearsal operations target owned disposable database
  `vsis_c08_rehearsal_20261004_105004`. Original seeded database and production
  remain unchanged. Protected artifacts never belong in repository/test fixtures.
- INFERENCE: An incoming create needs a number occupied by a seed row whose
  approved number changes; insert-first ordering and skipped mapped writes can
  produce both transient conflict and expected-state divergence.

## Lifecycle and constraints

The existing gate/row lock and one app-data transaction cover reference writes,
relationships, mapping/disposition/retry records and durable receipt. Any refusal
or error must roll back staged values. Retry/uncertain outcome rules stay intact.
Do not change migrations, disable uniqueness, modify real data to fit the importer,
allocate arbitrary Telegram numbers, or broaden release admission.

## Options and chosen invariant

Prefer deriving necessary existing-row changes from reviewed expected rows and
target snapshot (including mapped field/security selections). Before inserts or
updates, release only changed nullable unique Telegram slots inside the same
transaction, then install final reviewed values. Keep uniqueness enforced on
final state and on retained rows. Consider ordering-only only if it also handles
cycles/swaps; otherwise it is insufficient. No global nulling or schema weakening.

## Acceptance checks

1. Mapped field and security changes reach the database; unchanged mapped and
   destination-only rows remain untouched.
2. Existing changed Telegram slot reused by new create succeeds.
3. Two reviewed rows swapping unique nullable Telegram values succeed.
4. A duplicate final value or later write failure leaves baseline and receipts
   unchanged; staged release never commits separately.
5. Focused regression tests and relevant migration package gates pass, with real
   PostgreSQL evidence where immediate-index behavior matters. Re-run actual-data
   apply/verify/retry on the existing protected clone after repair.

## Write ownership

One worker owns importer and focused migration test edits. Root owns rehearsal
wrappers/evidence and integration; no concurrent importer/test edits. Independent
review is required because this changes migration transaction behavior.
