# Supabase retirement evidence plan

Status: **evidence preparation only — no retirement authorized**

This plan implements the first safe Phase 4 mechanism: a read-only inventory that combines an
operator declaration with aggregate database evidence. It does not establish R1, R2, or R3; it
does not authorize C08, C09, C10, cutover, cleanup, source shutdown, schema teardown, or deletion.

## Evidence command

Run once for every deployment with an explicit provider and an explicitly named `MIGRATION_*`
connection variable:

```powershell
$env:MIGRATION_RETIREMENT_DATABASE_URL = '<operator read-only PostgreSQL URL>'
npm run migration -- retirement-inventory `
  --target native `
  --target-env MIGRATION_RETIREMENT_DATABASE_URL `
  --manifest .\retirement-declaration.json `
  --out .\retirement-evidence.json `
  --json
```

Use `--target supabase` for a Supabase deployment. The command never falls back to
`DATABASE_URL`, application configuration, or provider SDK credentials. The output path is
exclusive and is never overwritten.

The database role must prove complete visibility of all required migration evidence tables.
Missing relations/columns, RLS-filtered visibility, identity mismatch, an invalid gate, unreadable
evidence, or unsupported grouped values fail blocked with no completed artifact.

## Declaration template

All objects are strict: unknown properties are rejected. Use `unknown` rather than guessing.
An empty client list is accepted only when `noKnownClients` is explicitly true.

```json
{
  "format": "vsis-retirement-inventory-declaration",
  "formatVersion": 1,
  "deployment": {
    "label": "production-native",
    "environment": "production",
    "provider": "native",
    "applicationRelease": "unknown",
    "expectedNamespace": "unknown"
  },
  "provenance": {
    "declaredAt": "2026-09-27T00:00:00.000Z",
    "validUntil": "2026-10-04T00:00:00.000Z",
    "evidenceRef": "change:replace-with-approved-reference",
    "toolRevision": "unknown",
    "toolDirtyState": "unknown"
  },
  "capabilities": {
    "backendSelection": "native",
    "durableIdempotency": "unknown",
    "mobileBearerAuth": "unknown",
    "portableRetry": "unknown",
    "freshTicketIssuance": "unknown"
  },
  "clientInventory": {
    "state": "unknown",
    "noKnownClients": true,
    "clients": []
  },
  "queueConsumers": {
    "status": "unknown",
    "policy": "unknown"
  }
}
```

Client entries, when present, declare `family`, `version`, `environment`, `support`, `transport`,
`queuedWrites`, and `consumesFreshTickets`. Allowed transport values are `cookie-v1`, `bearer-v1`,
`legacy-http`, `server-action`, `provider-sdk`, and `unknown`.

## Artifact semantics

The artifact is canonical JSON with a SHA-256 digest over every field except `artifactDigest`.
It records:

- declaration value and digest, capture start/snapshot/completion times;
- provider, durable namespace binding, applied-migration identifiers/digest, and evidence visibility;
- aggregate migration runs, mappings, dispositions, imported retry history, write-gate state, and
  retained issued-ticket counts grouped by allowlisted categories;
- unresolved declaration/evidence codes and fixed limitations.

It never contains run IDs, source namespaces, actor/resource IDs, ticket keys, payload fingerprints,
record bodies, operator names, database endpoints, credentials, or free-form database values.

`retainedIssuedTickets` is deliberately not called outstanding work. An unexpired current-generation
ticket proves only that its database row met those conditions at the snapshot time. Zero retained
rows does not prove there are no offline queues, cleaned-up expired tickets, or future issuance.

Exit code `0` means only that the capture completed without declared evidence gaps. Exit code `5`
means the capture is blocked or contains unresolved declarations. Neither result is an R1–R3 pass.

## Gate ledger

| Gate | Current status | Evidence still required |
| --- | --- | --- |
| R1 runtime compatibility | NOT ASSESSED | Run a current capture for every deployment; reconcile supported clients, offline queues, retained tickets, imported histories, late retries, committed native replay, and future issuance policy. |
| R2 recovery/provenance | NOT ASSESSED | Retain and verify the reverse-migration tool/provenance or accept and test a replacement meeting the approved RTO/RPO. |
| R3 provider/source retirement | NOT ASSESSED | Complete C09/C10, prove traffic/writer absence over the approved observation window, satisfy retention obligations, and obtain separate irreversible-retirement authorization. |

## Per-deployment execution checklist

- [ ] Identify the deployment and expected durable namespace independently.
- [ ] Record effective build/runtime capabilities, not repository defaults.
- [ ] Inventory supported production, development, test, API, and integration clients.
- [ ] Record queue and fresh-ticket consumers and the supported replay policy.
- [ ] Use a restricted evidence directory and a fresh exclusive output name.
- [ ] Run the command with a role that can prove complete evidence visibility.
- [ ] Verify the artifact digest and review every unresolved code.
- [ ] Store the declaration, artifact, command revision, and reviewer decision together.
- [ ] Repeat after material deployment/client/configuration changes or declaration expiry.

No deployment capture has been performed by this source implementation. The repository currently
has no local Docker CLI/direct Supabase PostgreSQL URL available for a live proof of this command.
