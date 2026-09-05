# Master Architecture Remediation Notes

**Branch:** `codex/master-architecture-remediation`
**Baseline:** `3212ba1`
**Started:** 2026-09-06

## Per-Task Execution Status

| Task ID | Description | Status | Verification & Evidence |
|---|---|---|---|
| T18.0 | Incremental contract and authorization characterization | In Progress | Initial timesheet tracer suite |
| T17.0 | Bind mobile bearer identity to Supabase RLS | Pending | Request-scoped Supabase client & token minting |
| T17.1 | Safe production proxy configuration | Pending | Proxy resolver & instrumentation check |
| T17.2 | Password change and session continuity | Pending | Atomic password/session update in Native and Supabase |
| T17.3 | Enforce advertised bearer switch | Pending | Fail-closed gate with 503 response |
| T18.1 | Complete, scoped import totals | Pending | Deduplicated (user, date) query with completeness guarantee |
| T18.2 | Date-scoped report paging | Pending | Date-scoped client and load-more cancellation |
| T18.3 | Same-origin branding image proxy | Pending | SSRF-safe proxy with connection pinning / loopback blocks |
| T18.4 | Shared request-scoped branding getter | Pending | React cache() wrapper |
| T19.1 | Atomic restore with truthful outcomes | Pending | Transactional restore RPC / atomic commit-or-rollback |
| T19.2 | Safe offline replay across both backends | Pending | Idempotency keys, 90-day window, pause on 401/403 |
| T20.1+T21.1 | Durable queue & native storage seam | Pending | Android/iOS/Windows native methods & JS KV store |
| T21.2 | Atomic creates return their row | Pending | RETURNING / insert-select without follow-up queries |
| T22.1 | Shared timesheet rules domain service | Pending | Domain service extraction for timesheet write operations |
| CP23 | Deferred follow-up (decomposition & diagnostics) | Deferred | Post-core release |

## Deviations

*No deviations from the master remediation plan.*
