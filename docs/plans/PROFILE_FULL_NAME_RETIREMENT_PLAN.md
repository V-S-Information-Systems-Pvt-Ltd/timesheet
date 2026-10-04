# Retire the legacy profiles.full_name column

Status: **PLANNED; live retirement has not run.** On 2026-10-03 the operator
authorized skipping this field under the migration plans and planning its
retirement. No immediate DROP COLUMN or production cutover is authorized.

## Current decision and evidence

The application uses profiles.name. The portable format omits full_name, and
export projects only canonical columns. Its existing assertLegacyProfileData
guard runs inside the repeatable-read export snapshot and rejects any nonnull
full_name distinct from name with E_LEGACY_PROFILE_DATA. Keep that guard while
the column exists; never silently replace or omit an independent legacy value.

Read-only source observations found one populated legacy value, zero divergent
values, zero public functions/views mentioning the column and zero direct
catalog dependents. These aggregate counts expose no names or setting values.
They do not prove the absence of external SQL, managed-schema code or dormant
clients. [Evidence](evidence/c00-source-compatibility-2026-10-03.json).

The exact observed Supabase source shape and the same shape after full_name
retirement are supported for source use only. Four source columns remain
nullable in storage: profiles.is_active, projects.created_at,
timesheets.work_done and timesheets.created_at. Required portable values still
reject null data. Destination schemas stay strict, unrelated drift is rejected,
and actual fingerprints are preserved.

## Retirement sequence

1. Complete C00 backup/recovery readiness and deployed writer ownership.
   Confirm whether the original Supabase deployment will be retained; whole
   source retirement and column retirement are separate decisions.
2. Capture a protected source data/schema/Auth backup, including the legacy
   value and column definition. Verify original-provider restoration and access
   within the retention window. The native baseline backup is not this backup.
3. Recheck application, function, view, trigger, managed-schema and external
   client dependencies against the deployed release. Record owners and resolve
   dependencies. Recheck exact legacy equality and required canonical values
   under the final writer fence; fail on divergence or null required data.
4. Prepare a new additive Supabase migration through the established deployment
   workflow. Never edit applied migrations. Use restrictive DROP COLUMN without
   CASCADE after the preceding guards; unexpected dependencies must stop it.
   Native has no full_name column, so no corresponding native DROP is needed.
5. Restore the protected source into an isolated Supabase recovery target and
   rehearse the migration. Verify canonical names/counts/digests, Auth binding,
   grants/RLS, profile/role triggers, login and representative timesheet reads
   and writes. Verify the post-retirement source fingerprint and strict
   destination policy.
6. After the relevant observation/recovery gates, obtain named authorization
   for live column retirement. Freeze/drain writers, revalidate guards, apply
   through migration history, verify, then release controls in established order.
7. Record migration identifier, owner, fingerprints, backup/restore evidence,
   checks and observation result. Retain protected backups and historical
   source admission for the agreed recovery horizon.

## Failure and recovery

Dependency/equality failures before DDL leave the column and data unchanged.
Never retry with CASCADE or skipped guards. Transactional DDL failures must roll
back. Later recovery restores the complete approved source state through the
verified original-provider procedure; recreating an empty column is not data
recovery. Bind retries to migration state, revalidate stale evidence and prevent
concurrent deployment/retirement operations.

After the recovery horizon and proof that retained bundles no longer need the
historical variant, separately review its removal and the legacy guard. A single
successful live DROP is insufficient reason to remove historical support.

## Verification completed

Protected source capture now retains the original legacy column/value for
recovery, with verified decryption digests. [Source backup readiness](archive/C00_PROTECTED_SOURCE_BACKUP.md)
records why original-provider restore, retention and live retirement remain open.

Migration package: 343 unit tests pass; lint, type checking and coverage gates
pass. Tests cover legacy/retired source admission, destination rejection,
unrelated drift, preflight/plan compatibility, canonical-name export, legacy
omission and required-null rejection. Existing tests reject divergent or missing
equality evidence. Live read-only inspection, Auth/database binding, migration
ledger, fingerprint support and legacy equality pass.

No live DDL, transfer, fence or retirement ran. Database integration/recovery
rehearsals and application builds were not rerun for this isolated operator
change. C00/C06B/C07 operational gates and C08 readiness remain separate.
