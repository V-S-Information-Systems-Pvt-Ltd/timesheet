# Auth and Security

## Identity paths

- Server facade: `lib/auth/index.ts` exposes the native auth implementation.
- Native web auth: versioned scrypt password hashes in `lib/auth/password.ts`, signed `vsis_session` JWT cookie in `lib/auth/jwt.ts`, current profile/session-version checks in `lib/auth/native.ts`.
- Mobile auth: signed access token plus persisted `mobile_sessions` state; protected `/api/v1` calls validate token claims against session/user/family, revocation/rotation, expiry, and actor state.

## Authorization layers

Identity, active-account state, permission role, hierarchy scope, and resource ownership are separate checks. Server Actions use `requireActiveActor`, `requireActor`, or `requireSuperAdmin`. Repository queries must enforce scope through application checks/parameterized SQL.

## Web request protection

`app/api/_http.ts` uses `originCheck` for state-changing cookie-authenticated requests. `/api/v1` is bearer-only by default; routes must explicitly opt into cookie authentication, and cookie mutations remain origin-protected.

## Sensitive implementation constraints

- `DATABASE_URL`, `AUTH_SECRET`, `MOBILE_AUTH_SECRET`, reset tokens, refresh tokens, and privileged credentials stay server-side.
- Read-only aggregates must stay actor-scoped in SQL (`lib/db/native/reporting.ts`).
- `SECURITY DEFINER` functions require explicit owner, grants, `search_path`, and security tests.
- Password-change/mobile-session flows have concurrency/lock-order behavior; preserve existing lock ordering when editing them.
- `lib/ip.ts` is the proxy-aware client-IP boundary for rate limits; deployment proxy policy is security-relevant.

Evidence: `app/actions/_shared.ts`, `app/api/_http.ts`, `app/api/v1/_http.ts`, `lib/auth/native.ts`, `lib/auth/password.ts`, `lib/auth/jwt.ts`, `lib/ip.ts`, `AGENTS.md`.
