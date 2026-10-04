# C00 source connection verification — 2026-10-03

## Decision and authorization

Use the user-provided, Git-ignored `.env.local` migration settings for source
compatibility and read-only Auth binding checks. The user explicitly requires
that values never be printed. Named `MIGRATION_SOURCE_DB`,
`MIGRATION_SOURCE_AUTH_URL` and `MIGRATION_SOURCE_AUTH_SERVICE_KEY` entries are
present. No application environment fallback or hosted write is needed.

## Evidence and constraints

- `tools/migration/src/connections.ts` validates explicit MIGRATION inputs and
  identifies direct/pooler Supabase project binding. Require both database and
  Auth endpoints to match the already selected source before connecting.
- `tools/migration/src/cli.ts:runInspect` opens a read-only session, probes write
  refusal, collects catalog/count/migration evidence and optionally verifies the
  Auth/database account binding.
- Use the established operator implementation rather than a second inspection
  protocol. Ordinary CLI output can include endpoint display values; capture it
  in memory and emit/persist only an explicit safe evidence allowlist.

## Lifecycle and acceptance

Parse `.env.local` in memory; select only the three named entries. Values are
never put in argv, output, logs, packets or result artifacts. Validate project
binding, run `inspect --json --no-journal` with captured output/errors, then
check source catalog and migration compatibility through existing helpers.
Keep error codes and success/failure booleans, not raw exception messages,
endpoint/connection display strings, Auth account bodies or credentials. Suppress
incidental library console output while running the operation. Close sessions
through the established CLI lifecycle even on failure. Retain `.env.local`
unchanged and remove only the wrapper scratch files.

Pass requires source binding, read-only probe, successful inspection, current
schema/ledger compatibility and verified Auth binding. A connection failure
remains a specific blocker; no credential guessing, SSL validation bypass or
fallback deployment is allowed. Hosted recovery creation still awaits the
separate billing policy choice. This step does not authorize transfer, source
correction, provider fencing, publication or cutover.

## Observed outcome

Explicit source endpoint project bindings match and Auth API read access works.
The configured database endpoint resolves to zero IPv4 addresses and one IPv6
address. Normal driver resolution failed with ENOTFOUND; a TCP probe directly
against the privately resolved IPv6 address returned ENETUNREACH without sending
credentials. The operator was asked to supply the source dashboard's Session
pooler URI in MIGRATION_SOURCE_DB. The operator updated the file, after which
read-only inspection and API-to-database account binding passed. Required ledger
entries and canonical columns pass. The initially unsupported fingerprint is
now supported for source use only under the adopted bounded decision in
[the schema packet](C00_SOURCE_SCHEMA_DRIFT_PACKET.md); [live revalidation](../plans/evidence/c00-source-compatibility-2026-10-03.json)
passes. Retirement is planned separately.
No environment values or account bodies were printed; no source data/schema
changes or TLS-validation bypass occurred.
