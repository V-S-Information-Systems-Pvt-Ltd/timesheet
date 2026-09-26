# Architecture Decision Request — C06A never-committed queued work

Companion to `docs/plans/C06A_RETRY_SESSION_RECOVERY_CONTRACT.md`, written after C06A was marked
BLOCKED with the reason "never-committed queued-work provenance/translation". It records what is
already implemented, isolates the decision that remains, and proposes the safest default so the
blocking reason can be answered rather than rediscovered.

## Decision Required

After a cutover, a queued mobile mutation whose payload references **source-deployment** record ids
arrives at the destination. The portable-retry path translates those ids when it can resolve the
history (and fails closed when it cannot). The open question is what to do with a queue item that
**never reached the source at all** — there is no history row, and the request carries no explicit
declaration of which deployment its ids came from:

> May the destination translate such a payload's ids through `public.migration_record_map` on the
> strength of the authenticated actor's own provenance, or must it always fall back to manual review?

## Why This Decision Is Needed

- C06A's PASS is withdrawn pending this answer, and C07's release gate depends on C06A.
- The destination must not silently reinterpret ids: translating a payload that was already
  destination-native would corrupt data, and refusing every never-committed item loses offline work.
- The alternative to a decision is the current behaviour (manual review), which is safe but leaves
  the operator with an unbounded queue and no recorded policy for handling it.

## Current Architecture

- `lib/idempotency.ts` resolves imported histories before claiming a destination-local key
  (`readPortableRetryRows(key, actorId, operation)`), remaps a stored payload forward through
  `migration_record_map` (`remapPortablePayload(sourceNamespace, operation, payload)`), and reads the
  actor's own source provenance from the map (`readPortableSourceActors(actorId)`).
- Mappings written by `apply` are the destination's own record of "source id X became destination id
  Y" for a verified deployment namespace (`lib/migration/import.ts`, `writeMappings`), and the
  namespace is recorded per deployment (`computeDatabaseNamespace`).
- Idempotency keys are stable per device mutation; the client parks items at 90 days
  (`OFFLINE_REPLAY_MAX_AGE_DAYS`) and the server retains effects for 97 days.

## Relevant Existing Decisions

- **Never auto-link identities** (C01M/C04): candidates are surfaced for review, never linked.
- **Fail closed on ambiguity** (C06A §2–§3): a key that cannot be resolved becomes a manual-review
  conflict, never a fresh mutation; ambiguous resource translation rejects the replay.
- **No new portable record** (C06A §3): the bundle carries no queue state; translation relies on the
  destination's own map.
- **Read-only by default / explicit operator transitions** (project-wide).

## Constraints

1. The client cannot be upgraded in step with the cutover (C06A's selected strategy exists precisely
   to avoid a client release).
2. A request must not carry a caller-supplied "source namespace": that would be an unauthenticated
   claim and could be used to force translation of ids the caller does not own.
3. Ids may collide across deployments; a collision must never be resolved by guessing.
4. Offline work must not be silently deleted (C06A §5).

## Evidence

### Relevant symbols

- `readPortableRetryRows` — imported histories for (key, actor, operation).
- `remapPortablePayload` — forward translation of a stored payload via the map.
- `readPortableSourceActors(actorId)` — the source namespaces this destination actor was imported
  from, i.e. the only namespaces an actor can legitimately claim.
- `readForwardPortableMappings(sourceNamespace, wanted)` — source-id → destination-id lookups.

### Relevant implementation observations

- The authenticated actor's provenance **is** available server-side: it is the destination's own map,
  not a caller claim, so rule 2 above is satisfied by construction when translation is keyed on it.
- `resolvePortableRetry` returns early — `if (imported.length === 0) return null` — so a
  never-committed item skips `remapPortablePayload` entirely and is handled as a new mutation with
  destination-local semantics. That single guard is the whole difference between the two cases.
- Ambiguity handling already exists and rejects rather than guesses: multiple matching namespaces
  produce `IDEMPOTENCY_NAMESPACE_AMBIGUOUS`, and an unresolvable remapped source id fails closed. The
  remaining question is therefore only *when* translation may be attempted, not what to do when it is
  uncertain.

## Architecture Delta

None yet: this packet records a *pending* decision. If Option A is chosen, the delta is that the
never-committed path joins the same translation and fail-closed rules the committed path already
uses, and no schema changes.

## Known Risks

- **Over-translation:** translating a destination-native payload whose ids happen to appear as source
  ids in the map. Mitigated only by requiring the actor's provenance to include that namespace *and*
  by rejecting when an id exists on both sides.
- **Under-translation:** refusing everything leaves offline work in review indefinitely, with the
  device's queue parked; acceptable only as an explicitly recorded policy.
- **Namespace drift:** if the destination ever maps records from two source deployments, an actor
  imported from one must not have their payloads translated through the other.

## Alternatives

### Option A — Classify the payload by what resolves, then translate or leave alone

For each id the payload references (the payload surface is small and typed:
`create|update|delete_timesheet`, `create|delete_leave`, `create|update|delete_reminder`), look it up
as a **source id** in the single namespace this actor was imported from:

1. **All referenced ids resolve as source ids** (uniquely, and none of them is currently a live
   destination-native row) → the item is source-era: translate through the map.
2. **No referenced id resolves as a source id** → the item is destination-era: proceed untranslated,
   exactly as today.
3. **Anything else** — a mix, a collision with a live destination-native row, more than one mapped
   namespace for the actor, or an unresolvable remapped id → manual review with the payload preserved.

- Pros: decides the mixed-queue case correctly by evidence rather than by trusting a client claim;
  needs no client release and no schema change; the actor's provenance is the destination's own map.
- Cons: classification is per-request work (a handful of indexed lookups), and rule 2 must never be
  reached for a source-era item — which is why a *mixed* payload is review rather than a guess.

### Option B — Keep manual review for every never-committed item

- Pros: zero new translation surface; strictly fail-closed.
- Cons: the operator queue is unbounded and the policy is not recorded; C06A stays blocked in
  practice.

### Option C — Require the client to declare provenance

- Pros: unambiguous.
- Cons: violates the "no client release" constraint and trusts a caller claim; rejected.

## Unresolved Questions

1. **Can a device hold a mixed queue? — YES, verified.** `mobile/src/storage/offline-queue.ts` keeps
   the queue across logins (its whole point: stable mutation ids), and each item is
   `{ id, type, payload, createdAt, retryCount, status }` with no deployment namespace. Items enqueued
   before the fence therefore sit next to items enqueued after the cutover, and both replay under a
   destination session. This is why Option A classifies per payload instead of assuming one era per
   device, and why the packet no longer claims a mixed payload "cannot be produced today".
2. **Does the horizon apply to never-committed items?** The server cannot age them: the request carries
   the mutation id but not the item's `createdAt`. The client still parks items at 90 days
   (`OFFLINE_REPLAY_MAX_AGE_DAYS`), so an old item is unlikely to arrive — but if one does, the
   classification rule does not depend on age, so no server-side horizon check is needed.
3. **Does one destination ever import from more than one source namespace?** Today C00 records one
   direction at a time, so an actor has one namespace. The rule must not rely on that: "more than one
   mapped namespace for this actor" is an explicit manual-review case.

## Scout Synthesis

The implementation side of C06A is substantially present: imported histories resolve, payloads remap,
ambiguity rejects, and remapped source ids fail closed. The blocking question is a policy choice about
one remaining case, not missing machinery — which is why it belongs in an architecture decision rather
than in another implementation round.

The packet's own open questions have now been answered from the code (see above): mixed queues are
real, the payload surface is small and typed, and the actor's provenance is server-side. Those three
facts are what make Option A's classification rule implementable without a client change and without
trusting anything the caller says. The decision left to the owner is therefore narrow: **adopt the
classification rule, or keep manual review for every never-committed item (Option B) and record that
as the policy.**

## Requested Astra Output

Pick one option (or a bounded variant), state the rule in the form the implementation can encode —
specifically the exact conditions under which a never-committed payload may be translated — and name
the tests that would fail if the rule were violated. If the answer is "none of the options", state
which missing fact changes the analysis.
