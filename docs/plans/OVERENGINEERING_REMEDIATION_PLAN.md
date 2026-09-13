# Overengineering Remediation Plan

Branch: `codex/master-architecture-remediation`
Goal: shrink the codebase and improve manageability by removing overengineered
code, **without** changing externally observable behavior in either backend mode.

This plan describes possible future cleanup only; it does not authorize edits
or describe the current working tree. Scope reflects four decisions already
made:

1. Idempotency: **remove the Supabase effect-stamp layer, keep the native ledger.**
2. Security code: **simplify `lib/branding-proxy.ts` only** (no other security code touched).
3. Server Actions facade (`app/actions.ts`): **keep as-is.**
4. Docs/plans: **keep all** (this plan is additive).

<!-- UNRESOLVED: Removing the Supabase effect-stamp layer is a product-capability
rollback when DURABLE_IDEMPOTENCY_ENABLED=true, not behavior-preserving cleanup.
Confirm whether preserving durable Supabase offline replay is a current
requirement before implementing Phase 1. -->

## Hard constraints (do not violate)

- **Preserve the existing branch implementation.** Re-read every target
  immediately before editing, and do not assume the working tree matches this
  plan's original review snapshot.
- Both backend modes must still `next build` (CI runs the env matrix).
- Verify after every phase: `npm run typecheck`, targeted `npx vitest run tests/<file>`,
  then full `npm test`.

## Baseline

`npm run typecheck` is **green** at review time (2026-09-11). Establish the same
baseline for `npm test` before starting.

---

## Phase 1 — Remove the Supabase idempotency effect-stamp layer

### Safety preconditions (not yet satisfied)

- The idempotency subsystem is absent from `main`, but that proves only Git
  ancestry. It does not prove that its SQL was never applied to a persistent
  Supabase project. `MASTER_ARCHITECTURE_REMEDIATION_NOTES.md` records live
  validation against the production project, so migration state must be checked
  before any migration file is deleted.
- Supabase durable idempotency is disabled by the repository default, but
  `isDurableIdempotencyEnabled()` returns `true` when
  `DURABLE_IDEMPOTENCY_ENABLED=true`. Inventory every deployed environment before
  treating the effect path as dormant. If any environment advertises the
  capability, Phase 1 changes observable mobile sync behavior and requires an
  explicit product rollback decision.
- Queued sync mutations do carry `Idempotency-Key`; online calls omit it by
  default. Preserve this distinction in tests and acceptance criteria.
- Native uses **ledger-only** semantics (claim + write + commit in one
  transaction) and never touches `idempotency_effects`. The native effect
  migration `db/migrations/0031_idempotency_effects.sql` is an intentional
  **no-op comment**.
- After removal, the 8 stamped operations would fall through to the non-atomic
  Supabase ledger path. That is deliberately less crash-safe and must not be
  described as preserving existing behavior when the capability is enabled.

**STOP:** Do not implement Phase 1 until deployed capability flags and Supabase
migration history are recorded, and the owner confirms whether removing durable
Supabase offline replay is intended.

### 1a. `lib/idempotency.ts` (targeted edits, keep ~430 of 885 lines)

- Remove imports from `@/lib/idempotency-key` and `@/lib/idempotency-effect`
  (`runWithIdempotencyScope`, `isStampedOperation`, the three error classes,
  `canonicalEffectPayload`).
- `claimIdempotencyKey` Supabase branch (~218–224): drop the
  `isStampedOperation(operation)` stale-claim reclaim; a stale Supabase claim
  becomes `committed_unknown` (park for manual review), never auto-reclaimed.
- `cleanupIdempotencyKeys` Supabase branch (~381–391): remove the
  `idempotency_effects` delete block; keep the `idempotency_keys` cleanup. Update
  the retention comment to drop the "Supabase effect retention" clause.
- `IdempotencyOptions`: remove `successStatus` (now dead — native and ledger paths
  commit/replay the real `response.status`; only the removed stamped path
  synthesized a status). Keep `reauthorize`.
- Delete: `STAMPED_SUCCESS_BODY`, interfaces `IdempotencyEffectRow` /
  `LegacyStampedLedgerRow`, `readIdempotencyEffectRow`,
  `computeEffectFingerprintViaAdmin`, `readLegacyStampedLedger`,
  `stampedSuccessResponse`, `completeDuplicateRecovery`,
  `runSupabaseStampedDelivery`.
- Keep: `reauthorizeOrDeny`, `replayResponse`, `busyResponse`,
  `commitUnknownResponse`, `commitLedger` (still used by the Supabase ledger path).
- `withIdempotency`:
  - Native branch — inline the scope wrapper: `return transaction(async () => { … })`.
  - Remove the `if (isStampedOperation(operation)) return runSupabaseStampedDelivery(…)` branch.
  - Supabase ledger branch — inline scope (`const response = await execute()`),
    and remove the `catch` arms for `DuplicateDeliveryError` /
    `UnrecoverableDeliveryError` (only the effect adapters threw them). Keep the
    generic "release on throw if not yet committed" behavior.

### 1b. Delete files

- `lib/idempotency-key.ts` (127 lines) — after 1a and 1d, its only remaining
  consumer is the int-test (1f); the ambient AsyncLocalStorage scope has no
  readers once `getStampScope` is gone.
- `lib/idempotency-effect.ts` (104 lines) — used only by the effect layer.

### 1c. Migrations (branch-only deletes)

- Delete `supabase/migrations/20260920000000_idempotency_effects.sql` (483 lines):
  effects table, `idempotency_effect_fingerprint`, `claim/commit_idempotency_effect`,
  the three AFTER triggers, and `create_leaves_idempotent`.
- Delete `supabase/migrations/20260923000000_idempotency_trigger_nullif_headers.sql` (118 lines).
- Delete `db/migrations/0031_idempotency_effects.sql` (no-op comment; it is the
  last native migration, so no sequence gap; the runner skips already-applied
  files that are removed, so no checksum error).

### 1d. `lib/db/supabase.ts` (already dirty — re-read first)

- Remove imports at lines 38–39 (`getStampScope`, the three error classes,
  `canonicalEffectPayload`).
- Delete the effect-helper block (~131–259): `EffectQueryBuilder`,
  `EffectCapableClient`, `RpcCapableClient`, `IdempotencyEffectRow`,
  `readIdempotencyEffect`, `computeEffectFingerprint`, `effectClient`,
  `withIdempotencyEffectHeaders`, `guardIdempotencyEffect`, `throwIfDuplicateEffect`.
  (`RpcCapableClient` is used only by the deleted effect code; other `.rpc()`
  calls use their own inline typing.)
- Unwrap the 9 write methods to plain writes (drop `getStampScope()`,
  `guardIdempotencyEffect`, `withIdempotencyEffectHeaders`, `throwIfDuplicateEffect`,
  and in `createLeaves` the `if (scope)` `create_leaves_idempotent` RPC branch):
  `createTimesheet`, `updateTimesheet`, `deleteTimesheet`, `createLeaves`,
  `deleteLeave`, `createReminder`, `updateReminder`, `deleteReminder`
  (and the `create_leaves_idempotent` path). Preserve each method's existing
  authz predicates and return shapes exactly.

### 1e. Capability flag + types

- `lib/auth/mobile-config.ts`: simplify `isDurableIdempotencyEnabled()` to
  `return !IS_SUPABASE` and rewrite the doc comment to drop the "immutable-effect
  migration" rationale. This removes the `DURABLE_IDEMPOTENCY_ENABLED` escape
  hatch — with the effect layer gone, Supabase durable idempotency must stay
  fail-closed. Only caller is [app/api/v1/config/route.ts:30](app/api/v1/config/route.ts:30).
- `lib/supabase/database.types.ts`: remove the `idempotency_effects` table type
  block (~267–310). Keep `idempotency_keys`.

### 1f. Tests

- Delete effect-specific recovery cases from
  `tests/idempotency-stamp-recovery.test.ts`, but retain or rewrite Supabase tests
  for the ledger path that remains. In particular, preserve coverage for claim,
  replay, payload conflict, in-flight claims, commit failure, stale
  committed-unknown handling, and authorization before replay.
- `tests/supabase-migrations.test.ts`: remove the effect-migration assertion
  blocks (~350–470: effects table/index/RLS/grants, fingerprint + claim/commit
  functions, triggers, `create_leaves_idempotent`).
- `tests/mobile-config-route.test.ts` (~181–190): change "advertises when
  explicitly enabled" to assert durable idempotency stays `false` in Supabase mode
  even with `DURABLE_IDEMPOTENCY_ENABLED=true`.
- `tests/idempotency.int.test.ts` (~113): drop the `runWithIdempotencyScope`
  wrapper and call `nativeRepository.createTimesheet(actor, input)` directly (the
  test's own comment already notes native needs no effect table). This keeps the
  file compiling after `lib/idempotency-key.ts` is deleted.

### Phase 1 verification

`npm run typecheck`; `npx vitest run tests/idempotency.test.ts tests/supabase-migrations.test.ts tests/mobile-config-route.test.ts`;
grep to confirm zero references to `idempotency_effect`, `getStampScope`,
`canonicalEffectPayload`, `runSupabaseStampedDelivery`; `next build` in **both**
`NEXT_PUBLIC_BACKEND=supabase` and `native`.

**Est. reduction: ~2,900 LOC** (idempotency.ts ~400, two deleted lib files 231,
supabase.ts ~150, migrations 610, database.types ~45, deleted tests 1,339, test trims ~130).

---

## Phase 2 — Simplify `lib/branding-proxy.ts` (already dirty — re-read first)

Replace the hand-rolled `https.request` lifecycle and the custom
`withDeadline` / `remainingTime` / `deadlineFromNow` timeout layer with
`fetch` + `AbortController`. **Keep the SSRF core intact**: `validateSafeUrl`,
`isPrivateIp`, the DNS-pin/IP-blocklist checks, size caps, and content-type
allowlist. Only the single caller
[app/api/branding/logo/route.ts](app/api/branding/logo/route.ts) exercises
`fetchSafeImage`.

<!-- UNRESOLVED: The current 178-line implementation pins the validated address
through https.request's custom lookup. Standard fetch + AbortController exposes
no equivalent lookup hook, and this repository has no direct undici dependency.
As written, this phase cannot preserve DNS pinning. Recommended resolution: cut
Phase 2; alternatively specify and justify a dispatcher/agent implementation and
test that the actual socket connects only to the validated address. The claimed
~200 LOC reduction also exceeds the current file's total size. -->

- Precondition: re-read the current WIP file; confirm which SSRF checks the WIP
  added so none are dropped.
- Trim `tests/branding-fetch.test.ts` and `tests/branding-logo-proxy.test.ts` to
  match the simplified surface while preserving every SSRF assertion (private-IP
  rejection, redirect handling, oversize rejection, bad content-type rejection).

### Phase 2 verification

`npx vitest run tests/branding-fetch.test.ts tests/branding-logo-proxy.test.ts`;
confirm SSRF cases still pass. **Est. reduction: ~200 LOC.**

---

## Phase 3 — Safe dead-code and duplication cleanup

Independent, low-risk items. Do the pure dead-code removals first, verify, then
the dedupes. Skip any dedupe that would alter behavior.

- **Dead code**
  - `lib/db/pool.ts:82` `getActiveTransactionClient()` — zero callers; remove (~3 LOC).
  - `app/actions/_shared.ts:32–37` `releaseWriteRateLimit` — zero callers
    (`withWriteBudget` uses `gate.reservation.release()`); remove and fix the
    stale comment at line 16.
  - Keep `lib/db/migrate.ts`. It is the intentional typed boundary used by the
    migration CLI, pool initialization, and migration tests over the shared
    plain-JS runner; collapsing it conflicts with the repository convention.
- **Duplication**
  - `lib/reports.ts` — the CSV helpers duplicate `lib/reports/csv-export.ts`.
    Import `TIMESHEET_CSV_HEADERS` / `timesheetCsvRows` / `formatTimesheetCsvChunk`
    from the canonical module; keep `sumHours` / `fmtHours` / `selectRows` /
    `exportTimesheetCsv`. `formatTimesheetCsvChunk` at `lib/reports.ts:44` is a dead
    duplicate. Consumers: [app/dashboard/user-whitelist.tsx](app/dashboard/user-whitelist.tsx),
    [app/reports/page.tsx](app/reports/page.tsx).
  - `lib/auth/super-admin.ts` (14 lines) vs `lib/roles.ts:91–99` — collapse the
    duplicate `isSuperAdmin` / `isSuperAdminActor` to one source.
  - `lib/domain/timesheets.ts` — single vs batch paths duplicate logic
    (`duplicateTimesheetEntry` ≈ batch per-item; `deleteTimesheetEntry` ≈ batch
    per-item). Consolidate **only if** behavior is provably identical; otherwise leave.
  - `app/reports/page.tsx` — collapse the 4 near-identical export handlers
    (`exportVisible`/`exportMonth`/`exportLast3`/`exportCustomMonth`) into one
    parameterized helper. Leave `exportLast3Total` (genuinely different).
  - Extract a shared CSV-export helper for the two export routes
    ([app/api/data/reports/export/route.ts](app/api/data/reports/export/route.ts),
    [app/api/v1/reports/export/route.ts](app/api/v1/reports/export/route.ts)).

### Phase 3 verification

Targeted vitest per touched module + `npm run typecheck`. **Est. reduction: ~120–180 LOC.**

---

## Out of scope (explicitly not doing)

- Keep `app/actions.ts` explicit async re-export wrappers (Server Action boundary).
- Do not merge `app/api/auth/*` (web cookie) with `app/api/v1/auth/*` (mobile bearer) — legitimately distinct.
- No changes to change-password / session-revoke semantics or any other security
  code beyond `branding-proxy`.
- No doc pruning.

## Rollout order & final gate

1. Phase 1 → verify (typecheck, targeted tests, both-backend build).
2. Phase 2 → verify.
3. Phase 3 → verify.
4. Final: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:coverage`
   (coverage gates), `next build` in supabase **and** native.

Total estimated reduction: **~3,200–3,300 LOC** plus meaningful complexity removal
(one idempotency path instead of two; `fetch` instead of a hand-rolled socket lifecycle).

<!-- UNRESOLVED: Recalculate this estimate as production LOC, migration LOC, and
test LOC separately. The current total is dominated by deleting regression tests
and includes an infeasible branding estimate, so it is not a useful measure of
maintainability improvement. -->

---

## Review notes (2026-09-11)

Initial scores: Completeness 3/5; Feasibility 2/5; Scope 2/5;
Testability 3/5; Risk 2/5; Assumptions 2/5.

Verified corrections recorded above:

- Current typecheck passes; the prior uncommitted-WIP description was stale.
- Supabase durable replay is configuration-gated, not unconditionally dormant.
- Production-project validation makes the claim that the effect migration was
  never applied unsafe without checking remote migration state.
- The retained Supabase ledger behavior needs dedicated tests; deleting both
  Supabase idempotency suites would remove its principal regression coverage.
- Standard `fetch` cannot retain the current DNS-pin guarantee as proposed.
- `lib/db/migrate.ts` has active callers and is an intentional typed wrapper.

Final review is blocked on the Supabase capability decision. Scope remains 2/5
because the document combines three independently shippable outcomes. Once the
decision is made, split this into separate plans for (1) Supabase idempotency
capability retention or rollback, (2) branding transport only if a pinned-fetch
design is justified, and (3) dead-code/CSV duplication cleanup.
