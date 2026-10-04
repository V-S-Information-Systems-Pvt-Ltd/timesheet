# C00 live inventory — 2026-10-03

> Archived 2026-10-04 as supporting reference. Recorded evidence, contracts and
> unverified limitations retain their scope; this move marks no pending check complete.
> Current work follows the [active plans](../../README.md#active).

## Scope and gate

The operator selected hosted Supabase project `bcsdqkjzobllocejfcdz` as the
source and authorized a fresh native destination in Docker Desktop. The new
database is `vsis_migration_destination_20261003` in `vsis-migration-native`,
published at loopback port 5432. The previously stopped container was started;
the three old databases were preserved. The operator also requested a new hosted
Supabase recovery project in the source organization,
`V S Information Systems (Pvt) Ltd` (`wyemdhldxckcpshqehgu`). That organization
choice is now confirmed. After changing CLI login, the user restored organization
and source-project visibility. Connector tools remain unavailable, but CLI
creation is available. The original timesheet-recovery-20261003 request was
later superseded when the operator selected existing timesheet-test for Supabase
recovery through MIGRATION_DESTINATION settings. Exact name/source distinction,
TLS/database and Auth access passed; authorized cleanup removed its 58 public
baseline rows and independent verification confirmed empty application tables
at that stage. A later acknowledged source-archive restore and independent
snapshot verification matched 57 selected tables / 2,238 rows, 25 function
definitions/permissions, sequence counters and Auth API identity membership.
Docker native remains primary. No hosted project was created.
See [recovery target preparation](C00_TIMESHEET_TEST_RECOVERY.md).

C00 is **PARTIAL / BLOCKED**. This is readiness evidence, not an exported bundle,
preflight PASS, measured rehearsal, provider-fence proof, or cutover approval.
Hosted source queries used repeatable-read, read-only transactions with a
20-second statement timeout. Queries collected counts and metadata; no record
bodies or credentials are recorded here. Separate snapshots are not a frozen
cross-deployment view.

## Source snapshot

Observed at 2026-10-03 11:45:29 UTC, with supplementary metadata at 11:46:25 UTC:

| Table | Exact rows |
| --- | ---: |
| profiles / Auth users | 23 / 23 |
| projects | 43 |
| activity_types / titles | 8 / 7 |
| timesheets | 853 |
| leaves / reminders | 7 / 3 |
| app_settings | 1 |
| global_reminders / dismissals | 1 / 3 |
| whitelisted_domains | 1 |
| audit_logs | 60 |
| mobile_sessions | 81 |
| idempotency_keys / effects | 1 / 40 |
| rate_limits | 3 |
| migration_fresh_keys | 220 |
| migration_write_gate | 1 |
| migration_runs, record_map, identity_journal, record_dispositions, retry_history | 0 each |

There are **1,356 public rows**, including operational state, and **1,010 rows**
in the twelve canonical migration entities. Storage has zero objects at the
snapshot. The database size is 14,437,523 bytes; this is not a backup size or
capacity measurement. All 23 listed public tables have RLS enabled. The source
ledger lists 71 migrations through `20261005000000_migration_fresh_keys`.

Passed aggregate checks: no normalized profile/Auth email collision groups,
profile/Auth identity gaps or email mismatches, normalized reference-name
collision groups, wrong singleton ID, inspected orphan references, deleted-actor
references, legacy-role mismatches, manager cycles or self-manager rows,
unknown nonempty titles, out-of-range hours, hours beyond two decimals, or daily
totals over 24. The two NOT VALID bounded-text checks remain unvalidated, but
their live scans found zero overlength leaves/reminders. No constraint was altered.

## Findings and lifecycle inventory

| ID | Evidence | Interpretation / next action |
| --- | --- | --- |
| C00-01 | Three title/hierarchy mismatches: two profiles use team_lead with an engineer-classified title; one uses engineer with a user-classified title. | Review intended classification before a resolved transfer plan. These are observed differences, not an assertion that every valid role combination must be rejected. No live profile was changed. |
| C00-02 | 54 mobile sessions are unrevoked and unexpired; 220 fresh-key tickets are unexpired. | Include these in the C06B/C07 session/ticket lifecycle matrix. Counts do not establish active devices, in-flight requests, or queued-write counts. Device-local queues remain uninspected while Computer Use is paused. |
| C00-03 | Source and destination write gates both report open; no migration run receipts exist. | A provider freeze has not been performed. C06B still needs complete control selection and live proof. |
| C00-04 | Direct DML grants appear for anon/authenticated on 12 public tables and service_role/postgres on 23; 13 public functions are SECURITY DEFINER. No pg_cron extension or deployed Edge Functions was listed. | Record grants as writer surfaces, not proof of effective anonymous access: RLS/function checks still apply. Auth/admin, privileged SQL, external jobs, ingress, integrations, and established connections remain to be inventoried and drained. Absence of pg_cron/Edge Functions does not prove no external writers exist. |
| C00-05 | Baseline reference names overlap but UUIDs differ, with one project and one activity attribute mismatch. | Use explicit matching/remapping and reviewed merge decisions; fresh schema initialization does not mean an empty reference catalog. See comparison below. |
| C00-06 | Existing timesheet-test identity/TLS/Auth checks, cleanup and later logical source restore pass. Independent verification matches all 57 selected tables / 2,238 rows, 25 function definitions/permissions, counters and Auth API identities. | Availability and selected logical recovery are verified, superseding new-project provisioning. Account usability, platform recovery and retention remain open. Docker native stays primary. See [restore result](C00_SUPABASE_SOURCE_RESTORE.md). |
| C00-07 | Repository `vercel.json` schedules cleanup daily; the inspected cron route/domain chain bypasses the ordinary actor write guard. | Include this potential deployed writer in the provider shutdown/drain proof; deployed scheduler identity remains unknown. See the [writer-control inventory](C00_WRITER_CONTROL_INVENTORY.md). |
| C00-08 | Hosted backup metadata lists no physical backups and PITR disabled. Later approved source capture and logical restore passed. | Durable/off-host retention, recovery access and full account/platform proof remain open; WAL-G alone is not recovery proof. |
| C00-09 | Native baseline archive decrypted and restored with all 24 public tables and inspected schema metadata matching; supported-schema upgrade passed 1/1. | Local mechanism proof only: populated/source recovery, owners/ACLs/roles, off-host retention, actual resource maxima and client/session gates remain open. See [backup and upgrade readiness](C00_BACKUP_AND_UPGRADE_READINESS.md). |
| C00-10 | Operator-supplied Session pooler configuration resolved the IPv6 blocker. Read-only CLI inspect and API-to-database account binding pass; canonical columns and required ledger entries pass. | Database access and binding are verified. No setting values or account bodies were printed or retained in evidence. |
| C00-11 | RESOLVED for source compatibility: exact legacy and post-full_name-retirement Supabase source shapes are supported for source use only. Read-only enforcement, Auth binding, ledger, column compatibility and legacy equality pass. | User authorized skipping full_name and planning retirement. Destination checks remain strict; divergent legacy values and null required rows remain rejected. No live DDL or retirement ran. See the [retirement plan](../PROFILE_FULL_NAME_RETIREMENT_PLAN.md) and [decision packet](../../ai-context/C00_SOURCE_SCHEMA_DRIFT_PACKET.md). |
| C00-12 | Protected source archive and separate role metadata captured after explicit approval; integrity and later scoped logical restore pass. Verified TLS uses the official provider CA. | Selected data/schema recovery passes; password login, platform state and off-host retention/access remain open. Capture-time evidence is retained. See [source backup readiness](C00_PROTECTED_SOURCE_BACKUP.md). |
| C00-13 | Vercel production main reports 1.0.3; architecture preview reports 1.1.2, matching their exact committed source. Both are Supabase. Local dirty files declare 1.1.6; operator accepts 1.0.3, matching production. | Native deployment/release and same-release parity remain unverified; do not broaden admission from checkout version alone. Vercel project lacks native DB/SMTP/base-URL entries in production/preview; verify actual native enrollment separately. See [deployment inventory](C00_VERCEL_DEPLOYMENT_INVENTORY.md). |
| C00-14 | Both supplied aliases are in one Vercel project. Its production cleanup cron is enabled. One sensitive Supabase URL entry covers production/preview with no architecture-branch override; its value is unavailable for comparison. | Bind each running app to its intended database and include the shared project boundary and production scheduler in stop/drain proof. No fence/settings were changed. |

The sole idempotency-key row is claimed, has a response, and is not marked
committed_unknown at this snapshot. This does not prove every client retry has
settled or replace the exported retry-history contract.

## Fresh native destination

The canonical `db/migrate-runner.mjs:runMigrations` applied **37 migrations**.
The complete ledger's names/checksums matched the current repository migration
files. The existing operator `inspect` command verified read-only enforcement,
reported no missing tables, and recorded database identity and schema fingerprint.
No application user was seeded; users, timesheets, leave/reminder rows, audit,
sessions, reset tokens, idempotency keys, fresh keys, and migration receipts are
empty. Migration defaults supplied 45 projects, 5 activities, 6 titles, and the
settings singleton. The container and database remain available for later work.

Read-only comparison of normalized-name, UUID, and selected attribute digests:

| Entity | Shared names | Shared names with different UUIDs | Different selected attributes | Same-entity UUID intersections |
| --- | ---: | ---: | ---: | ---: |
| projects | 41 | 41 | 1 | 0 |
| activity_types | 5 | 5 | 1 | 0 |
| titles | 6 | 6 | 0 | 0 |

Selected attributes are project SO/Telegram numbers, activity active/Telegram
state, and title hierarchy classification. This bounded comparison does not
compare every column or certify bundle/result digests. Destination normalized
reference names have no duplicates; destination profiles and other canonical
UUID entities are empty, so they cannot currently collide with source rows.

## Evidence and verification

- [Source aggregate snapshot](../evidence/c00-supabase-source-2026-10-03.json)
- [Reproducible source integrity SQL](../evidence/c00-supabase-source-integrity.sql)
- [Native read-only CLI inspection](../evidence/c00-native-destination-2026-10-03.json)
- [Reference comparison counts](../evidence/c00-reference-comparison-2026-10-03.json)
- [Native preparation decision packet](../../ai-context/C00_NATIVE_DESTINATION_PACKET.md)
- [Writer-control inventory and local fence proof](C00_WRITER_CONTROL_INVENTORY.md)
- [Prepared hosted recovery request](../evidence/c00-recovery-project-request-2026-10-03.json)
- [Native backup/restore, upgrade and capacity evidence](C00_BACKUP_AND_UPGRADE_READINESS.md)
- [Private source connection evidence](../evidence/c00-source-inspect-2026-10-03.json)
- [Updated source compatibility evidence](../evidence/c00-source-compatibility-2026-10-03.json)
- [Protected source backup capture and remaining recovery gates](C00_PROTECTED_SOURCE_BACKUP.md)
- Existing native provider-fence and V6 integration suites: **11 tests passed,
  one hosted Supabase live test skipped**; disposable fixture cleanup verified,
  and the C00 destination's ledger, gate and table counts were unchanged.
- Existing operator CLI safety suite: **77 tests passed**. This is repository
  evidence, not a replacement for deployment control proof.

## Remaining gates

The operator's existing budgets remain: fewer than 50,000 rows, 10% monthly
growth, 60-minute freeze, 120-minute RPO, 720-minute RTO, and no external files.
The measured source volume now supplies an initial baseline; capacity and
growth-margin rehearsal timings remain unknown.

Still needed: reserved empty Supabase recovery target and usable recovery access;
reviewed hierarchy/reference merge decisions; complete writer ownership and
shutdown/drain/release controls for both deployments; recoverable data/Auth/object
backups and restore proof; retention and observation/access windows;
SMTP/enrollment readiness; and the real client/session/queued-write matrix.
C06B/C07 remain blocked and C08 is not ready. C09/C10 still require separately
named production authorization after their prerequisites.

**Later source inspection:** database access, read-only enforcement, endpoint
binding, API-to-database account binding, required migration ledger entries and
canonical column compatibility are now verified. Source fingerprint support
now passes under the bounded source policy; C00-11 is resolved. The later snapshot has 854 timesheets and
1,011 canonical rows; the earlier 853/1,010 counts above retain their original
observation scope. Maximum observed JSON row size is 1,267 bytes, and the
app_settings row is 462 bytes. These SQL observations do not certify bundle size
or peak capacity. All other remaining deployment/recovery gates still apply.
