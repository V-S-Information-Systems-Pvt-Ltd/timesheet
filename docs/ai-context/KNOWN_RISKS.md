# Known Architecture Risks

These are evidence-backed risk areas, not claims of active defects.

| Risk | Evidence | Potential impact | Affected area | Status |
| --- | --- | --- | --- | --- |
| Dual-backend parity drift | One `Repository` contract is implemented by `nativeRepository` and `supabaseRepository`; Serena resolves both implementations | Different behavior/security depending on build mode | persistence/domain | Ongoing architecture risk; no defect asserted here |
| Authorization divergence | Native uses application/SQL scope checks; Supabase also depends on RLS/RPC grants (`AGENTS.md`, adapter structure) | Over- or under-authorized data access | auth/persistence/reporting | Ongoing architecture risk |
| Auth/session concurrency | `lib/auth/native.ts` documents lock ordering around password/session mutation; dedicated integration workflows exist | Deadlock, stale session, or revocation inconsistency if ordering changes | auth/mobile sessions | Controlled by current implementation/tests; re-evaluate on edits |
| Mobile/server contract drift | `/api/v1` server contracts and `mobile/src/api/contracts.ts` live in separate trees with parity tests | Runtime incompatibility between app and server | mobile API | Controlled by contract/parity tests; ongoing risk |
| Migration/deployment state uncertainty | Two migration histories exist; repository files alone do not reveal target DB state | Incorrect assumptions during rollout/debugging | database/deployment | UNKNOWN per environment until migration state is queried |
| Proxy/rate-limit misconfiguration | `lib/ip.ts` explicitly models trusted-proxy behavior | Spoofed/shared client identity can weaken rate limiting | deployment/security | Environment-dependent; verify production topology |
| Context-index drift | `.ua/meta.json` records an analysis commit; live code can diverge later | Stale architectural evidence | agent retrieval | Fresh at pack creation for committed non-`.ua` source; recheck after changes |

Current graph freshness note: at pack creation there were no committed non-`.ua` changes between the Understand Anything metadata commit and HEAD.

Unknowns that require environment-specific evidence: which Supabase migrations are deployed to any particular project, which native migrations are applied to any particular database, and production secret/proxy values.
