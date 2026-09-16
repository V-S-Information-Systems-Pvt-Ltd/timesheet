# Module Index

Only architecturally important modules are indexed here. Use Atlas/Serena for lower-level navigation.

| Module | Responsibility / important interfaces | Depends on | Main consumers | Constraints | Paths |
| --- | --- | --- | --- | --- | --- |
| Server Actions | Guarded application mutations; public exports in `app/actions.ts`; gates from `_shared.ts` | auth facade, repository/domain helpers | web UI/client components | Preserve public names/signatures and `{ error }` shape; gate every action | `app/actions.ts`, `app/actions/` |
| Web HTTP boundary | Same-origin auth/data API; `originCheck`, `requireSignedIn`, `requireActive` | auth facade, domain/repository | browser data/auth clients | Cookie mutations remain origin-protected | `app/api/_http.ts`, `app/api/auth/`, `app/api/data/` |
| Mobile HTTP boundary | Versioned REST; `requireMobileActor`, `withMobileActor`, response helpers | mobile token/session state, services/domain | React Native `ApiClient` | Bearer-only by default; coordinate DTO changes with mobile | `app/api/v1/` |
| Auth facade | Backend-neutral server identity; native/Supabase implementations | backend selector, cookies/Supabase, profile state | actions, route guards, services | Session validity does not imply authorization | `lib/auth/index.ts`, `lib/auth/` |
| Browser auth/data | Client-safe auth and backend-selected HTTP/data access | backend selector, HTTP endpoints | web UI | Must not import server-only DB/auth modules | `lib/auth/client.ts`, `lib/data/client.ts`, `lib/backend/` |
| Repository contract | `Repository`, `Actor`, `DbWrite`, domain persistence types; `repo` dispatcher | backend selector | actions, API/services/domain | Every shared method must preserve native/Supabase behavior | `lib/db/repository.ts`, `lib/db/index.ts` |
| Native persistence | `nativeRepository`, domain submodules, `query`/`getPool` | `pg`, native migrations | repository dispatcher | Parameterized SQL; explicit auth/scope checks; transaction/lock ordering matters | `lib/db/native.ts`, `lib/db/native/`, `lib/db/pool.ts` |
| Supabase persistence | `supabaseRepository`, domain submodules | Supabase client/PostgREST/RPC, RLS | repository dispatcher | Preserve RLS and grants; scoped read RPCs stay `SECURITY INVOKER` | `lib/db/supabase.ts`, `lib/db/supabase/`, `lib/supabase/` |
| Schema/migrations | Additive schema evolution and bootstrap | PostgreSQL / Supabase | persistence adapters, deployment | Do not rewrite applied migrations; cross-backend changes usually need both tracks | `db/migrations/`, `supabase/migrations/`, `db/migrate-runner.mjs` |
| Mobile client | Session/provider, API client, screens, secure storage, offline queue/sync | `/api/v1`, platform storage | end users/admin flows | Server remains authoritative; refresh tokens use secure storage boundary | `mobile/App.tsx`, `mobile/src/` |
| Deployment/runtime | Vercel/Supabase and native standalone/container deployment | Next build, environment, PostgreSQL/Supabase | operations | Backend selector is build-time; secrets remain server-side | `next.config.ts`, `Dockerfile`, `docker-compose.yml`, `deploy/`, `vercel.json` |

Evidence: repository tree, `README.md`, `AGENTS.md`, Atlas 0.2.1-alpha map, Serena `Repository` references.
