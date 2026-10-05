# B04 malformed bulk-ID lookup decision packet

## Decision and constraints

Prevent an unrepresentable database UUID in one bulk-edit row from aborting valid
rows. Preserve opaque domain/public ID strings and documented partial results.
Normalize PostgreSQL-compatible UUID text only at the two database `getByIds`
boundaries, omitting invalid values as unresolved rows. Retain actor/RLS scope,
native indexed UUID comparisons and parameterization. No migration or write,
transport schema, or settled B01/B02/B03 domain change is proposed.

## Verified source and caller map

- Baseline: `cecf635`; earlier continuous-audit changes remain in the worktree.
- FACT: native `getByIds` sends raw IDs to `ANY($1::uuid[])`
  (`lib/db/native/timesheets.ts:187–193`). Supabase sends raw IDs through `.in`
  on its UUID column and throws query errors (`lib/db/supabase/timesheets.ts:277–285`).
- FACT: the structural batch schema accepts nonempty strings, keeping per-row
  validation in the domain (`packages/contracts/src/timesheets.ts:47–57`).
- FACT: Serena references identify `bulkUpdateTimesheetsWork` as the current
  application caller through `TimesheetPersistence.getByIds`; no other application
  caller was found. Existing adapter batch-read tests use opaque stand-in IDs.
- FACT: runtime of the actual exported domain with a canonical UUID and
  `not-a-uuid` reached `getByIds` with both raw values before any schema parse.
  A simulated UUID database cast error escaped instead of a partial result.
- FACT: new adapter regressions fail on raw mixed parameters and all-invalid
  input still reaching database/client initialization; existing scope cases pass.
- INFERENCE: deployed adapters abort valid-row processing on malformed UUID input.
  Live database execution has not been performed.

## PostgreSQL-compatible grammar evidence

[PostgreSQL 16 UUID documentation](https://www.postgresql.org/docs/16/datatype-uuid.html)
describes accepted uppercase, omitted/mixed hyphens and balanced brace forms.
The authoritative [REL_16_STABLE parser](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/utils/adt/uuid.c)
(`string_to_uuid`, lines 77–120) consumes exactly 32 hexadecimal digits with
optional separators after four-digit groups, except after the final group;
optional outer braces must balance and no whitespace or trailing bytes remain.
Output is canonical lowercase 8-4-4-4-12. No UUID version/variant restriction is
part of this database input grammar.

## Approved lifecycle and alternatives

Before native query or Supabase client creation, normalize supported IDs and omit
malformed values. An empty valid list returns `[]` without database/client work.
Otherwise keep the existing actor-scoped lookup and mapped row identifiers.
Domain `not found` errors preserve per-row isolation. Backend/provider failures
for genuine valid queries still throw; no retries or privileged clients are added.

The reviewer approved this database-only protocol. Strict canonical-only checks
would tighten PostgreSQL's accepted forms; whole-payload/domain UUID validation
would tighten opaque contracts; text-column casts would change indexed queries.
These alternatives are rejected. Canonical rows returned for accepted aliases do
not change existing raw-domain key matching: aliases may still yield `not found`
there, and this patch makes no new domain alias-resolution claim.

## Acceptance and ledger

Pure grammar tests cover standard, uppercase, unhyphenated, mixed separators,
balanced braces, incorrect separator positions, lengths, nonhex values, whitespace
and trailing bytes. Adapter tests cover mixed valid/invalid IDs, all-invalid/no-op,
admin/CO versus PM/user scope and provider failures. Actual domain integration with
the real adapter boundary should retain a valid update alongside invalid-ID
`not found`. Existing affected real-adapter fixtures become realistic UUIDs only
within their getByIds tests; unrelated opaque domain fixtures remain unchanged.

| ID | Failure | Repair | Verification | Blocker |
| --- | --- | --- | --- | --- |
| B04 | Invalid database UUID aborts mixed lookup/bulk edit | PostgreSQL-compatible normalization in both getByIds adapters | Runtime reproduced; original adapter suite 9 failures/5 pass; repaired focused suite 108 pass; full matrix below | Independent closure approved; live database unavailable |

The pure parser suite enumerates all 128 optional-separator combinations in both
letter cases with and without balanced braces (512 assertions), plus nil/max UUIDs,
every invalid separator position, malformed lengths/characters and trailing
whitespace/newlines/NUL. Actual-domain tests use each real adapter's lookup with
realistic UUID fixtures and verify valid update plus invalid-ID `not found`.
Only the two existing real-adapter getByIds cases received realistic ID fixtures;
other test identifiers and all domain/public schemas remain unchanged. No live
database integration was run.

Settled verification: root coverage passed with 145 files / 1,683 tests passed
and 13 files / 60 tests skipped. Coverage: 72.65% statements, 64.26% branches,
79.69% functions, 76.10% lines. Root lint, type checking, and both Supabase/native
production builds passed. Builds used placeholder configuration and do not
establish live PostgreSQL/PostgREST behavior. Mobile/shared-client source was
unchanged in this batch; earlier settled mobile verification remains applicable.
