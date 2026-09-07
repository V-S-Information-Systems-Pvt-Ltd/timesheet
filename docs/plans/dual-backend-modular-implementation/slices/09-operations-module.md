# 09 Operational workflows use application coordinators

**What to build:** Backup/restore, audit, cleanup, and maintenance operations use explicit application coordinators and domain ports while preserving atomicity, authorization, schemas, and operational response contracts.

**Blocked by:** none, can start immediately.

## Approach

- Characterize backup/restore transactionality, validation, role gates, result counts, audit side effects, cleanup, and failure reporting across both providers.
- Add an operations coordinator that composes affected domain ports; do not force backup/restore into a single-domain repository or shared client package.
- Keep transaction boundaries and bulk persistence provider-specific while making orchestration and result semantics common.
- Route actions and HTTP adapters through the coordinator without changing backup formats or public results.
- Reuse existing logger/audit infrastructure with bounded metadata and secret/body redaction.

## Acceptance criteria

- [ ] Restore is atomic on both providers: validation or write failure leaves no partial imported state and reports no fabricated success counts.
- [ ] Backup format, action/route contracts, authorization, and audit behavior remain backward-compatible.
- [ ] Cleanup and maintenance operations cannot be invoked with ordinary-user credentials.
- [ ] Provider transaction implementations pass equivalent success, validation failure, mid-write failure, and concurrency scenarios.
- [ ] Logs contain operation/backend/result metadata but no tokens, passwords, backup bodies, or unbounded identifiers.

## Verification

```powershell
npx vitest run tests/backup.test.ts tests/backup-restore-route.test.ts tests/supabase-restore.test.ts tests/mobile-admin-operational-routes.test.ts tests/mobile-cron-cleanup.test.ts tests/logger.test.ts
```

Expected: both provider scenarios prove atomic rollback, accurate results, authorization, and redaction; integration cases must not be skipped.

## STOP conditions

- Supabase cannot provide an atomic restore path under the retained schema/RLS/security model.
- A proposed coordinator would weaken per-domain authorization or expose backup data through a general client operation.
