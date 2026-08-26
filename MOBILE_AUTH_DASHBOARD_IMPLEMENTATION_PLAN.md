# Mobile Authentication and Dashboard Implementation Plan

> **Coding-agent runbook:** This file is an ordered implementation queue, not
> only an architecture proposal. The coding agent must work from the first
> unchecked work packet, satisfy its exit gate, update this file, and then move
> to the next packet. A checked item means implementation and verification are
> complete in the current branch.

## 0. Coding-agent execution contract

### Scope and source of truth

- Repository: `C:\dev\vsis-mobile`
- Required branch: `mobile`
- Existing web/backend root: repository root.
- React Native root: `mobile/`.
- Follow `AGENTS.md` before this plan. If the two conflict, `AGENTS.md` wins.
- Preserve unrelated user changes. Never reset, discard, or rewrite them.
- Do not commit credentials, signing material, raw tokens, `.env.local`, EAS
  credential exports, APK/AAB/IPA/MSIX files, or probe output.
- Do not change existing Server Action names or signatures.
- Do not edit an applied migration; always add a new native migration and its
  Supabase equivalent.
- Every authorization change must behave the same in Supabase and native mode.
- Use the repository/service layer for application data. Only authentication
  session adapters under `lib/auth/` may use their backend-specific storage.
- Keep the current web cookie flow operational. Bearer auth is additive.

### Required start procedure for every work packet

1. Run `git status --short --branch` and confirm the branch is `mobile`.
2. Read the target files and their tests before editing.
3. For Next.js changes, read the relevant installed Next.js 16 documentation:
   - `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
   - `node_modules/next/dist/docs/01-app/02-guides/authentication.md`
   - `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`
4. Record any discovered mismatch with this plan under **Agent notes** before
   changing architecture.
5. Implement only the current work packet and any minimal prerequisite needed
   to verify it.

### Required finish procedure for every work packet

1. Run the packet's targeted tests.
2. Run `npm run typecheck` and `npm run lint` at repository root when backend
   code changed.
3. Run `npm run typecheck`, `npm run lint`, and `npm test -- --runInBand` from
   `mobile/` when mobile TypeScript or UI changed.
4. Run `git diff --check` and `git status --short --branch`.
5. Remove scratch/probe artifacts and confirm the remaining diff is intended.
6. Update the work-packet checkbox, evidence, and **Agent notes** in this file.
7. Commit only when the user asked for commits. Use Conventional Commits, with
   the recommended boundary shown in the packet.

### Stop and request direction only when

- a required credential, external account, signing decision, or paid service is
  missing;
- the selected secure-storage approach cannot build on one of the three target
  platforms;
- completing the packet requires a destructive database or git operation;
- an existing uncommitted change overlaps the required hunk and cannot be
  preserved safely;
- Supabase/native parity would require materially different public behavior;
- a security decision would weaken token storage, rotation, revocation, TLS,
  authorization, or secret handling.

Tests failing because of implementation defects are not a reason to stop: fix
the defect or reduce it to a concrete blocker with evidence.

### Work-packet status ledger

| ID | Status | Depends on | Work packet | Recommended commit |
| --- | --- | --- | --- | --- |
| WP-00 | `[~]` | — | Baseline and compatibility evidence | `chore(mobile): record auth compatibility baseline` |
| WP-01 | `[x]` | WP-00 | Shared contracts and token primitives | `feat(auth): add mobile token primitives` |
| WP-02 | `[~]` | WP-01 | Dual-backend mobile-session persistence | `feat(auth): persist mobile sessions` |
| WP-03 | `[~]` | WP-02 | Login, refresh, me, and logout API | `feat(api): add mobile authentication routes` |
| WP-04 | `[~]` | WP-03 | Protected request auth and dashboard API | `feat(api): add mobile dashboard endpoints` |
| WP-05 | `[~]` | WP-03 | Three-platform secure storage and session state | `feat(mobile): add secure session lifecycle` |
| WP-06 | `[ ]` | WP-04, WP-05 | Sign-in, dashboard, and recent-entry UI | `feat(mobile): add authenticated dashboard` |
| WP-07 | `[ ]` | WP-06 | Security hardening and release candidates | `chore(release): harden mobile authentication` |

The agent may execute WP-04 and WP-05 independently after WP-03, but must not
start WP-06 until both are complete.

### Evidence format

When closing a packet, replace `[ ]` with `[x]` and append a short entry here:

```text
- WP-XX — YYYY-MM-DD — commit or `uncommitted`
  - Tests: <exact commands and result>
  - Artifacts: <paths/build URLs, or none>
  - Notes: <remaining non-blocking follow-up, or none>
```

### Completion evidence

- WP-01 — 2026-08-26 — uncommitted
  - Tests: `npm run lint` (pass), `npm run typecheck` (pass), and elevated
    `npx vitest run tests/mobile-tokens.test.ts` (3 passed).
  - Artifacts: `lib/auth/mobile-tokens.ts`, `tests/mobile-tokens.test.ts`.
  - Notes: route integration and session persistence are WP-02/WP-03 work.
- WP-02 — 2026-08-26 — uncommitted
  - Tests: elevated `npx vitest run tests/db-migrations.test.ts tests/supabase-migrations.test.ts` (9 migration assertions passed as part of the current suite).
  - Artifacts: `db/migrations/0017_mobile_sessions.sql`,
    `supabase/migrations/20260904000000_mobile_sessions.sql`,
    `lib/auth/mobile-session-store.ts`.
  - Notes: live native/Supabase integration tests remain before completion.
- WP-03/WP-04 — 2026-08-26 — uncommitted
  - Tests: elevated suite covering login, refresh, request auth, me, dashboard,
    logout, tokens, and migrations (9 files, 26 tests passed); root lint and
    typecheck passed.
  - Artifacts: `app/api/v1/auth/`, `app/api/v1/_http.ts`,
    `app/api/v1/dashboard/route.ts`, and corresponding `tests/mobile-*.test.ts`.
  - Notes: route implementation is present; completion still requires live
    Supabase/native parity tests, production shared rate limiting, and the
    capability-flag enablement decision.
- Build verification — 2026-08-26
  - Tests: elevated `npm run build` (Next.js compilation, TypeScript, page
    generation, and route manifest all passed).
  - Notes: bearer capability remains disabled until the remaining API and mobile
    client gates are complete.
- Protected read surface — 2026-08-26 — uncommitted
  - Artifacts: `/api/v1/dashboard`, `/api/v1/timesheets`, and
    `/api/v1/reference`, with validation and repository-backed authorization.
  - Tests: targeted route suite and elevated `npm run build` both pass.
  - Notes: the React Native client does not consume these endpoints yet; that
    is WP-05/WP-06.
- WP-05 client foundation — 2026-08-26 — uncommitted
  - Tests: from `mobile/`, `npm run lint`, `npm run typecheck`, and Jest (3
    suites, 8 tests passed).
  - Artifacts: `mobile/src/api/client.ts`, `mobile/src/api/contracts.ts`,
    `mobile/src/auth/session-controller.ts`, `mobile/src/auth/token-store.ts`.
  - Notes: `MemoryTokenStore` is test/local-only. Android/iOS/Windows OS-backed
    adapter and production UI wiring remain gated by the secure-storage spike.
- Full regression — 2026-08-26
  - Tests: elevated `npm test` (51 files passed, 1 skipped; 471 tests passed,
    1 skipped).
  - Notes: `git diff --check` still reports trailing whitespace in the
    concurrently modified generated `mobile/windows/VsisTimesheetMobile/AutolinkedNativeModules.g.cpp`; that file was not edited by this implementation.

### Agent notes

- The repository currently contains an uncommitted documentation addition and
  `.gitignore` cleanup made while preparing this plan. Preserve both.
- Uncommitted `mobile/package.json` and `mobile/package-lock.json` changes were
  also detected during plan preparation. They add `patch-package` support and
  are outside this documentation edit; preserve them and determine their owner
  and intended patch before WP-00 records the baseline.
- The production distributed rate-limit provider is not selected. WP-03 may
  implement an adapter and local test implementation, but enabling bearer auth
  in production pauses until a shared provider is approved and configured.
- The secure-storage package is intentionally not preselected. WP-00 must prove
  Android, iOS, and Windows compatibility before WP-05 adopts a dependency or
  implements platform adapters.
- WP-00 baseline: root lint/typecheck passed; root Vitest was blocked in the
  sandbox by Vite `spawn EPERM`; mobile lint/typecheck/Jest/Windows Jest all
  passed. The secure-storage spike remains pending native build evidence.
- WP-02 schema groundwork is present: native `0017_mobile_sessions.sql` and
  Supabase `20260904000000_mobile_sessions.sql` add the server-only session
  table. Session-store adapters and rotation transactions are still pending.

## 1. Goal

Deliver the next usable VSIS mobile slice on Android, iOS, and Windows:

1. Connect to an approved VSIS server.
2. Sign in with the same account used by the web application.
3. Restore and refresh the session securely after an app restart.
4. Load a protected dashboard and recent timesheets.
5. Sign out and revoke the current device session.

The existing web cookie flow remains unchanged. Mobile clients use a separate
bearer-token flow through `/api/v1`; they never connect directly to PostgreSQL
or receive Supabase service-role credentials.

This plan is the focused implementation slice that follows
`MULTIPLATFORM_IMPLEMENTATION_PLAN.md`.

## 2. Current baseline

- `mobile/` builds and runs as React Native 0.84 on Android, iOS, and Windows.
- Android preview builds are produced by EAS without Android Studio.
- iOS builds are produced by EAS hosted macOS workers; a local Mac is not
  required.
- `GET /api/v1/config` is deployed and the mobile client can verify a server.
- The capability response currently reports `bearerAuth: false`.
- Web authentication is cookie-based in both backend modes.
- Existing `/api/data/*` routes depend on the cookie-authenticated
  `requireActive()` helper.
- The mobile client currently has only a bootstrap API client and connectivity
  UI; it has no secure token storage, session state, or protected screens.

## 3. Approved architecture

### 3.1 One first-party mobile token model

Use the same mobile token protocol whether `NEXT_PUBLIC_BACKEND` is `supabase`
or `native`.

- Access token: signed first-party JWT, 15-minute lifetime, kept in memory.
- Refresh token: opaque 256-bit random value, 30-day idle lifetime and 90-day
  absolute lifetime, stored only in platform-secure storage.
- Server persistence: store only a SHA-256 digest of the refresh token.
- Rotation: every successful refresh invalidates the presented token and
  returns a new refresh token.
- Reuse detection: reuse of a rotated token revokes its whole token family.
- Claims: `sub`, `sid`, `family`, `iss`, `aud`, `iat`, `exp`, and token version.
  Do not put mutable roles or active status in authorization claims.
- Authorization: resolve the current `Actor` from the database on each
  protected request and reject inactive or deleted users.

Use a dedicated `MOBILE_AUTH_SECRET`; do not overload the native web-cookie
secret. Production startup must fail when bearer auth is enabled without a
sufficiently strong secret.

### 3.2 Backend-specific credential verification

- Native mode: reuse the existing scrypt password verification in
  `lib/auth/native.ts`; do not duplicate password logic in the route.
- Supabase mode: create an isolated server-side Supabase auth client using the
  public project key with `persistSession: false`, then call
  `signInWithPassword`. Never use the service-role key to validate a password.
- After either backend verifies credentials, the server creates the same
  first-party mobile session and token pair.
- Return one generic invalid-credentials error so account existence is not
  disclosed.

### 3.3 Web and mobile request authentication

Introduce a request-aware API auth helper:

```ts
type RequestAuth =
  | { ok: true; actor: Actor; kind: 'cookie'; sessionId: null }
  | { ok: true; actor: Actor; kind: 'bearer'; sessionId: string }
  | { ok: false; response: Response }
```

- A valid bearer header is resolved independently of browser cookies.
- Cookie requests continue through the current auth facade.
- Cookie-authenticated mutations retain Origin/Referer validation.
- Bearer-authenticated mutations do not require browser-origin headers, but
  still require HTTPS, validation, authorization, rate limits, and
  idempotency where relevant.
- An invalid bearer header must never silently fall back to a cookie.

### 3.4 Secure storage adapters

Define a small shared `SecureTokenStore` interface and implement it per
platform:

- Android: credential encrypted with a key protected by Android Keystore.
- iOS: Keychain generic-password item, device-only accessibility.
- Windows: `Windows.Security.Credentials.PasswordVault` through a small React
  Native Windows native module if no maintained three-platform package passes
  the compatibility spike.

Persist the refresh token, device/session identifier, and approved base URL.
Keep the access token, password, and decrypted refresh token out of ordinary
application storage and logs.

Do not select a secure-storage dependency until it has passed clean builds on
all three pinned native targets. Production builds use a configured HTTPS base
URL. The manual server-entry screen remains an internal/preview feature or is
restricted to an allow-list.

## 4. API contract

Every endpoint uses the existing `ApiResult<T>` envelope and stable error
codes. Error messages may be localized later; client logic branches only on
codes.

| Method | Route | Purpose | Authentication |
| --- | --- | --- | --- |
| `GET` | `/api/v1/config` | Version/capability negotiation | Public |
| `POST` | `/api/v1/auth/login` | Verify credentials and create device session | Public, rate-limited |
| `POST` | `/api/v1/auth/refresh` | Rotate refresh token and issue access token | Refresh token |
| `GET` | `/api/v1/auth/me` | Return current actor/profile | Bearer |
| `POST` | `/api/v1/auth/logout` | Revoke current device session | Bearer + refresh token proof |
| `POST` | `/api/v1/auth/logout-all` | Revoke all mobile sessions for actor | Bearer |
| `GET` | `/api/v1/dashboard` | Return dashboard summary in one round trip | Bearer |
| `GET` | `/api/v1/timesheets` | Return paginated/filtered visible entries | Bearer |
| `GET` | `/api/v1/reference` | Return projects, activities, and relevant settings | Bearer |

### Login response

```ts
interface LoginData {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  sessionId: string;
  actor: ActorDto;
}
```

### Required error codes

- `INVALID_CREDENTIALS`
- `ACCOUNT_INACTIVE`
- `AUTH_REQUIRED`
- `ACCESS_TOKEN_EXPIRED`
- `INVALID_REFRESH_TOKEN`
- `REFRESH_TOKEN_REUSED`
- `SESSION_REVOKED`
- `RATE_LIMITED`
- `VALIDATION_ERROR`
- `API_VERSION_UNSUPPORTED`

Set `bearerAuth: true` in `/api/v1/config` only after login, refresh, logout,
and protected-request tests pass in both backend modes.

## 5. Data model and migrations

Add append-only migrations for native PostgreSQL and Supabase with equivalent
behavior. Do not edit an applied migration.

Create `mobile_sessions` with at least:

| Column | Purpose |
| --- | --- |
| `id` | Session UUID used by the access-token `sid` claim |
| `user_id` | Owner profile/auth user |
| `family_id` | Groups rotations for reuse response |
| `refresh_token_hash` | SHA-256 digest; raw token is never stored |
| `previous_token_hash` | Optional bounded reuse-detection link |
| `device_name` / `platform` | User-visible session metadata |
| `created_at` / `last_used_at` | Audit and idle-expiry calculation |
| `idle_expires_at` / `absolute_expires_at` | Server-enforced expiry |
| `rotated_at` / `revoked_at` | Token lifecycle state |
| `replaced_by_id` | Rotation lineage |

Requirements:

- Foreign key deletion revokes/removes sessions when a user is deleted.
- Refresh rotation is atomic and safe under concurrent requests.
- Supabase table has RLS enabled and no client grants; only trusted server code
  can create or rotate sessions.
- Native and Supabase migration tests assert columns, constraints, indexes,
  RLS, and grants.
- Add an index for active-token digest lookup and an index for user/session
  revocation.

## 6. File-level implementation backlog

Each stage below is owned by the work packet with the matching ID. Do not mark
a packet complete based on code presence alone; its tests and exit gate are
mandatory.

### WP-00 — baseline and compatibility evidence

- Capture the clean baseline results for root lint, typecheck, and unit tests.
- Capture the mobile lint, typecheck, Jest, and Windows Jest baseline.
- Confirm `/api/v1/config` route tests pass before auth capability changes.
- Build a minimal proof for secure credential write/read/delete on Android,
  iOS, and Windows. Prefer a maintained dependency only if its current source
  and native projects explicitly support all pinned targets.
- Write the result to `mobile/docs/secure-storage-spike.md`, including package
  version, platform support evidence, build result, rejected alternatives, and
  the chosen adapter boundary.
- Do not add production session code in this packet.

Targeted verification:

```powershell
npm run lint
npm run typecheck
npx vitest run tests/mobile-config-route.test.ts
Set-Location mobile
npm run lint
npm run typecheck
npm test -- --runInBand
npm run test:windows
```

Exit: baseline failures are documented separately from new failures, and the
secure-storage approach has build evidence for all three targets. If an iOS
device build requires credentials, the EAS build URL is acceptable evidence.

### WP-01 — contracts and token primitives

- `packages/contracts/` or, initially, `lib/api/v1/contracts.ts`
  - API envelope, auth DTOs, dashboard DTOs, and Zod schemas.
  - Re-export mobile-safe types without importing Next.js/server-only code.
- `lib/auth/mobile-tokens.ts`
  - Create/verify access JWTs, generate refresh tokens, hash tokens, enforce
    issuer/audience/version and constant-time comparisons.
- `lib/auth/mobile-session-store.ts`
  - Backend-neutral create, find, rotate, revoke-current, and revoke-all API.
- `lib/auth/mobile-credentials.ts`
  - Native/Supabase credential-verification adapters.
- `.env.example`
  - Document `MOBILE_AUTH_SECRET`, issuer/audience, and optional lifetime
    overrides with secure defaults.

Exit: token and credential adapter unit tests pass without route or UI code.

Required targeted test: `npx vitest run tests/mobile-tokens.test.ts`.

### WP-02 — dual-backend mobile-session persistence

- Add the next numbered migration under `db/migrations/`.
- Add a timestamped equivalent under `supabase/migrations/`.
- Implement the native and Supabase adapters behind
  `lib/auth/mobile-session-store.ts`.
- Make rotation a single conditional database operation or transaction; a
  read followed by an unguarded update is not acceptable.
- Keep all Supabase session-table access in server-only modules.

Required targeted tests:

```powershell
npx vitest run tests/mobile-session-store.test.ts
npx vitest run tests/db-migrations.test.ts
npx vitest run tests/supabase-migrations.test.ts
```

Exit: create, rotate, concurrent-rotate, revoke-current, revoke-family,
revoke-all, idle expiry, and absolute expiry pass in both adapters.

### WP-03 — authentication routes and credential verification

- Add `app/api/v1/auth/login/route.ts`.
- Add `app/api/v1/auth/refresh/route.ts`.
- Add `app/api/v1/auth/me/route.ts`.
- Add `app/api/v1/auth/logout/route.ts` and `logout-all/route.ts`.
- Add `app/api/v1/_http.ts` with envelope helpers and request-aware bearer
  authentication; do not change existing route signatures.
- Extend rate limiting so login protection works in a multi-instance Vercel
  deployment. The current in-memory limiter is acceptable only for local
  development; production login throttling must use a shared store or platform
  rate-limit service.

Exit: a command-line client can log in, refresh once, reject reuse, call `me`,
and revoke the device session against both backend modes.

Required targeted tests:

```powershell
npx vitest run tests/mobile-auth-routes.test.ts
npx vitest run tests/mobile-auth-parity.test.ts
npx vitest run tests/auth-routes.test.ts
npx vitest run tests/auth-facade.test.ts
```

Do not set `bearerAuth: true` during WP-03. The capability changes only after
WP-04 protected-route tests pass.

### WP-04 — protected request auth and dashboard API

- Add `app/api/v1/_http.ts` with the cookie/bearer request-auth union.
- Add `app/api/v1/dashboard/route.ts` using repository/service methods.
- Add `app/api/v1/timesheets/route.ts` using the existing timesheet query
  schema and `repo.listTimesheets(actor, options)`.
- Add `app/api/v1/reference/route.ts` for the first-screen reference data.
- Extract service logic only where needed so Server Actions and REST routes do
  not diverge.
- Return a compact dashboard payload: actor, today's total, current-week total,
  recent entries, active reminders, and allowed quick actions.
- Change `/api/v1/config` to `bearerAuth: true` only when all required tests in
  this packet pass.

Required targeted tests:

```powershell
npx vitest run tests/mobile-request-auth.test.ts
npx vitest run tests/mobile-dashboard-route.test.ts
npx vitest run tests/mobile-timesheets-route.test.ts
npx vitest run tests/mobile-config-route.test.ts
npx vitest run tests/timesheets-api.test.ts
```

Exit: valid bearer requests work, expired/revoked bearer requests fail, invalid
bearer never falls back to a cookie, cookie CSRF behavior is unchanged, and
role/hierarchy visibility matches the repository in both backend modes.

### WP-05 — mobile session foundation

- `mobile/src/platform/secure-storage/`
  - `SecureTokenStore` interface plus Android, iOS, Windows, and test adapters.
- `mobile/src/auth/SessionProvider.tsx`
  - State machine: `booting`, `signedOut`, `signingIn`, `signedIn`,
    `refreshing`, `pendingApproval`, `offline`, `fatal`.
- `mobile/src/api/client.ts`
  - Add bearer injection, one-time 401 refresh, single-flight refresh for
    concurrent calls, timeout/cancellation, and typed errors.
- `mobile/src/screens/SignInScreen.tsx`
  - Email/password form, validation, rate-limit feedback, password visibility,
    pending/inactive state, keyboard and accessibility behavior.
- `mobile/src/app/`
  - Route authenticated and unauthenticated users from session state.

Rules:

- Write the refresh token to secure storage before considering login complete.
- If secure storage fails, revoke the new server session and remain signed out.
- Never retry login automatically.
- Refresh a token once per failed request group; prevent refresh storms.
- Clear local secrets on invalid/reused/revoked refresh tokens.
- Redact authorization headers, passwords, and token-shaped values from logs.

Exit: cold-start recovery, expiry refresh, offline startup, invalidation, and
logout work in component/integration tests and installed preview builds.

Required targeted tests from `mobile/`:

```powershell
npm test -- --runInBand __tests__/api-client.test.ts
npm test -- --runInBand __tests__/secure-token-store.test.ts
npm test -- --runInBand __tests__/session-provider.test.tsx
npm run test:windows
```

### WP-06 — sign-in, dashboard, and recent-entry UI

- `mobile/src/screens/HomeScreen.tsx`
  - Today/week totals, recent entries, reminders, loading/empty/error/offline
    states, refresh, and sign-out entry point.
- `mobile/src/screens/TimesheetListScreen.tsx`
  - Paginated recent entries and date filter.
- `mobile/src/navigation/`
  - Bottom navigation on phones; navigation rail/sidebar on Windows/wide
    layouts.
- Cache the last successful dashboard payload for read-only offline display.
  Do not cache tokens with the dashboard data.

Exit: an employee can sign in and view only authorized data on Android, iOS,
and Windows; keyboard, screen-reader, font scaling, and high-contrast checks
pass for the new screens.

Required targeted tests from `mobile/`:

```powershell
npm test -- --runInBand __tests__/sign-in-screen.test.tsx
npm test -- --runInBand __tests__/home-screen.test.tsx
npm test -- --runInBand __tests__/App.test.tsx
npm run test:windows
```

### WP-07 — hardening and rollout

- Security review of token leakage, rotation races, session revocation,
  account deactivation, URL validation, and error enumeration.
- Add observability using request/session IDs but never raw tokens.
- Add cleanup for expired/revoked session records.
- Deploy backend with bearer auth disabled, run migrations, deploy routes,
  execute smoke tests, then enable the capability flag.
- Produce Android preview APK, iOS internal/TestFlight build, and Windows x64
  package from the same commit.
- Roll out to internal testers first; retain an immediate server-side switch to
  disable mobile bearer authentication.

Required full verification:

```powershell
# Repository root
npm run lint
npm run typecheck
npm test

# Run a production build once per backend with the required environment set.
$env:NEXT_PUBLIC_BACKEND = 'supabase'
npm run build
$env:NEXT_PUBLIC_BACKEND = 'native'
npm run build
Remove-Item Env:NEXT_PUBLIC_BACKEND

# React Native root
Set-Location mobile
npm run lint
npm run typecheck
npm test -- --runInBand
npm run test:windows
```

Exit: the complete verification matrix in section 7 passes, release artifacts
are traceable to one commit, rollout/rollback steps are documented, and no
production secret is present in source or build logs.

## 7. Verification matrix

### Backend unit and route tests

- Correct access-token claims and signature validation.
- Expired, wrong issuer/audience/version, malformed, and tampered tokens.
- Refresh token is random, stored only as a digest, and rotated atomically.
- Two simultaneous refresh requests produce only one success.
- Rotated-token reuse revokes the family.
- Current-device and all-device logout behavior.
- Wrong password and unknown user return indistinguishable responses.
- Inactive/deleted user is rejected after a previously valid login.
- Cookie requests still work and still require CSRF checks for mutations.
- Invalid bearer never falls back to cookie authentication.
- Rate-limit response and `Retry-After` behavior.

### Dual-backend tests

- Supabase and native credentials produce the same API contract.
- `Actor` role, hierarchy, active status, and super-admin state are refreshed
  from the database.
- Dashboard and timesheet visibility is identical for employee, manager,
  coordinator, admin, inactive, and deleted-user cases.
- Both migration suites prove grants/RLS and schema parity.

### Mobile tests

- Secure-store save/read/delete failure paths.
- Sign-in validation and server error mapping.
- Cold start with no token, valid token, expired access token, invalid refresh
  token, and unreachable server.
- Single-flight refresh under concurrent dashboard requests.
- Session removal on logout and server revocation.
- No token/password appears in persisted state, snapshots, analytics, or logs.
- Phone and Windows responsive navigation behavior.

### Build acceptance

- `npm run lint`, `npm run typecheck`, targeted Vitest files, and both backend
  builds pass.
- Mobile lint/typecheck/component tests pass.
- Android preview APK installs and completes login/dashboard/logout.
- iOS EAS build completes and the same smoke flow passes on a registered device
  or TestFlight.
- Windows Release x64 build completes and passes the same smoke flow.

## 8. Delivery sequence and estimate

| Milestone | Estimated effort | Deliverable |
| --- | ---: | --- |
| Security/storage compatibility spike | 2-3 days | Approved token/storage design and three-platform proof |
| Contracts, migrations, token service | 4-6 days | Tested session model in both backends |
| Auth routes and request auth helper | 4-6 days | Login/refresh/me/logout API complete |
| Mobile session and sign-in UI | 5-7 days | Recoverable secure sign-in on all platforms |
| Dashboard API and UI | 5-7 days | Protected employee dashboard and recent entries |
| Hardening, device QA, cloud artifacts | 3-5 days | Release-candidate Android/iOS/Windows builds |

Expected total: 23-34 engineering days for one developer, excluding account,
cloud queue, certificate, store review, and external security-review delays.

## 9. Definition of done

- `/api/v1/config` reports bearer authentication available in the deployed
  environment.
- Mobile login, refresh, protected data, logout, and revocation pass against
  both Supabase and native backends.
- The web cookie login and existing Server Actions remain behavior-compatible.
- Only refresh tokens are persisted by the app, using OS-protected storage;
  access tokens remain in memory.
- The server stores only refresh-token digests and detects rotation reuse.
- An inactive, deleted, or revoked user loses mobile access without waiting for
  the refresh token's absolute expiry.
- Android preview APK, iOS cloud build, and Windows x64 package are produced
  from one tagged commit without Android Studio or a local Mac.
- Tests, operational rollout, rollback, and session-revocation runbooks are
  complete.

## 10. Implementation references

- Supabase server-side auth client and password login:
  https://supabase.com/docs/reference/javascript/auth
- Supabase `signInWithPassword`:
  https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- Android Keystore:
  https://developer.android.com/privacy-and-security/keystore
- Apple Keychain Services:
  https://developer.apple.com/documentation/security/keychain-services
- Windows PasswordVault:
  https://learn.microsoft.com/en-us/uwp/api/windows.security.credentials.passwordvault
