# Master Architecture Remediation Notes

**Branch:** `codex/master-architecture-remediation`
**Baseline:** `3212ba1`
**Started:** 2026-09-06

## Per-Task Execution Status

| Task ID | Description | Status | Verification & Evidence |
|---|---|---|---|
| T18.0 | Incremental contract and authorization characterization | Complete | `tests/parity-tracer.test.ts` (4/4 tests passing) |
| T17.0 | Bind mobile bearer identity to Supabase RLS | Complete | Request-scoped Supabase client & token minting in `lib/auth/supabase.ts` |
| T17.1 | Safe production proxy configuration | Complete | Proxy resolver & instrumentation in `lib/ip.ts` |
| T17.2 | Password change and session continuity | Complete | Atomic password/session update in Native (`changePasswordAndPreserveSession`) and Supabase |
| T17.3 | Enforce advertised bearer switch | Complete | Fail-closed gate with 503 response when bearer auth unsupported |
| T18.1 | Complete, scoped import totals | Complete | Deduplicated (user, date) query with completeness guarantee in `lib/db/` |
| T18.2 | Date-scoped report paging | Complete | Date-scoped client and load-more cancellation in `app/reports/page.tsx` |
| T18.3 | Same-origin branding image proxy | Complete | SSRF-safe proxy with connection pinning / loopback blocks in `lib/branding-proxy.ts` |
| T18.4 | Shared request-scoped branding getter | Complete | React cache() wrapper in `lib/branding-server.ts` |
| T19.1 | Atomic restore with truthful outcomes | Complete | Transactional restore RPC / atomic commit-or-rollback in `db/migrations/0014_restore_backup_tx.sql` & `supabase/migrations/20260906000000_restore_backup_tx.sql` |
| T19.2 | Safe offline replay across both backends | Complete | Idempotency keys, 90-day window, pause on 401/403 in `lib/idempotency.ts` & `mobile/src/sync/sync-engine.ts` |
| T20.1+T21.1 | Durable queue & native storage seam | Complete | Android/iOS/Windows native methods & JS KV store (`mobile/src/platform/kv-store/`, `offline-queue.ts`, `theme-store.ts`) |
| T21.2 | Atomic creates return their row | Complete | RETURNING / insert-select without follow-up queries in `lib/db/` and v1 admin routes |
| T22.1 | Shared timesheet rules domain service | Complete | Domain service extraction for timesheet write operations in `lib/domain/timesheets.ts` |
| CP23 | Deferred follow-up (decomposition & diagnostics) | Deferred | Post-core release |

## Deviations

*No deviations from the master remediation plan.*
