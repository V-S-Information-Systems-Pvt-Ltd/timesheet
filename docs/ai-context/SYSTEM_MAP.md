# System Map

```mermaid
flowchart LR
  Web[Next.js browser UI] --> WebAuth[lib/auth/client.ts]
  Web --> DataClient[lib/data/client.ts]
  Web --> Actions[Server Actions]
  DataClient --> WebAPI[app/api/data + app/api/auth]
  Actions --> AuthFacade[lib/auth/index.ts]
  WebAPI --> WebGuard[app/api/_http.ts]
  WebGuard --> AuthFacade

  Mobile[React Native mobile] --> V1[/api/v1]
  V1 --> MobileGuard[app/api/v1/_http.ts]
  MobileGuard --> MobileSession[mobile token/session validation]

  Actions --> Repo[Repository contract]
  WebAPI --> Repo
  V1 --> Services[lib/api/v1 services/domain]
  Services --> Repo

  Repo --> Select{NEXT_PUBLIC_BACKEND}
  Select --> Native[nativeRepository]
  Select --> Supabase[supabaseRepository]
  Native --> PG[(Self-hosted PostgreSQL)]
  Supabase --> RLS[Supabase client + RLS/RPC]
  RLS --> SPG[(Supabase PostgreSQL)]
```

## Important flow checks

- Web state-changing cookie requests pass `originCheck` before protected work.
- Mobile protected routes validate the bearer token against stored mobile-session state and actor state before business logic.
- Persistence goes through `Repository`; pages/actions/routes should not open backend clients directly for application features.
- Backend-specific authorization must remain behaviorally equivalent even though enforcement mechanisms differ.

Evidence: `app/api/_http.ts`, `app/api/v1/_http.ts`, `lib/db/index.ts`, `lib/db/repository.ts`, `docs/architecture/AI_ARCHITECTURE_CONTEXT.md`.
