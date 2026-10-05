# Timesheet classification implementation decision

## Decision Required
Implement the supplied Type → Activity product plan across existing narrow domain/persistence boundaries without converting historical rows.

## Constraints / decision
- Existing worktree at start b4659f4 was clean. Prior session changes are the current task's unfinished contract/persistence/domain changes, not a completed release.
- Classification taxonomy lives in packages/contracts/src/timesheets.ts; no duplicate mobile definitions, new dependencies, or provider clients in domain.
- Fresh creates must require v2. Persisted entry_type determines edit format; legacy edits remain legacy. New-format duplicates preserve classification; legacy duplicates require a draft/per-row CLASSIFICATION_REQUIRED.
- Additive migrations only; no historical timesheet UPDATE. Eligibility flags may update reserved project reference rows only.
- Lifecycle: deploy additive schema first, then compatible server/clients, activate through a server-owned deployment flag. Config/auth stay usable. Compatibility guards on fresh mutations run inside idempotent execution, after committed replay resolution. Recovery never changes a queued payload under an existing key.
- Completion: full web/mobile forms and mappings, offline manual-review/replacement with durable fresh key, mixed-format reporting/CSV/backup/bundle round trips. No destructive rollback once v2 data exists.

## Evidence
- FACT — lib/domain/timesheets.ts owns authorization/date/hour checks and receives TimesheetPersistence; lib/db/timesheets.ts composes backend adapters.
- FACT — lib/api/v1/contracts.ts maps DTOs; packages/contracts canonical shapes flow into mobile aliases.
- FACT — lib/idempotency.ts resolves portable/local replay before execute; effect fingerprints are SQL-owned for Supabase and portable retry, native request-ledger fingerprints retain legacy request shape.
- FACT — operator bundle implementation is migrations/tool/src/format.ts, not lib/migration/format.ts; operator workspace must stay isolated from application imports.
- FACT — docs/ai-context/CURRENT_STATE.md notes graph baseline 55545e7 is stale. Current targeted source is authoritative. Initial investigation used deterministic focused search; the continuation activated Serena on the assigned worktree and verified the queue/recovery symbols directly.
- UNKNOWN — migrated test database and E2E credentials/deployment status; disclose unavailable checks, do not infer deployed migration state.

## Alternatives
1. Chosen: nullable additive columns and explicit legacy/v2 validators. Smallest path preserving historical identity, joins and contracts.
2. Rejected: backfill/reclassify old rows, infer type by project name, or unify legacy edits with new create validation. Contradicts product baseline.
3. Rejected: client-controlled bypass/format mode. Stored row and trusted restore boundaries remain authoritative.

## Acceptance / closure ledger
C1 taxonomy and branch validation; C2 SQL NULL-safe constraints + both adapters + fingerprint parity; C3 stored-format edits, all fresh-create paths and eligibility; C4 web/mobile drafts, copying and offline recovery; C5 reporting and portability versions; C6 activation gate and existing response envelopes; C7 root/mobile/operator checks, dual builds and available integration/E2E checks.

## Continuation finding ledger (2026-10-05)

- P1 — FACT: Supabase stamped recovery reads immutable effect evidence without serializing an outstanding write transaction (lib/idempotency.ts: runSupabaseStampedDelivery). Missing evidence and a classification/client-update 409 cannot prove an earlier send will not commit. Chosen fix: OfflineQueue.execute may mark a compatibility refusal rejected only when the original persisted state was unattempted or rejected; missing/uncertain state stays uncertain. SyncEngine.reviewLegacyCreate blocks the replacement draft while uncertainty remains. Original payload/key survive restart; successful same-key replay retires the item. Never-sent drafts and first-send definitive refusals retain the atomic fresh-key replacement path. The existing App review handler catches failures into an error toast; SessionProvider refreshes queue state in finally. Verification: focused mobile lifecycle, sync, queue, banner and shell suites pass (61 tests), including both compatibility codes, unknown cached state, restart, first-attempt refusal, atomic replacement, and same-key committed recovery. Remaining limitation: conservative review can remain blocked indefinitely if the server cannot prove the original outcome; no speculative server recovery redesign is included.
- P2 — FACT: the post-replay compatibility guard covered create/update but omitted duplicate_timesheet and batch_duplicate_timesheets. Chosen fix: include both duplicate operations in that guard, preserving committed replay and cookie-browser exemption. Verification: six focused root suites pass (103 tests), including keyed/unkeyed create/update/duplicate/batch-duplicate admission, old-client committed replay, updated bearer admission, cookie exemption and stamped recovery.
- D1 — Correct the architecture delta to the actual additive reporting migrations, 0040_classification_reporting.sql and 20261008000000_classification_reporting_restore.sql, and carry the supplied implementation plan unchanged as this branch's baseline. No migration contents or historical rows change.

Lifecycle decision: activation never turns missing effect evidence into proof of noncommit. First-send compatibility refusal is definitive only when no prior send was uncertain. Unknown cached state is conservative. Recovery retries the original key/payload; only committed replay or definitive noncommit permits progress. Replacement remains serialized with send/recovery and durably swaps the old draft for a validated fresh key. Rejected alternative: release uncertainty on a compatibility 409; this permits a concurrent original transaction and replacement to both commit. UNKNOWN: live transaction/deployment state; leave database/deployment work to the release workflow.


## Continuation verification (2026-10-05)

This continuation ran six focused root suites (103 passed) and five mobile suites (61 passed). New regressions first reproduced P1/P2 on the starting implementation; the repaired suites pass. Scoped root/mobile ESLint and nonincremental root/mobile TypeScript checks pass. The shell regression proves the existing error toast catches blocked recovery and preserves subsequent same-key recovery. No live database, migration, deployment, production build, or Playwright run was performed by this owner. Root retains final build/browser/full-matrix evidence.

## Final integration verification (2026-10-05)

Root independently verified the settled continuation patch:

- Root: 167 suites passed; 2,026 tests passed, 70 environment-gated tests skipped. Coverage gates passed: 78.33% lines, 68.10% branches, 74.98% statements, 81.52% functions.
- Mobile: 58 suites and 432 tests passed. Root/mobile lint and TypeScript passed; mobile lint retains 46 warnings and zero errors. The owner reran affected lint and both TypeScript checks after repairs.
- Migration operator: 449 tests passed, 41 environment-gated tests skipped; lint and TypeScript passed. Operator source was unchanged by this continuation.
- Native production build and Supabase compile-only production build passed on the repaired source. Supabase used CI placeholder settings with SUPABASE_AUTH_CONFIG_CHECK=skip; hosted provider Auth configuration was not verified.
- Activated-flag native mocked Playwright flows passed 41 cases: 39 dashboard/mutation and two report/navigation/accessibility cases.
- Supabase placeholder browser run passed 39 cases and failed two report URL-navigation assertions, with repeated server rendering stream errors. The identical two tests passed on native. These failures remain a Supabase placeholder verification limitation, not a passing Supabase browser suite; no report code or test assertions were weakened.
- Independent closure review found no further material P1/P2 defects. Root inspected snapshot-to-current repair deltas and whitespace checks passed.

Unavailable: migrated live database integration, seeded login E2E, and live Supabase provider verification. No migrations were applied, no historical timesheet rows were converted, and no deployment or commit occurred. The rollout and rollback sequence remains in TIMESHEET_TYPE_ACTIVITY_IMPLEMENTATION_PLAN.md. Admin backfill retains the classified form with Type unselected and hours empty. A previously uncertain queue item stays blocked from replacement until same-key recovery resolves its outcome; compatibility rejection alone never proves noncommit.
