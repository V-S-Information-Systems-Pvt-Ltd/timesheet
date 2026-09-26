# C08 rehearsal runbook — measured volume and both recovery paths

C08's PASS requires measured numbers rather than capability demonstrations. This runbook is the executable procedure behind C08 tasks 1–6; it is written so an operator can run it without chat context.

**Status:** **partially specified / not started**. The operator supplied a source reference (`.env.2.local`), local Docker as destination, fewer than 50,000 rows with 10% monthly growth, a 60-minute freeze budget, 120-minute RPO, 720-minute RTO, and no external files. The local Supabase and native databases are reachable, but `.env.2.local` has no migration source database connection; neither a live source inventory nor a representative-volume rehearsal has run. The empty local native database `vsis_migration_c08_recovery` is suitable only when native is the original provider; a Supabase→native rehearsal still needs an unused Supabase recovery destination. Writer/integration inventory, row-size and host-capacity bounds, and §11's deployment-specific shutdown/drain and verification controls also remain open. Nothing here contacts production.

### Partial privilege-fence sequence (not a deployment shutdown)

Only after C00 selects writer roles, record the partial SQL privilege-fence step:

```
npm run migration -- fence --target <provider> --action activate --role <roles> --run-id <run> --reason "C08 rehearsal" --actor <operator> --out <exclusive-artifact>
npm run migration -- fence --target <provider> --action verify --role <roles>
```

Keep the artifact: normal release needs its exact run's `writable` receipt and that run's now-open durable gate with the artifact's same `fence_generation`; recovery instead needs an explicit decision with actor/reason while that exact fenced generation remains in place. This does not fence Supabase Auth/admin, jobs, integrations, ingress, or established connections. Before apply, fill and prove `[stop ingress]`, `[disable Auth/admin writers]`, `[pause jobs/integrations]`, `[drain/revoke existing connections]`, and `[verify each control]` for both deployments.

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

Declared so far: `rows < 50000`, `growth_margin = 10% monthly`, `freeze_minutes = 60`, `rpo_minutes = 120`, `rto_minutes = 720`, external files excluded. The total window, peak RSS/disk and maximum record sizes remain unset; do not infer them from these figures.

## Step 1 — the target deployment (rehearsal only)

Use disposable targets. The hosted **development** project is approved for rehearsal traffic; Preview and Production are not. Freeze first and record the gate state you are replacing so teardown can restore it:

```
npm run migration -- gate --target <role> --state fenced --run-id <run> --reason "C08 rehearsal" --actor <operator>
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

After writers are admitted, add real records, updates, deletions and one new account to the merged destination, then reverse-migrate its **full current dataset** into a reserved empty recovery destination of the **original provider** (Supabase for a Supabase→native transfer; native for a native→Supabase transfer) and prove:

1. destination-original data and the later changes are preserved;
2. excluded and deleted records are **not** resurrected;
3. the recovery time includes any repeat enrollment and environment provisioning.

## Failure rule (task 6)

If the single-transaction import cannot meet the declared budget, C08 stays **BLOCKED** and the staging/publication design is revised and re-reviewed for crash consistency. Switching to partially committed batches is not an option: it would trade a measured miss for an unmeasured correctness defect.

## Evidence to retain (V8)

Redacted timings per phase, resource maxima, reconciliation digests, Auth retry counts, every failure with its recovery, and the rollback evidence from both rehearsals. Teardown restores the gate state it replaced and removes every rehearsal artifact, including any enrolled account, whitelist row, receipt, mapping and journal entry.
