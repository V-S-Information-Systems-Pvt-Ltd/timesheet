# Architecture Decision Request — Phase 4 evidence inventory

## Decision Required

What is the smallest safe, non-mutating operator interface that can inventory each deployment's
Phase 4 R1 evidence—declared capabilities and supported clients plus database-observed imported
history, write-gate state, and issued fresh-key tickets—without implying that C09/C10, R1, R2, or
R3 has passed or authorizing retirement?

## Why This Decision Is Needed

Phase 3 is complete in source. The first open simplification item is the deployment inventory
required before any compatibility or provider retirement decision. Repository inspection cannot
answer deployment facts, and destructive retirement is explicitly unauthorized. The next slice
must therefore collect reproducible evidence while remaining read-only and fail-closed.

Acceptance criteria:

- operator-only code remains in `migrations/tool` and is unreachable from application runtime;
- connection material is read only from an explicitly named `MIGRATION_*` environment variable;
- database access uses the existing read-only migration session;
- output contains aggregate evidence, no record bodies, credentials, ticket keys, actor IDs,
  source IDs, destination IDs, email addresses, or other personal data;
- operator-declared capabilities/clients are schema-validated and preserve `unknown` explicitly;
- missing expected relations or unreadable evidence is a blocker, never interpreted as zero;
- the artifact is canonical, digest-bound, exclusively created, and identifies capture time,
  deployment, provider, and database identity;
- the command performs no write, cleanup, fence transition, cutover, or retirement decision.

Non-goals: C08 rehearsal, C09 cutover, C10 handoff, R1 policy adoption, reverse-recovery redesign,
provider deletion, schema teardown, or changing request-time compatibility.

## Current Architecture

- `npm run migration` enters `migrations/tool/src/cli-entry.ts`; `migrations/tool/src/cli.ts` is
  the operator composition root.
- `openReadOnlySession` in `migrations/tool/src/providers/session.ts` provides the existing
  explicit-provider, explicit-env, read-only database boundary and verified database identity.
- Runtime old-request handling remains in `lib/idempotency/portable-retry.ts`; fresh-key issuance,
  admission, and expiry cleanup remain in `lib/idempotency-fresh-key.ts`.
- Durable evidence is stored in `migration_runs`, `migration_record_map`,
  `migration_record_dispositions`, `migration_retry_history`, `migration_fresh_keys`, and
  `migration_write_gate`. Applied native migrations remain immutable.

## Relevant Existing Decisions

- `docs/ai-context/ADR_NATIVE_DESTINATION.md`: native survives, but no cutover or retirement is
  authorized; Supabase remains supported until separate gates pass.
- `docs/plans/ARCHITECTURE_SIMPLIFICATION_PLAN.md`, Phase 4: R1–R3 are separate evidence gates;
  C09/C10 and a deployment-specific retirement plan are prerequisites for irreversible changes.
- `migrations/docs/SUPABASE_NATIVE_MIGRATION_NOTES.md`: C00 is blocked on live inventory; C09/C10 are
  not started and require explicit production authorization.

## Constraints

- Do not mutate either provider or application state.
- Do not infer live deployment state from repository migrations.
- Do not expose secrets, identifiers, ticket values, or record bodies in artifacts or logs.
- Preserve provider support, portable retry, ticket admission, fencing, migration tools, and both
  build paths until their own gates pass.
- Keep application code unable to import the private migration package.
- Missing/older schema must be represented as blocked/unresolved evidence, not an empty inventory.

## Evidence

### Repository map evidence

- Atlas (`atlas . --budget 2048 --focus migrations/tool`, 2026-09-27) identifies
  `migrations/tool/src/cli.ts` as the composition root, `providers/session.ts` as the database
  session boundary, and `format.ts` as the shared canonical JSON/digest implementation.

### Relevant symbols

- `lib/idempotency-fresh-key.ts: issueFreshKeys` — persists every issued key with actor,
  operation, gate generation, and 97-day expiry in `migration_fresh_keys`.
- `lib/idempotency-fresh-key.ts: admitsFreshKey` — admits only an unexpired ticket matching the
  current open gate generation.
- `lib/idempotency-fresh-key.ts: cleanupExpiredFreshKeys` — removes expired tickets; therefore an
  inventory must distinguish missing evidence from a true zero and capture the observation time.
- `app/api/v1/idempotency-tickets/route.ts: POST` — issuance is a supported bearer operation and
  can mint 1–20 tickets per request after the normal write budget.
- `migrations/tool/src/cli.ts: runCli` — dispatches operator commands and already supports
  exclusive artifact output and redacted JSON/journals.

### Relevant implementation observations

- `FACT` — fresh tickets are database rows, so unexpired and generation-matching counts/expiry
  bounds can be observed without exposing ticket values (`lib/idempotency-fresh-key.ts`).
- `FACT` — imported mappings, dispositions, and retry outcomes are durable database tables created
  by native migrations 0032/0034/0035 and paired Supabase migrations.
- `FACT` — the existing CLI never falls back to `DATABASE_URL`; connection material comes from an
  explicitly named migration environment variable (`migrations/tool/src/cli.ts`).
- `FACT` — C00, C09, and C10 remain blocked/not started; no production migration or retirement is
  authorized (`migrations/docs/SUPABASE_NATIVE_MIGRATION_NOTES.md`).
- `INFERENCE` — repository configuration cannot establish which clients are supported or serving,
  so those facts require a validated operator manifest rather than auto-detection.
- `INFERENCE` — aggregate counts grouped by run/state/namespace/entity/operation/action plus time
  bounds are sufficient for inventory and avoid exporting sensitive identifiers.
- `UNKNOWN` — the number and identity of actual deployments, serving clients, writers, jobs, and
  integrations; the operator must supply one manifest and run one capture per deployment.
- `UNKNOWN` — whether every deployment has the latest evidence relations. A missing relation must
  block the capture rather than report zero.

## Architecture Delta

Phases 1–3 are complete on `arch/architecture-simplification`; Phase 3 changes are uncommitted on
top of `d9f8b80`. No Phase 4 runtime, schema, provider, or deployment change exists yet.

## Known Risks

- Deployment-state uncertainty: repository migration files do not prove deployed schema/state.
- Ticket undercount: cleanup legitimately removes expired rows, while missing relations/read
  failures can look like empty state unless distinguished explicitly.
- False authorization: a convenient `ready: true` result could be mistaken for permission to
  retire compatibility or Supabase despite unresolved R2/R3 and C09/C10.
- Evidence leakage: identifiers or ticket values in an operator artifact would create a new secret
  and personal-data handling burden.

## Alternatives

### Option A — Versioned operator manifest plus read-only, digest-bound database artifact

Add `migration retirement-inventory` in `migrations/tool`. Require a schema-validated deployment
manifest for declared capabilities/clients and an explicit provider/env connection. Read aggregate
database evidence in one read-only transaction, produce an exclusive canonical artifact with a
digest and unresolved-evidence list, and make no readiness/retirement decision.

Benefits: reproducible, reviewable, no application dependency, preserves unknowns and separates
facts from authorization. Costs: operators must maintain one manifest per deployment and rerun it
for fresh evidence. Rollback: remove the additive command/module; no persisted state changed.

### Option B — Database-only auto-detection

Read only migration tables and environment flags. Simpler, but cannot establish serving traffic,
supported client versions, queue ownership, writers, or actual deployment configuration. It risks
turning missing human evidence into false confidence.

### Option C — Documentation checklist only

Record evidence manually in the retirement plan. Lowest code cost, but weak reproducibility,
schema validation, redaction, database identity binding, and drift detection.

## Unresolved Questions

- Which exact manifest fields are mandatory now versus deferred to R2/R3?
- Should missing evidence relations fail the command or emit a completed artifact containing a
  blocker? The current recommendation is fail with the CLI blocked exit code and no final artifact.
- Should the artifact include per-run identifiers? The current recommendation is no; use counts
  grouped by non-sensitive state/entity/operation and digests where correlation is necessary.

## Scout Synthesis

- `FACT` — the private migration package already owns provider connections, canonical formatting,
  redaction, and exclusive output (`migrations/tool/src/*`).
- `FACT` — the application/runtime boundary test forbids imports from the operator package.
- `FACT` — fresh keys and imported retry/provenance facts are queryable durable rows.
- `INFERENCE` — Option A is the only alternative that combines live database evidence with
  explicit client/capability declarations while preserving the no-retirement authorization line.
- `UNKNOWN` — live deployment count and manifests remain operator inputs and cannot be completed
  by source implementation.

## Requested Astra Output

Evaluate only the supplied evidence and provide:

1. recommended architecture for this read-only inventory slice;
2. the minimum versioned manifest and artifact fields;
3. safe aggregate queries/evidence categories and redaction boundaries;
4. failure semantics for missing/unreadable relations and stale declarations;
5. rejected alternatives and why;
6. architecture, security, and operational risks;
7. migration/rollback and compatibility implications;
8. required tests and follow-up validation;
9. explicit assumptions/unresolved questions and a concise ADR suggestion.

## Decision

Accepted 2026-09-27 after Astra/high review: implement Option A as an operator-only,
read-only `retirement-inventory` command. The command must use a strict versioned declaration,
one repeatable-read snapshot, fixed aggregate queries, complete-visibility checks, canonical
digest-bound exclusive output, and explicit unresolved codes. It must not invoke the existing DDL
read-only probe, expose identifiers or free-form database values, calculate readiness, or mutate a
gate/provider/schema. Retained fresh-key rows are evidence of issued tickets only, never proof of
pending or consumed work. Capture success remains distinct from R1–R3 and C08–C10 acceptance.
