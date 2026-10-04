# Architecture Decision Request — C00 source schema drift

## Decision Required

Resolve how the operator may narrowly support the observed Supabase schema while
retaining existing legacy-name equivalence and canonical data validation guards,
without silently widening fingerprint admission or changing live source data.

## Why This Decision Is Needed

The authorized read-only C00 inspection succeeds, but the supported provider
fingerprint rejects the source. Export/apply remains blocked. The user requires
that .env.local values never be printed. No live schema modification, transfer,
fence or cutover is authorized by this packet.

## Current Architecture and Relevant Existing Decisions

- tools/migration/src/format.ts: ENTITY_SPECS defines canonical row contracts;
  entitySpec supplies required types/nullability. Profiles have no full_name.
- tools/migration/src/schema.ts: fingerprintLines includes unexplained extra
  entity columns and actual nullability. EXCLUDED_LIVE_COLUMNS excludes only
  known provider compatibility fields. isSupportedSchemaFingerprint accepts
  the provider's precise expected fingerprint.
- checkEntitySchemaCompatibility permits a more nullable source storage column
  while the fingerprint still records that difference. Passing column checks
  alone does not certify source schema support.
- tools/migration/src/cli.ts: runInspect uses the dedicated read-only connector;
  preflight independently checks supported source and target fingerprints.
- tools/migration/src/providers/supabase.ts: verifyAuthDatabaseConsistency binds
  an Auth API account to the same account in auth.users.
- tools/migration/src/export.ts: assertLegacyProfileData already rejects any
  nonnull full_name distinct from name with E_LEGACY_PROFILE_DATA. The export
  path invokes it when the legacy column exists; no new preservation protocol
  should be invented for data already represented by the canonical name.
- [Implementation plan](../plans/SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN.md)
  requires explicit transformations/dispositions and fail-closed schema checks.

## Evidence

FACT — Current source read-only enforcement and API/database binding pass.
Seventy-one applied migrations include all required operator ledger entries;
no canonical tables or incompatible required columns were reported.

FACT — Actual source fingerprint is
486a9ab877a2c48e5de8b15e9f26a981f58ddc188c25b9c129c31f721763e94b.
It is not an accepted Supabase fingerprint. Column differences:

| Column | Difference | Aggregate data observation |
| --- | --- | --- |
| profiles.full_name | Extra nullable text column | One nonblank populated row; zero values distinct from name |
| profiles.is_active | Nullable bool instead of required bool | Zero null rows |
| projects.created_at | Nullable timestamptz instead of required timestamptz | Zero null rows |
| timesheets.work_done | Nullable text instead of required text | Zero null rows |
| timesheets.created_at | Nullable timestamptz instead of required timestamptz | Zero null rows |

FACT — None of these values or account bodies was printed. The source remains
live: the later observation has 854 timesheets versus the earlier 853. Zero null
counts are observations, not durable constraints or final fenced-snapshot proof.

FACT — A bounded search of app, lib, mobile/src and mobile/App.tsx found no
full_name references. Application profiles use name. The existing operator
guard checks exact value equivalence, not merely whether the legacy field is
populated. The one populated value matches name at this snapshot.

INFERENCE — No independent legacy name needs a new canonical field for the
current source data. Future divergence remains possible and must be rejected
inside the established export snapshot. The earlier preservation choice is
superseded by this narrower evidence, not by permission to lose source values.

## Constraints and Alternatives

A: Add a narrowly supported source schema variant, retaining the established
legacy-name equivalence check and canonical nonnull row validation. Validate
exact catalog shape; unrelated extra fields and null required row values remain
failures. Consider source-versus-target admission separately. No live source
change or new application field is needed for duplicate legacy names.

B: Add explicit versioned preservation support if independent legacy names must
be carried in a future source. Requires format and cross-backend compatibility
analysis, additive destination schema changes and round-trip tests. Current
aggregate equivalence does not justify this added scope by itself.

C: Correct the live source schema through a separately authorized reviewed
migration. Four NOT NULL changes alone do not resolve the populated extra field;
they need race-safe validation and fail-closed rollback. Applied migrations must
not be edited. Live source corrections are outside current read-only scope.

## Lifecycle and Acceptance Checks

Before implementation, resolve preservation and schema admission together.
Cover populated, empty and null legacy names; a new null canonical value after
inventory; unexpected extra columns; stale fingerprints and plans; cancellation
and retries; final fenced revalidation; partial apply and original-provider
recovery. Keep credentials/settings out of logs and evidence. Never disable TLS
verification or use application database fallback.

Acceptance requires no silent field omission, narrowly supported provider
schema fingerprints, success/failure regression coverage, unchanged unrelated
source/destination state and existing format/identity/preflight protections.
Recovery project billing, full writer controls and client/session gates remain
independent blockers; resolving this packet alone does not make C08 ready.

## Verification and Architecture Delta

Evidence: [source inspection](../plans/evidence/c00-source-inspect-2026-10-03.json).
The implemented delta registers exact source-only fingerprints in schema.ts and
selects source admission in CLI export, preflight and plan. The row format,
canonical projection, legacy equality guard and destination policy are unchanged.
The migration package passed 343 unit tests, lint, type checking and coverage
gates (80.66% statements, 70.28% branches, 81.42% functions, 82.14% lines).
[Live revalidation](../plans/evidence/c00-source-compatibility-2026-10-03.json)
passes without source writes. Database integration/recovery rehearsals and
application builds were not rerun for this isolated operator change. Future
material persistence/format changes use the bounded ASTRA_ARCHITECT.md process.

## Adopted decision — 2026-10-03

The user explicitly instructed: skip profiles.full_name under the migration
plans and plan its retirement. Adopt option A under the existing protocol;
do not introduce a new canonical field or change the versioned row format.
Keep the legacy equivalence guard inside the repeatable-read export snapshot.
Register the exact observed Supabase source catalog and its post-retirement
shape (the same four nullable columns, full_name absent) as source-only
fingerprints. Keep existing destination admission unchanged and reject all
other catalog drift. Nullable storage does not authorize null required values;
existing canonical row validation remains mandatory.

This is a bounded compatibility repair under the user's disposition decision,
not a new identity, persistence or recovery protocol. No live DDL is needed.
Retirement is a later additive migration after protected backup/restore,
fenced equivalence/dependency revalidation, observation and explicit execution
authorization. Pending billing and deployment controls remain separate gates.
