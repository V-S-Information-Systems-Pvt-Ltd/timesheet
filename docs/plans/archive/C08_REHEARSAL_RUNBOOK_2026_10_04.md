> Historical reference archived 2026-10-04. The complete previous document body follows;
> dated headings, checkpoint statuses and operational requirements below describe the old process.
> Current execution follows the [four-stage plan](../SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN.md).
> This snapshot is evidence, not production authorization or a current checklist.

# C08 rehearsal runbook — measured volume and both recovery paths

C08's PASS requires measured numbers rather than capability demonstrations. This runbook is the executable procedure behind C08 tasks 1–6; it is written so an operator can run it without chat context.

**Status:** **partially specified / not started**. The operator supplied fewer than 50,000 rows with 10% monthly growth, a 60-minute freeze budget, 120-minute RPO, 720-minute RTO, and no external files. [October 3 C00 evidence](C00_LIVE_INVENTORY_2026_10_03.md) records the selected hosted source's live counts and the fresh native Docker destination. The source direct-DB/Auth binding and bounded source compatibility now pass. Existing hosted project `timesheet-test` is the selected original-provider recovery target; its scoped logical restore independently matched 57 selected tables / 2,238 rows, 25 function definitions/permissions, sequence state, and 23 Auth identities. Account password usability, platform-level recovery, durable/off-host retention, and provider-wide writer shutdown remain open. No representative-volume rehearsal has run. The [writer-control inventory](C00_WRITER_CONTROL_INVENTORY.md) identifies production scheduled cleanup and Auth/session writers requiring independent controls. Observed source row sizes and host capacity are now recorded below, but operator ceilings for total window, RSS, disk, and maximum record size remain unset. Executing the rehearsal is not authorized by this status update.

### Partial privilege-fence sequence (not a deployment shutdown)

2026-10-03 update: read-only source inspection, Auth/database binding, required
ledger and source schema support now pass. The operator approved omitting
profiles.full_name under the existing snapshot equivalence guard; exact source
variants retain strict destination and required-row validation. See
[compatibility evidence](../evidence/c00-source-compatibility-2026-10-03.json) and
the [column retirement plan](../PROFILE_FULL_NAME_RETIREMENT_PLAN.md). This
supersedes the unverified source-binding statement above. The selected
`timesheet-test` original-provider recovery target has since passed the scoped
logical restore/reconciliation described above. C08 remains not ready pending
full writer controls, client/session proof and the remaining declared resource
ceilings/enrollment inputs.

Only after C00 selects writer roles, record the partial SQL privilege-fence step:

```
npm run migration -- fence --target <provider> --target-env <MIGRATION_ENV> --action activate --role <roles> --run-id <run> --reason "C08 rehearsal" --actor <operator> --out <exclusive-artifact>
npm run migration -- fence --target <provider> --target-env <MIGRATION_ENV> --action verify --role <roles>
```

Keep the artifact: normal release needs its exact run's `writable` receipt and that run's now-open durable gate with the artifact's same `fence_generation`; recovery instead needs an explicit decision with actor/reason while that exact fenced generation remains in place. This does not fence Supabase Auth/admin, jobs, integrations, ingress, or established connections. Before apply, fill and prove `[stop ingress]`, `[disable Auth/admin writers]`, `[pause jobs/integrations]`, `[drain/revoke existing connections]`, and `[verify each control]` for both deployments.

Use [C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md](C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK_2026_10_04.md)
as the required control/evidence shape; rehearsal fills its provider-specific
UNKNOWNs without applying them to production.

## Step 0 — declare the budgets first

Record these before the first measured run, in the evidence ledger. Declaring after measuring invites fitting the numbers to the result, which is exactly what C08 exists to prevent.

| Budget | Field | Source |
| --- | --- | --- |
| Total window | `window_minutes` | operator commitment |
| Portion that may occur inside the freeze | `freeze_minutes` | operator commitment |
| Pre-window work that must be done earlier | `pre_window_work` | rehearsal phases 1–5 |
| Recovery point objective | `rpo_minutes` | operator → backup cadence |
| Recovery time objective | `rto_minutes` | operator → measured phase 9 |
| Peak memory ceiling on the apply host | `peak_rss_mb` | host capacity |
| Peak disk for bundles and backups | `peak_disk_gb` | volume × growth margin |
| Expected volumes and growth margin | `rows`, `growth_margin` | C00 |
| Largest allowed row and settings record | `max_row_bytes` | C00 |

Declared so far: `rows < 50000`, `growth_margin = 10% monthly`, `freeze_minutes = 60`, `rpo_minutes = 120`, `rto_minutes = 720`, external files excluded. Source inspection measured a largest observed portable JSON row of **1,267 bytes** (`profiles`) and an `app_settings` row of **462 bytes**. The protected source archive was 556,426 raw bytes / 556,646 DPAPI-protected bytes for the captured source snapshot. The Docker host reported 16,292,470,784 bytes of memory with no per-container limit; the PostgreSQL volume reported 978,240,992 KiB available and Windows drive C reported 92,828,729,344 bytes free at observation time. These are observations and capacity context, not accepted rehearsal ceilings. `window_minutes`, `peak_rss_mb`, `peak_disk_gb`, and `max_row_bytes` remain unset and must be declared before the measured run.

## Step 1 — the target deployment (rehearsal only)

Use disposable targets. The hosted **development** project is approved for rehearsal traffic; Preview and Production are not. Freeze first and record the gate state you are replacing so teardown can restore it:

```
npm run migration -- gate --target <provider> --target-env <MIGRATION_ENV> --state fenced --run-id <run> --reason "C08 rehearsal" --actor <operator>
```

Then seed sanitized representative data at the declared volumes — including realistic overlap, the high-row-count categories, and at least one row and one settings record at `max_row_bytes` — into the rehearsal source, and populate the rehearsal destination so that destinations-only records, credentials and later changes exist to be preserved.

## Step 2 — measure the phases

Run the documented operator sequence (`## Operator runbook` in the implementation plan, plus `publish --phase intent|admit` and `verify --record`), recording each number as it happens. Do not benchmark raw inserts and call it the answer — the budget is the *operator-visible* sequence:

| Phase | Number to record | Where it comes from |
| --- | --- | --- |
| Preliminary export | wall time, bundle bytes, peak disk | phase timing around `export` |
| Bundle validation | wall time, drift diagnostics count | `validate` output and journal |
| Preview plan creation | wall time, conflict count by kind | `plan` output |
| Operator conflict resolution | wall time, decisions recorded | `resolve` |
| Stale-plan regeneration | wall time, digest change reason | re-run `plan` after drift, then `resolve` |
| Preliminary backup, both sides | wall time, bytes, verified position | provider tools |
| Final freeze and final snapshots | wall time, no-writer confirmation | `gate` + snapshot ids in the manifest |
| Provisioning/enrollment | wall time, Auth attempts, rate-limit retries | `apply` journal |
| Apply transaction **inside the lock** | wall time, locks held, peak RSS | `apply` with the destination fenced |
| Verification | wall time, digests compared, mismatches | `verify --record` |
| Publication | wall time to `publication-intent`, then to writers admitted | `publish --phase intent`, `--phase admit` |
| Recovery (step 4) | wall time, includes any repeat enrollment | rehearsal below |

Separate pre-window work from the freeze portion explicitly; the freeze portion is the number the maintenance-window promise depends on.

## Step 3 — build and endpoint checks (task 3)

Build and start the exact target-backend artifacts before the freeze: both production builds, plus the web and mobile endpoints against the rehearsal destination. Record the build time as pre-window work.

## Step 4 — recovery rehearsal, pre-publication (task 5, first half)

Stop before publication intent, then prove:

1. restoration of the exact final pre-merge records, identities, passwords and external objects (or a recorded decision for objects, per task 4);
2. safe resumption of **both** original deployments afterwards;
3. sessions invalidated by the freeze stay invalid — resumption must not revive them.

## Step 5 — recovery rehearsal, post-publication (task 5, second half)

After writers are admitted, add real records, updates, deletions and one new account to the merged destination, then reverse-migrate its **full current dataset** into a prepared disposable recovery destination of the **original provider** (Supabase for a Supabase→native transfer; native for a native→Supabase transfer) and prove. For the current Supabase→native direction, `timesheet-test` is selected but currently contains the verified restored-source snapshot; before this rehearsal step, verify the exact project identity and explicitly reset/prepare that authorized disposable target, or identify another disposable Supabase recovery target. Do not assume it is empty.

1. destination-original data and the later changes are preserved;
2. excluded and deleted records are **not** resurrected;
3. the recovery time includes any repeat enrollment and environment provisioning.

## Failure rule (task 6)

If the single-transaction import cannot meet the declared budget, C08 stays **BLOCKED** and the staging/publication design is revised and re-reviewed for crash consistency. Switching to partially committed batches is not an option: it would trade a measured miss for an unmeasured correctness defect.

## Evidence to retain (V8)

Redacted timings per phase, resource maxima, reconciliation digests, Auth retry counts, every failure with its recovery, and the rollback evidence from both rehearsals. Teardown restores the gate state it replaced and removes every rehearsal artifact, including any enrolled account, whitelist row, receipt, mapping and journal entry.
