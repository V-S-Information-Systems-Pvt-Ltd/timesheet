# C06A — Retry, session and recovery contract

> Archived 2026-10-04 as supporting reference. Recorded evidence, contracts and
> unverified limitations retain their scope; this move marks no pending check complete.
> Current work follows the [active plans](../../../docs/README.md#active).

**Status (reconciled 2026-10-03):** PASS for the adopted contract and repository implementation. Source-era identifier-bearing work is translated through server-owned mappings; ambiguous or unprovable legacy work is preserved for manual review. New reference-free creates require server-minted freshness tickets and an updated mobile client. Live client/session proof, provider-wide fencing, and measured recovery remain separate C00/C06B/C07/C08 release gates.
**Depends on:** C01M (reviewed mapping) and the C00 operational inventory.
**Consumers:** C03 (bundle contents), C05 (importer), C06B (fences and publication), C07 (integration/security proof).
The original missing-provenance blocker was resolved by the mapping/manual-review policy in §1a and the fresh-ticket path for newly queued reference-free work. This does not grant legacy queue entries new provenance or authorize migration release.

## Status reconciliation — 2026-10-03

- Current source: `lib/idempotency/portable-retry.ts` implements
  `decidePortablePayload`, payload translation, and refusal of unproven work for
  remapped actors; `lib/idempotency-fresh-key.ts:admitsFreshKey` checks actor,
  operation, expiry, open gate, and fence generation in both backend paths.
- `mobile/src/auth/SessionProvider.tsx:enqueueMutation` consumes tickets only
  when creating a new queued item. Existing queued keys are not retrofitted.
- Focused verification on the current working tree: 35 tests passed across
  `migration-portable-classification`, `migration-retry-history`, and
  `idempotency-fresh-key`; 18 mobile tests passed across `fresh-create-actions`
  and `offline-queue`. No live database or device proof was performed in this
  reconciliation. Historical live evidence remains in the execution ledger.
- C06A's PASS closes the policy/implementation contradiction. It does not close
  C00, C06B, C07, C08, or the retirement gates. The current ledger in
  `SUPABASE_NATIVE_MIGRATION_NOTES.md` owns their evidence and status.

---

## 1. Writers and retry sources (task 1)

| Writer | Where | Retry / durability behaviour today | How it is fenced at cutover |
|---|---|---|---|
| Web Server Actions | `app/actions.ts` → `app/actions/*` | No client retry contract; each call is a fresh mutation | Destination write gate (C06B) + maintenance page; source stays read-only after its freeze |
| Mobile API | `app/api/v1/*` | `withIdempotency` on every mutating route; the client sends its mutation id as `idempotencyKey` | Same gate as Server Actions; the API answers `503` while fenced so devices park rather than drop work |
| Mobile sync engine | `mobile/src/sync/sync-engine.ts` | Stable mutation id per queued item; `MAX_AUTO_RETRIES = 10` then `manual_review`; `OFFLINE_REPLAY_MAX_AGE_DAYS = 90` then `manual_review`; `401/403/429/503` retryable, other `4xx` → `manual_review`; `409` is treated as a conflict, never a silent success | Must see a fenced destination as retryable, never as success; unreachable destination parks the item |
| Idempotency store | `lib/idempotency*.ts`; table `public.idempotency_keys` in **both** tracks (`db/migrations/0026_idempotency_keys.sql`, `supabase/migrations/20260913010000_idempotency_keys.sql`), keyed by `(key, actor_id, operation)`, service-role-only ledger access on Supabase | Committed effect + canonical payload hash; `cleanupIdempotencyKeys(retentionDays = 97)`; lost-response replay returns the committed effect | Retention must not be shortened during the migration window (see §3) |
| Direct Supabase/PostgREST calls | `lib/db/supabase.ts`, any provider SDK held by clients | Provider-level, unaffected by app code | Fenced by revoking provider access for the window (C06B), not by the app |
| Destination Auth admin | `migrations/tool/src/providers/supabase.ts` (port), `migrations/tool/src/identity.ts` | Journaled per identity; cleanup only with run-created journal evidence or the provider's exact run marker before a durable receipt exists | Runs only inside the apply window |
| Signup/profile triggers | Supabase `on auth.users` trigger, `sync_legacy_role` | Fire on every insert/update | Must remain enabled during apply — C04 evidence shows they are the destination's own consistency mechanism |
| Scheduled maintenance | `lib/db/operations.ts` (`cleanupIdempotencyKeys`, session expiry) | Cron-driven | On the architecture branch, the hardened cron route refuses cleanup while the migration gate is fenced. Deployed production 1.0.3 lacks that route-level guard, so the production window still requires an independent Vercel cron/manual-invocation stop or deny plus drain proof. Retention must not be shortened below horizon + grace (97 days). |
| Reminder jobs / integrations | `db/seed.mjs`, reminder tables, any outbound sender | Not part of the merge path | No outbound communication is authorized during preflight, rehearsal or import (C04 task 6) |

**Conclusion:** the mobile/sync path through `withIdempotency` is the retry contract that crosses the cutover. The architecture-branch cleanup route pauses under the final fence; production 1.0.3 still needs provider-level cron denial/drain until that hardening is in the admitted release. The recorded 97-day retention remains the retry-safety invariant.

---

## 1a. Never-committed queued work — adopted rule

A queue item that never reached the source has no history row, so the portable-retry path cannot
resolve it by history. Verified facts (see `migrations/docs/decisions/C06A_QUEUED_WORK_DECISION_PACKET.md`): the
client queue survives logins and carries no namespace, so pre-fence and post-cutover items replay
under the same destination session; the payload surface is small and typed; the actor's provenance is
the destination's own map, not a caller claim.

**Adopted policy: classify the payload by what resolves.**

1. For each id the payload references, look it up as a *source id* in the single namespace this actor
   was imported from (`migration_record_map`, actor-scoped).
2. Every distinct referenced entity/id requires a forward remap, and no such id
   also appears as the destination of another remap → the item is source-era:
   translate the payload through the map and execute it translated.
3. No identifier requires forward translation, and every reference is accounted
   for by the server-owned mapping facts → the item is destination-era and may
   execute unchanged. An unmapped reference is unresolved, not proof of freshness.
4. Anything else — a mix, a collision between remapped source/destination ids, more than one mapped
   namespace for the actor, or an unresolved reference for a remapped actor — is a manual-review outcome with the
   payload preserved. Never guess, never drop.

The caller's namespace is never trusted. Identifier-bearing queued work still
uses the server-owned mapping rule without a client release. Reference-free
creates need a separate freshness proof: the destination mints random,
actor/operation/generation-bound idempotency keys and an updated mobile client
persists one with each newly queued operation. A legacy key is never retrofitted
or blessed on retry; it remains a manual-review outcome. The ticket is issued
only while the destination gate is open and expires after 97 days. A prior
fence generation's ticket cannot authorize a new effect after publication.

**Implementation status:** identifier-bearing classification and translation are
wired in `lib/idempotency/portable-retry.ts`, called by `lib/idempotency.ts`. A reference-free create by a remapped actor
requires a current server-minted key; the mobile queue stores that key only on
a newly enqueued item. Legacy entries still receive manual review. The live
client/session matrix, provider fence and rehearsal remain separate release gates.

## 2. Selected strategy (task 2)

**Portable normalized retry history for outcomes that reached the source, with fail-closed handling for unresolved work.**

The rejected queue-drain strategy still cannot account for offline devices. The implemented artifact preserves source outcomes without credentials or tokens. A client update is required for automatic admission of *new* reference-free work: it consumes a server-minted key at enqueue, never at dispatch. This does not make never-committed legacy work automatically translatable or replace the mapping/manual-review rules above.

Rules:

1. **A key means "the effect this actor already committed", not "any operation with this string".** Histories are identified by verified deployment namespace. Runtime evaluates destination-local and every imported candidate and accepts only one exact fingerprint match; zero matches conflict and multiple exact matches return `409 IDEMPOTENCY_NAMESPACE_AMBIGUOUS`.
2. **Horizon:** the server retains committed effects for **97 days** (`cleanupIdempotencyKeys` default); the client parks at **90 days** (`OFFLINE_REPLAY_MAX_AGE_DAYS`). 97 > 90 with a 7-day grace. **Reconciled 2026-10-03:** the architecture-branch cron route refuses cleanup while fenced; deployed production 1.0.3 requires an independent provider-level cron stop/deny and drain. The retention argument still does not depend on running cleanup during that short window:
   - a mutation the server committed can be at most as old as the device's queue item, and the client refuses to auto-replay anything older than 90 days, so a *committed* effect is always younger than the 97-day retention and its row still exists;
   - a mutation the server never received has no effect row. If it contains a remapped source id, runtime returns 409 rather than guessing; automatic translation remains blocked without source context;
   - therefore the binding constraint is the horizon, not continuous cleanup. **Retention must not be shortened below horizon + grace (97 days) for the duration of the window**; pausing one or more cleanup invocations during the fence cannot invalidate a still-retained effect.
3. **A replay beyond the horizon is never a fresh mutation.** If the key cannot be resolved (no effect row, and no mapping that proves it belonged to the source namespace), the destination answers `409` with a manual-review outcome. It must not execute the mutation as new work — that is precisely how a stale device would duplicate a timesheet.
4. **Absolute expiry keeps its meaning:** an expired key is terminal, not reusable. The destination does not reuse an expired key space for new operations.
5. **Already-committed operations with lost responses** keep exactly today's behaviour: the committed effect is returned to the retry instead of re-executing (`lib/idempotency.ts` lost-response path). The merge does not change that, and the destination's receipt/journal make the migration's own lost responses recoverable the same way.
6. **Devices reconnecting beyond the horizon** land in `manual_review` in the client (already implemented) and are surfaced to an operator; offline work is never silently deleted.

---

## 3. Effects of remapping on retries (task 3)

The merge can reallocate actor ids (a new account receives an allocated id) and resource ids (a UUID collision maps to a new id). Therefore:

1. **Actor mapping.** Imported rows store source and mapped destination actors. Runtime looks up imported candidates only for the authenticated destination actor.
2. **Committed request comparison.** For each source namespace, destination ids in the request are reverse-mapped before comparing the source request/effect fingerprint. This preserves create, update, delete and multi-row `create_leave` semantics.
3. **Never-committed work.** Forward translation is not inferred from matching ids: a source id may equal a legitimate destination id after a collision. A migrated actor presenting a remapped source id receives 409/manual review. Full automatic replay needs explicit authenticated source context from the client and remains blocking.
4. **Equal keys across deployments are not duplicates.** Nothing in the merge treats a key seen in both deployments as the same operation; the namespace plus the reviewed mapping is the only evidence accepted.
5. **Overlapping committed operations** are reconciled against the approved merge decisions: an operation the source already committed that also exists at the destination stays as the destination's record (the reviewed mapping decides), and the replay returns that outcome instead of creating a second row.
6. **Credential- and token-bearing responses are never part of the portable history.** The effect payload keeps its current exclusions; nothing in this contract adds a token, password or recovery link to a stored response.

**Field-matrix impact: additive operational artifact and table.**

- `retry-history.json` contains only namespace, key, source actor, one of the eight queued operations, committed/uncertain outcome, response status, fingerprint kind/hash, optional resource id and creation time. Its size, count and SHA-256 digest are manifest-bound.
- `migration_retry_history` stores those facts with mapped actor/resource ids. Supabase enables RLS and revokes public/anon/authenticated access; runtime reads through the service role.
- Supabase effects are authoritative over a same-key legacy ledger row. Native and remaining legacy rows use the request fingerprint. Uncertain rows never replay as success.
- One **operational** precondition replaces a new record: effect retention must stay at or above the horizon plus grace (97 days) through the window, and the destination must not shorten it. Scheduled cleanup pauses while the migration write gate is fenced and resumes after admission reopens (§2.2).

This closes portable committed/uncertain outcome handling. Never-committed queued work is handled separately by the §1a adopted rule and the fresh-ticket path, which satisfied the C06A PASS criterion; per the 2026-10-03 reconciliation above, C03 and C06A are no longer blocked on this (their live/deployment gates remain under C00/C06B/C07/C08).

---

## 4. Session and write-gate policy (task 4)

1. **Matched destination accounts keep their credentials.** C04 evidence: a matched account signs in with its original destination password before and after the merge. No password is transferred, reset or rotated as part of the migration.
2. **Old tokens must not survive the cutover.** The requirement is a property, not a mechanism: after publication, no credential issued by the *source* deployment may authenticate against the merged destination. Evidence must be produced per direction rather than assumed from a password reset:
   - cross-provider directions (native→Supabase, Supabase→native) sign with different secrets, so a source credential cannot validate — this must still be *proved*, not presumed, by presenting an old token to the destination;
   - a same-provider merge (both directions in the reverse leg) requires the destination to invalidate sessions issued before the merge: refresh-token rotation and the session store's absolute expiry are the mechanisms to use, and the proof is that a pre-cutover refresh token is rejected;
   - a database restore alone never proves this and can revive an old session or version.
3. **Fresh sessions for both populations.** Users and devices sign in again after publication. Mobile refresh tokens (idle 30 days / absolute 90 days) are invalidated by the destination at publication; devices that cannot re-authenticate park their queue and surface `manual_review` rather than losing work.
4. **Temporary isolation of both deployments.** During final planning, apply and verification, both original deployments are fenced: the source is read-only for the merged scope, and the destination is behind its write gate. Neither is published until the destination's gates pass (C06B owns the implementation).
5. **Durable publication-intent / write-gate state machine** — the receipt states already implemented (`lib/migration/import.ts`):

| State | Meaning | Crash behaviour |
|---|---|---|
| `planned` | A run id exists for a reviewed plan | Re-runnable; nothing mutated |
| `resolved` | Decisions applied, expected result computed | Re-runnable |
| `auth-provisioned` | Identities created/adopted and journaled | Resume: adopt what exists, create what does not; never delete a pre-existing account |
| `data-committed` | App-data transaction committed, receipt durable | Re-running reconciles rows, mappings, dispositions and retry history, then persists `verified`; it never applies updates again |
| `verified` | Expected result reconciled against the destination | Failure keeps the destination fenced and reports the diff |
| `publication-intent` | Operator declared the cutover before admitting clients | Durable: after this point the run is not silently reversible |
| `writable` | Destination admitted to clients | Terminal for the run |

A crash between any two states is recoverable by reading the receipt, never by re-running blindly (§2.5).

---

## 5. Rate-limit and in-flight state (task 5)

Rate-limit counters, maintenance flags and provider-side transient state are **not migrated**: they are deployment-local and expire on their own. Offline work is never deleted to clean up state — a mutation that cannot be reconciled goes to `manual_review` with its payload intact, and the operator resolves it after publication. In-flight operations at the moment of freezing are treated exactly like a late retry: the destination answers from the committed effect when one exists, and otherwise parks the request.

---

## 6. Recovery paths (task 6)

**Before publication (either deployment still authoritative):**

- Destination app-data and identities are restored from the verified pre-merge baseline; the pre-merge backup must be *verified* before use (a restore that revives an old session is not a rollback).
- Run-created identities are removed only with this run's journal evidence or the provider's exact `vsis_migration_run_id` marker, and only while no durable receipt exists (implemented in `cleanupRunIdentities`).
- Both original deployments resume with session invalidation as in §4.2.

**After publication, or once retained writes are possible:**

- The merged authority is **exported into a prepared recovery destination of the original provider**, then verified and routed to. For the first Supabase → native direction, existing Supabase project `timesheet-test` is the selected original-provider recovery target and its scoped logical restore/reconciliation has passed. It is currently populated with that verified restored snapshot, so a post-publication rehearsal must explicitly prepare/reset that exact disposable target (or use another identified disposable Supabase target) before reverse migration. Full password usability, platform recovery and durable/off-host retention evidence remain open. The export must include destination-original records and accounts, later updates and deletions, external objects, retries and any repeat enrollment (C07 scope).
- The retained source cannot prove preservation of merged destination data or of writes made after the cutover: it is not an acceptable recovery source.
- If current-authority data is unreadable, it is recovered first; publication never proceeds on the assumption that the source still has it.

**Recorded operational budgets (operator decision):** the final freeze budget is **60 minutes**, with **RPO 120 minutes** and **RTO 720 minutes**. Any post-apply observation period is separate from the freeze budget and must not silently extend the 60-minute writer-fenced window; C08 must measure the operator-visible phases and keep C08 BLOCKED if those declared budgets are missed. Any failing gate before publication rolls back to the verified destination baseline rather than publishing.

---

## 7. Executable V6 cases and affected files (verification)

| Case | What it proves | Where it lands |
|---|---|---|
| A device replays a key committed before the cutover | The committed effect is returned; no second row | `tests/idempotency-stamp-recovery.test.ts`, plus a live case in the C06B slice |
| A device replays a key whose actor was remapped | Mapped-actor lookup plus unique source fingerprint; ambiguous → manual-review | `tests/migration-retry-history.test.ts`; live case still required |
| A device replays a key older than the horizon with no effect row | `409` manual-review, never a fresh mutation | new integration test |
| Same key from two independent deployments | Only one exact candidate can replay; multiple exact candidates reject | `tests/migration-retry-history.test.ts` |
| Pre-cutover refresh token presented after publication | Rejected (per direction, both populations) | extends `tests/migration-roundtrip.int.test.ts` |
| Crash at each publication transition | Receipt-driven recovery, no double apply | C06B slice |
| Cleanup job during the window | The architecture-branch cron route refuses a fenced cleanup invocation before mutation; production 1.0.3 additionally requires provider-level cron/manual-invocation denial and drain. After reopening, normal cleanup preserves effects younger than the horizon and an older unresolved key still resolves to manual review | `tests/mobile-cron-cleanup.test.ts`, `tests/scheduled-maintenance-write-gate.test.ts`, `tests/idempotency*.test.ts` + runbook step |

Current implementation boundaries: `lib/idempotency.ts` and `lib/idempotency/portable-retry.ts` (namespace resolution), `app/api/_http.ts` and `app/api/v1/_http.ts` (fenced responses), and `migrations/tool/src/import.ts` (operator receipt gates). Deployment-wide C06B proof remains open.

---

## 8. Operator inputs — recorded decisions

All five inputs the strategy needed have been decided by the operator and are binding for C05/C06B:

| Input | Recorded decision | Consequence |
|---|---|---|
| Pending mobile writes / maximum device offline period | **The 90-day client horizon is accepted as binding** — no device is expected to auto-replay beyond it | §2 and §3 stand unchanged; the client already parks items at 90 days, and the 97-day retention keeps the 7-day grace |
| Idempotency cleanup during the window | **The architecture-branch cron route pauses cleanup under the final fence; production 1.0.3 requires provider-level cron/manual-invocation denial and drain** (reconciled 2026-10-03) | Keep retention at 97 days; the short pause cannot remove retry evidence. Resume cleanup only after the destination is admitted writable. |
| Reserved recovery destination | **Existing Supabase project `timesheet-test` is the selected original-provider recovery target for the first Supabase → native direction; Docker native remains primary** | Scoped logical restore/reconciliation has passed. The project currently contains that restored snapshot, so C08 post-publication recovery must explicitly prepare/reset this exact disposable target or use another identified disposable Supabase target. Full account/platform recovery and durable retention remain open. |
| Downtime budget and observation window | **Freeze 60 minutes, RPO 120 minutes, RTO 720 minutes** | C08 must measure the operator-visible sequence against these budgets. Any observation period outside the freeze is tracked separately and must not silently expand the 60-minute writer-fenced window. |
| Retention confirmation | **Retention stays at 97 days** | Satisfies the §3 operational precondition |

**Still open, but outside this contract:** SMTP / enrollment-wave readiness. It does not affect the retry, session or publication policy; it gates whether a post-publication re-enrollment wave can be delivered at all, and is tracked with the enrollment work in C07/C09.
