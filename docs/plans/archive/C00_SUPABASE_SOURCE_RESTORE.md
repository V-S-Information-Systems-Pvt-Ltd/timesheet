# C00 Supabase logical source recovery — 2026-10-03

> Archived 2026-10-04 as supporting reference. Recorded evidence, contracts and
> unverified limitations retain their scope; this move marks no pending check complete.
> Current work follows the [active plans](../../README.md#active).

Status: **SCOPED LOGICAL RESTORE PASS; FULL RECOVERY GATE PARTIAL.**

The approved encrypted source backup was restored into the verified timesheet-test
Supabase project using explicit MIGRATION_DESTINATION settings. Docker native
remains the primary migration destination. No live source data/schema write,
portable transfer, provider freeze, email, billing change or cutover ran.

## Result and evidence

Archive integrity and compatible managed COPY columns passed before mutation.
The successful rollback rehearsal was followed by read-only reconciliation and
an acknowledged committing transaction. That transaction validated selected
table counts/hashes, function definitions/owners/privileges and restored trigger
state before commit. Sequence counters were applied last, only in the commit.

A fresh consistent target dump and independent SQL/Auth API reads then passed:

| Check | Result |
| --- | --- |
| Selected tables / rows | 57 / 2,238; every sorted COPY-row SHA-256 matched |
| Public and private functions | 25; definitions, owners and execute grants matched |
| Public tables / RLS tables / policies | 23 / 23 / 68 |
| Public user triggers | Nine; none disabled |
| Application migration-history rows | 71 |
| Auth users / identities | 23 / 23; API identity membership matched |
| Profile/Auth ID gaps / email mismatches | 0 / 0 |
| Captured sequence counters | Matched |
| Legacy full_name | One populated value, equal to name |

Provider-managed schema definitions and auth.schema_migrations/storage.migrations
were preserved. Required roles/extensions already existed; role metadata was
not replayed. Public namespace/default privileges were preserved. Four private
function bodies absent from the archive schema scope were recovered from its
application migration history, compared to live source bodies, and restored with
source owners/grants and hardened empty search paths. The managed Auth trigger
was preserved; its application-owned hook was temporarily made a no-op under
the transaction's Auth-table lock, then restored before validation. Only public
USER triggers were temporarily disabled. Internal constraints stayed enabled.

Preliminary rollback failures led to explicit permission, FK-order, COPY-output
and semantic ACL comparisons. One earlier failed rehearsal reached setval, whose
effect does not roll back; target sequence immutability is not claimed. The
final protocol excludes counters from rollback tests and independently verifies
the committed counters. No source sequence was changed.

## Finding ledger and remaining gates

| ID | Finding / resolution | Verification / remaining scope |
| --- | --- | --- |
| RESTORE-01 | Managed Auth ownership and replication-role changes are unavailable; preserve the trigger and transiently replace only its application-owned hook. | Successful rollback, commit and enabled-trigger checks; no role escalation. |
| RESTORE-02 | Four private functions are outside captured schema scope. Recover exact bodies from captured application history. | Body comparison to live source plus all 25 full definition/owner/grant checks. |
| RESTORE-03 | FK ordering and PostgreSQL COPY formatting must be exact; raw ACL array order is not semantic. | Source/destination FK union, exact COPY output and sorted aclexplode comparisons pass. |
| RESTORE-04 | Sequence updates are nontransactional. | Dry-run skips updates; commit applies them last; fresh verification matches. |
| RECOVERY-01 | Auth records and API enumeration are restored, but password login/enrollment has not been tested. | Open; do not equate account enumeration with usable login or native SMTP enrollment. |
| RECOVERY-02 | Platform configuration, encryption roots, custom-role passwords and storage payloads are outside this capture. | Open scoped limit; storage has zero captured objects. |
| RECOVERY-03 | DPAPI CurrentUser archives remain in a private temporary folder. | Open durable/off-host retention and authorized recovery access decision. |

This is a logical recovery test of the preliminary live-source snapshot. Its
duration does not prove production RPO/RTO, representative capacity, writer
shutdown or C08 readiness. C00/C06B/C07 remain partial. Actual deployed releases,
writer/client/session controls, reference merge decisions and native enrollment
remain required. C08 has not started; C09/C10 authorization is unchanged.
Portable migration omits full_name under its guard; no source retirement DDL ran.

- [Archive review](../evidence/c00-supabase-restore-archive-plan-2026-10-03.json)
- [Successful rollback rehearsal](../evidence/c00-supabase-restore-dry-run-2026-10-03.json)
- [Pre-commit rollback reconciliation](../evidence/c00-supabase-restore-rollback-reconciliation-2026-10-03.json)
- [Acknowledged committing restore](../evidence/c00-supabase-source-restore-2026-10-03.json)
- [Independent post-commit verification](../evidence/c00-supabase-source-restore-verification-2026-10-03.json)
- [Decision and lifecycle packet](../../ai-context/C00_SUPABASE_RESTORE_PACKET.md)
- [Protected source archive and retention limits](C00_PROTECTED_SOURCE_BACKUP.md)
