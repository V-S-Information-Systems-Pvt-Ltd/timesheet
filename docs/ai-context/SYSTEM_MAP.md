# System Map

```mermaid
flowchart LR
  Web[Next.js browser UI] --> WebAuth[lib/auth/client.ts]
  Web --> DataClient[lib/data/client.ts]
  Web --> Actions[Server Actions]
  DataClient --> V1Browser[/api/v1/timesheets cookie path]
  DataClient -. compatibility .-> WebAPI[app/api/data]
  Actions --> AuthFacade[lib/auth/index.ts]
  WebAPI --> WebGuard[app/api/_http.ts]
  WebGuard --> AuthFacade

  Mobile[React Native mobile] --> SharedClient[@vsis/client + contracts]
  SharedClient --> V1[/api/v1]
  V1Browser --> V1
  V1 --> MobileGuard[app/api/v1/_http.ts]
  MobileGuard --> MobileSession[mobile token/session validation]

  Actions --> Repo[Repository contract]
  WebAPI --> CompatDomains[domain modules]
  V1 --> Services[lib/api/v1 services/domain]
  V1Browser --> Services
  Actions --> Domain[Timesheet domain/services]
  Services --> Domain
  Domain --> Port[TimesheetPersistence]

  Repo --> Select{NEXT_PUBLIC_BACKEND}
  Port --> Select
  Select --> Native[native adapter]
  Select --> Supabase[Supabase adapter]
  Native --> PG[(Self-hosted PostgreSQL)]
  Supabase --> RLS[Supabase client + RLS/RPC]
  RLS --> SPG[(Supabase PostgreSQL)]
```

## Important flow checks

- Web state-changing cookie requests pass `originCheck` before protected work.
- Mobile protected routes validate the bearer token against stored mobile-session state and actor state before business logic.
- Persistence goes through `Repository` or a narrow domain port; pages/actions/routes should not open backend clients directly for application features.
- `packages/client -> packages/contracts -> packages/core` is a compile-time dependency direction, separate from runtime deployment and backend selection.
- Backend-specific authorization must remain behaviorally equivalent even though enforcement mechanisms differ.

Evidence: `app/api/_http.ts`, `app/api/v1/_http.ts`, `lib/db/index.ts`, `lib/db/repository.ts`, `docs/architecture/AI_ARCHITECTURE_CONTEXT.md`.
