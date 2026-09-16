# Dependency Map

## Intended directions

```text
Web UI ──> client auth/data facades ──> HTTP/actions ──> domain/services ──> Repository
Mobile UI ──> mobile ApiClient ──> /api/v1 ──> domain/services ──> Repository
Repository ──> native adapter ──> pg
Repository ──> Supabase adapter ──> PostgREST/RPC/RLS
```

## High-value edges

- `lib/db/repository.ts:Repository` → implemented by `lib/db/native.ts:nativeRepository` and `lib/db/supabase.ts:supabaseRepository` → selected by `lib/db/index.ts:repo`.
- `app/api/v1/_http.ts` → mobile token/session store + actor resolution → route handler execution.
- `app/api/_http.ts` → auth facade → protected web route execution.
- `app/actions/_shared.ts` → auth facade/actor gates → action implementations.
- `lib/db/pool.ts` → native pool initialization → migration runner.
- `/api/v1` server contracts/services ↔ `mobile/src/api/contracts.ts` / client call sites form a cross-package compatibility edge.

## Cross-cutting changes that require wider retrieval

- Repository method/schema changes: both adapters, migrations, authorization tests, contract callers.
- Auth/session changes: web auth, mobile sessions/tokens, route guards, persistence/RLS, concurrency tests.
- Role/hierarchy changes: profiles schema, role helpers, native SQL scopes, Supabase RLS/RPCs, admin UI/API, mobile people/admin flows.
- API DTO changes: server contract/service/route plus mobile client/contracts and compatibility tests.

Use Understand Anything for these cross-cutting cases after Atlas and Serena have identified the initial symbols/edges.

Evidence: Serena reference lookup for `Repository`, Atlas map, `AGENTS.md`, `docs/architecture/AI_ARCHITECTURE_CONTEXT.md`.
