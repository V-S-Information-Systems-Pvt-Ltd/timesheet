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

### Option A — Provenance-scoped translation, ambiguity still fails closed

Translate a never-committed payload's ids only when (a) the authenticated actor's provenance includes
exactly one source namespace, (b) every referenced id resolves uniquely to that namespace's
destination id, and (c) no referenced id also exists as a live destination-native id. Anything else
goes to manual review with the payload preserved.

- Pros: matches the existing committed-replay semantics; needs no client change and no schema change;
  the actor's provenance is server-side, so no caller claim is trusted.
- Cons: a request that mixes source and destination ids (which a device cannot produce today, because
  it queues either pre-cutover or post-cutover work) still lands in review.

### Option B — Keep manual review for every never-committed item

- Pros: zero new translation surface; strictly fail-closed.
- Cons: the operator queue is unbounded and the policy is not recorded; C06A stays blocked in
  practice.

### Option C — Require the client to declare provenance

- Pros: unambiguous.
- Cons: violates the "no client release" constraint and trusts a caller claim; rejected.

## Unresolved Questions

1. Can a device legitimately hold a queue item that mixes pre-cutover and post-cutover payloads? The
   queue is written before the fence and replayed after, so every item in it was produced against one
   deployment — but this should be confirmed against the sync-engine code before Option A is relied on.
2. Should the horizon (90-day client park, 97-day retention) apply to never-committed items too, i.e.
   is a 120-day-old never-committed item still executable or manual review?
3. Does the destination ever import from more than one source namespace into the same deployment
   (the C00 answer is "one direction at a time", so (a) in Option A holds today)?

## Scout Synthesis

The implementation side of C06A is substantially present: imported histories resolve, payloads remap,
ambiguity rejects, and remapped source ids fail closed. The blocking question is a policy choice about
one remaining case, not missing machinery — which is why it belongs in an architecture decision rather
than in another implementation round.

## Requested Astra Output

Pick one option (or a bounded variant), state the rule in the form the implementation can encode —
specifically the exact conditions under which a never-committed payload may be translated — and name
the tests that would fail if the rule were violated. If the answer is "none of the options", state
which missing fact changes the analysis.
