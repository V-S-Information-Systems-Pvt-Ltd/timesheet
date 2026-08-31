# Implementation Plan — React Native Mobile API Architecture

## Execution owner

This plan is written for Gemini Flash 3.7 running in Antigravity against
`C:\dev\timesheet-mobile`.

Do not treat an existing file, passing unit test, or checked checkbox as proof
that a work packet is complete. Verify the behavior described below against the
current repository and native builds.

## Non-negotiable repository rules

1. Read `AGENTS.md` before changing files.
2. This repository uses Next.js 16. Before editing any `app/**/route.ts`, read
   the relevant bundled documentation in `node_modules/next/dist/docs/`.
3. Run `git status --short` before starting and before finishing.
4. The working tree may contain user-owned Windows packaging work. Do not
   overwrite, delete, stage, or reformat unrelated changes.
5. Never commit `.pfx`, `.cer`, signing passwords, generated packages, build
   output, binlogs, or `packages.lock.json` files produced by local Windows
   packaging.
6. Use the existing `Repository` facade in `lib/db/repository.ts`. Do not query
   PostgreSQL or Supabase directly from route handlers.
7. Maintain Native PostgreSQL and Supabase behavior parity.
8. Preserve existing Server Action names and signatures.
9. Add a regression test for every corrected behavior and at least one failure
   path for every new behavior.
10. Do not mark secure storage complete without installed-device proof on
    Android, iOS, and Windows.

## Objective

Finish and harden the existing React Native/mobile API implementation:

```text
React Native client
  -> versioned Next.js /api/v1 boundary
  -> mobile authentication and authorization
  -> application services
  -> existing Repository facade
  -> Native PostgreSQL or Supabase
```

Required outcomes:

- short-lived signed JWT access tokens;
- opaque rotating refresh tokens whose hashes alone are stored server-side;
- refresh-token reuse detection and family revocation;
- current-session and all-session logout;
- active-account authorization through `requireMobileActor`;
- Android Keystore, iOS Keychain, and Windows PasswordVault storage;
- durable workspace connection profile;
- centralized request timeout and one-retry `401` recovery;
- user-and-server-scoped dashboard cache;
- equivalent authorization and business rules across web, mobile, Native, and
  Supabase paths;
- generic public API errors, structured internal logs, session cleanup, and
  release gates.

## Verified repository baseline

The following foundations already exist and should be improved in place rather
than reimplemented under a parallel directory tree.

### Server components present

- `db/migrations/0017_mobile_sessions.sql`
- `supabase/migrations/20260904000000_mobile_sessions.sql`
- `lib/auth/mobile-tokens.ts`
- `lib/auth/mobile-session-store.ts`
- `lib/auth/mobile-credentials.ts`
- `lib/auth/mobile-actor.ts`
- `app/api/v1/_http.ts`
- `/api/v1/config`
- `/api/v1/auth/login`
- `/api/v1/auth/refresh`
- `/api/v1/auth/me`
- `/api/v1/auth/logout`
- `/api/v1/auth/logout-all`
- protected dashboard, timesheet, reference, leave, reminder, report, people,
  and password-change routes.

### Mobile components present

- centralized `ApiClient`;
- `SessionController` with single-flight refresh;
- `SessionProvider` and session-driven root UI;
- Connect, Sign In, Home, Timesheets, Log Time, Profile, Leaves, Reminders,
  Reports, and Team screens;
- workspace, token, and dashboard storage abstractions;
- Android, iOS, and Windows native projects;
- Jest suites for client, session, storage, and screens.

### Tests present

- Vitest route/auth/token/migration tests;
- mobile Jest tests;
- dual-backend build commands and database integration test support;
- Playwright and accessibility commands.

## Audit result: incomplete or unsafe areas

These findings override any existing document that marks all mobile work
packets complete.

### P0 — release blockers

1. `mobile/src/platform/secure-storage/durable.ts` is not secure native
   storage. It attempts plaintext `localStorage` and plaintext filesystem JSON,
   then silently behaves as memory-only when those facilities are unavailable.
   This violates `mobile/docs/secure-storage-spike.md`.
2. `mobile/src/storage/workspace-store.ts` uses the same browser/Node probing.
   It is not a reliable React Native persistence implementation.
3. `/api/v1/config` reports `bearerAuth: false`, but the mobile client does not
   validate that capability and can continue into authentication. The rollout
   gate is therefore ineffective.
4. The current Windows packaging worktree contains untracked certificate/key
   material and a packaging script with a literal certificate password. Do not
   stage or commit those files. Replace literal signing secrets with an
   environment/CI secret contract. Ask before deleting user-owned untracked
   files.

### P1 — correctness and security gaps

1. Native refresh rotation sets the replacement idle expiry to `now + 30 days`
   without capping it at the family's absolute expiry. Supabase uses `least(...)`.
   Near absolute expiry, Native can violate `idle_expires_at <= absolute_expires_at`.
2. `requireMobileActor` checks absolute expiry but not `idleExpiresAt`.
3. Supabase cleanup removes absolute-expired rows only; Native also removes
   sufficiently old revoked rows. Cleanup is not scheduled or invoked.
4. `SessionController.signIn()` does not revoke the newly created server
   session when secure credential persistence fails.
5. `logout-all` exists in the API client but is not owned/exposed by the session
   lifecycle or UI.
6. `ApiClient` has no timeout. `401` recovery is repeated across many provider
   methods instead of being one centralized, retry-once path.
7. Dashboard cache is process-memory-only and globally scoped. It is not keyed
   by canonical server URL and actor ID, so it cannot meet the plan's isolation
   requirement.
8. Dashboard response actor data omits `isActive`, although the mobile actor
   contract expects it.
9. Some mobile write routes return repository/database error text to clients as
   `DB_ERROR`. Public errors must be stable and generic.
10. Mobile timesheet route handlers duplicate business rules instead of calling
    a shared application service. This invites web/mobile drift.

### P2 — production hardening gaps

1. Login rate limiting uses an in-memory store and is not multi-instance safe.
2. Mobile write routes do not consistently apply the existing write-rate
   budget.
3. `serverError()` discards the exception and there are no request IDs or
   structured mobile auth/session audit events.
4. Login does not send actual device/platform/app-version metadata from the
   React Native client.
5. The client does not validate URL scheme, API version, or advertised
   capabilities before persisting a workspace.
6. Repository adapter behavior has unit coverage, but no shared live contract
   suite proves Native/Supabase mobile-session parity.
7. The secure-storage spike document still says native proof is pending while
   another plan marks the work complete.

## Work packets

Execute in order. A later packet must not be marked complete while an earlier
P0/P1 gate is open.

### WP-00 — discovery, hygiene, and truthful status

Deliverables:

- Create `docs/architecture/mobile-implementation-discovery.md` containing the actual module
  map, backend selection, role model, auth flow, relevant tests, and dirty-tree
  inventory.
- Update `docs/plans/MOBILE_AUTH_DASHBOARD_IMPLEMENTATION_PLAN.md` so status reflects
  evidence. Reopen secure storage, rollout, cleanup, and observability packets.
- Add safe ignore rules for generated Windows package output and local signing
  material where missing. Do not delete existing untracked user files without
  approval.
- Change the packaging script to receive signing identity/key/password from
  environment or CI. A local-development certificate generator may exist only
  if its output is ignored and its password is not committed.

Verification:

```powershell
git status --short
git diff --check
git check-ignore -v <each generated signing/build artifact>
```

Exit criteria:

- no credentials or generated signing material are staged;
- the discovery document matches current paths;
- no incomplete work packet is marked complete.

### WP-01 — mobile-session parity and guard correctness

Change the existing modules; do not introduce a second session repository.

Tasks:

- Cap Native replacement `idle_expires_at` at `absolute_expires_at`, matching
  the Supabase RPC.
- Make `requireMobileActor` reject both idle-expired and absolute-expired
  sessions.
- Define one cleanup retention rule and implement it equivalently in Native and
  Supabase. Prefer a server-side RPC for an atomic/expressive Supabase cleanup
  rather than chaining incompatible PostgREST filters.
- Test refresh at, immediately before, and immediately after idle/absolute
  boundaries using an injected clock.
- Add reuse, revoked, expired, logout, and logout-all contract cases.

Target files:

- `lib/auth/mobile-session-store.ts`
- `app/api/v1/_http.ts`
- a new Supabase migration if RPC/schema behavior must change; never edit an
  already-applied migration;
- `tests/mobile-session-store.test.ts`
- `tests/mobile-request-auth.test.ts`
- `tests/mobile-refresh-route.test.ts`
- migration guard tests.

Targeted verification:

```powershell
npx vitest run tests/mobile-session-store.test.ts tests/mobile-request-auth.test.ts tests/mobile-refresh-route.test.ts tests/db-migrations.test.ts tests/supabase-migrations.test.ts
```

### WP-02 — genuine three-platform secure storage

Requirements:

- Android: refresh token protected by Android Keystore.
- iOS: Keychain generic-password item with device-only accessibility.
- Windows: PasswordVault or equivalent OS credential locker.
- Persist only refresh token and non-secret session identifier; keep access
  tokens in memory.
- No plaintext file, `localStorage`, AsyncStorage, SQLite, Redux persistence,
  or silent in-memory production fallback for refresh tokens.
- Storage failures must be visible to the session controller.
- If login creates a server session and credential persistence fails, revoke
  that server session before returning to signed-out/error state.

Implementation guidance:

- Keep `SecureTokenStore` as the application boundary.
- A maintained Android/iOS Keychain wrapper is acceptable after verifying its
  React Native 0.84/new-architecture compatibility. React Native's security
  guide identifies Keychain/Keystore wrappers as the appropriate mechanism.
- Implement a small Windows native module backed by PasswordVault if the chosen
  package lacks Windows support.
- Use a separate non-secret persistent store for the workspace URL; do not
  pretend a Node filesystem probe is React Native storage.
- Update `mobile/docs/secure-storage-spike.md` with exact package versions,
  native configuration, failure behavior, and proof.

Required tests/evidence:

- adapter unit tests with injected native bridge mocks;
- corrupt-payload and unavailable-store failure tests;
- Android installed build write/read/delete smoke test;
- iOS installed build write/read/delete smoke test;
- Windows Debug and Release write/read/delete smoke tests;
- session persists across full process termination, not merely component
  remount.

Do not enable the public bearer capability until this packet passes.

### WP-03 — bootstrap compatibility and rollout gate

Tasks:

- Normalize and parse workspace URLs with `URL`; reject unsupported schemes.
- Require HTTPS in production. Permit HTTP only under an explicit development
  policy for emulator/LAN testing.
- Validate `/api/v1/config` response shape, `apiVersion`, `mobileApi`,
  `bearerAuth`, and minimum client version before saving the workspace.
- Keep `bearerAuth: false` until WP-02 native evidence passes. Set it to `true`
  only as the final change of this packet.
- Include actual platform, device name, and app version in login session
  metadata.
- Add `Cache-Control: no-store` consistently to authentication/config responses.

Tests:

- invalid URL and unsupported protocol;
- incompatible API version;
- disabled `mobileApi` or `bearerAuth`;
- malformed config payload;
- metadata reaches session creation;
- valid production HTTPS and explicit development HTTP paths.

### WP-04 — centralized authenticated networking

Move token-aware request execution behind one abstraction.

Required flow:

```text
request
  -> attach current access token
  -> apply AbortController timeout
  -> on first 401 join SessionController single-flight refresh
  -> retry original request exactly once
  -> on refresh rejection clear credentials and transition signed out
```

Rules:

- Never retry refresh recursively.
- Never retry non-authentication failures automatically.
- Preserve request body for the single retry.
- Concurrent 401 responses must result in one refresh request.
- Screens and feature methods must not implement their own refresh branches.
- Add `logoutAll()` to `SessionController` and `SessionProvider`; clear local
  tokens/cache after successful or locally forced completion.

Target files:

- `mobile/src/api/client.ts`
- `mobile/src/auth/session-controller.ts`
- `mobile/src/auth/SessionProvider.tsx`
- corresponding Jest suites.

### WP-05 — user/server-scoped cache

Cache key:

```text
canonical-server-origin + actor-id + cache-version
```

Requirements:

- store dashboard data only; never store access/refresh tokens or passwords;
- include fetched timestamp and schema version;
- enforce TTL and reject malformed cache records;
- invalidate on sign-out, logout-all, workspace disconnect/change, actor
  change, account deactivation, and incompatible schema version;
- never show one workspace/user's cached data to another;
- define whether offline cache is persistent. If persistent, use a supported
  cross-platform non-secret storage adapter and test process restart.

Tests must prove cross-user and cross-server isolation.

### WP-06 — application services and API contract hardening

Introduce a small service layer around existing repository operations; do not
move backend-specific behavior into routes.

Suggested location:

```text
lib/api/v1/services/
  dashboard.ts
  timesheets.ts
  reference.ts
```

Tasks:

- Move dashboard aggregation and timesheet business rules out of route files.
- Reuse shared validation/business-rule helpers used by Server Actions.
- Keep authorization-sensitive repository calls actor-scoped.
- Match web behavior for ownership, admin exceptions, backfill, daily-hour
  limits, sanitization, delete/update rules, and write budgets.
- Return stable API codes (`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`,
  `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`).
- Do not return raw repository, PostgreSQL, PostgREST, or Supabase error text.
- Add `isActive` to the dashboard actor DTO and type route responses.
- Use one method convention for update (`PUT` or `PATCH`) and document it; the
  existing client currently uses `PUT`.

Tests:

- service unit tests for happy/failure cases;
- route tests proving routes delegate and normalize errors;
- web/mobile parity cases for create, update, delete, backfill, ownership, and
  the 24-hour limit;
- role matrix for admin, pm, coordinator, manager, team lead, and user as
  applicable.

### WP-07 — distributed abuse protection

Tasks:

- Preserve generic invalid-credential responses and constant-cost password
  handling.
- Replace or wrap in-memory login rate limiting with the repository's approved
  production distributed provider.
- Apply write-rate limits to mobile mutations with the same semantics as web
  actions: check before work and consume only on successful writes; once per
  batch.
- Add `Retry-After` to `429` responses.
- Document trusted proxy/IP behavior.

Do not invent a provider silently. If no provider is approved, keep the rollout
capability disabled and report the concrete decision required.

### WP-08 — cleanup and observability

Session cleanup:

- use a scheduler appropriate to deployment (database scheduler or protected
  scheduled endpoint); do not rely on an in-process timer in serverless Next.js;
- clean expired and retention-eligible revoked sessions identically on both
  backends;
- make cleanup idempotent and observable.

Logging:

- generate/propagate request IDs;
- log route, status, latency, backend, and safe event codes;
- record login success/failure category, refresh rotation, reuse detection,
  current/all-session revocation, and cleanup count;
- never log passwords, raw bearer tokens, raw refresh tokens, token hashes,
  authorization headers, or full request bodies.

Add logger redaction tests.

### WP-09 — dual-backend and native release verification

Run targeted tests after each packet, then the complete gate:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:coverage

$env:NEXT_PUBLIC_BACKEND='supabase'; npm run build
$env:NEXT_PUBLIC_BACKEND='native'; npm run build

Set-Location mobile
npm run lint
npm run typecheck
npm test
npm run test:windows
```

Also run, with suitable credentials/infrastructure:

- the same mobile-session repository contract suite against migrated Native
  PostgreSQL and Supabase;
- Android Debug and Release builds;
- iOS build and installed-device secure-storage smoke test;
- Windows Debug and Release builds plus PasswordVault restart test;
- Playwright e2e after production builds;
- accessibility suite;
- refresh/logout/reuse scenario tests against a running server.

Before completion:

```powershell
git diff --check
git status --short
```

The final diff must contain only intended source, test, migration, and
documentation changes. Remove probe files and never stage generated signing or
package output.

## Required scenario matrix

1. Normal login: secure token persisted before authenticated state.
2. Cold start: workspace restored, refresh rotated, actor fetched.
3. Access expiry: one refresh, original request retried once.
4. Three concurrent 401s: one refresh, three successful retries.
5. Refresh reuse: entire family revoked, client signed out.
6. Current-session logout: current session rejected afterward.
7. Logout-all: all device sessions rejected afterward.
8. Inactive/deleted actor: protected API denied and local credentials cleared.
9. Offline start: correct scoped cache shown; reconnect succeeds without manual
   disconnect.
10. Workspace/user switch: old cache never appears.
11. Secure-store write failure: new server session revoked; no plaintext
    fallback.
12. Native/Supabase absolute-boundary refresh: identical result without a
    constraint error.

## Definition of done

### Server

- Native and Supabase session contract tests pass.
- Rotation is atomic and reuse revokes the family.
- Idle and absolute expiry are enforced consistently.
- Protected routes resolve the current active actor.
- Route handlers are thin and return stable, non-sensitive errors.
- Cleanup is scheduled, idempotent, and backend-equivalent.
- Distributed login and write rate limiting is active, or rollout remains
  explicitly disabled with a documented blocker.

### Mobile

- Workspace config is validated and durably restored.
- Refresh tokens use Android Keystore, iOS Keychain, and Windows PasswordVault.
- Access tokens exist only in memory.
- Cold-start restore works after real process termination.
- Authenticated requests have timeout, single-flight refresh, and one retry.
- Logout and logout-all clear local credentials and caches.
- Offline cache is server/user scoped and cannot cross identities.

### Security and release

- No raw token/password appears in logs, caches, snapshots, or persisted
  non-secure storage.
- No certificate, private key, package signing password, or generated package
  is committed.
- `/api/v1/config` advertises bearer support only after native secure-storage
  proof and production abuse protection gates pass.
- Root lint, typecheck, unit, coverage, both backend builds, mobile lint,
  mobile typecheck, mobile Jest, native builds, and required e2e tests pass.
- Completion documents list exact commands, results, skipped tests, external
  blockers, and native-device evidence. No inferred success is accepted.

## First Antigravity instruction

```text
Read AGENTS.md and this plan completely. Start with WP-00 only.

Inspect the current dirty working tree and preserve all user-owned changes.
Do not stage or commit signing material or generated Windows package files.
Read the relevant bundled Next.js 16 docs before changing route handlers.

Create docs/architecture/mobile-implementation-discovery.md from repository evidence,
correct false completion statuses in the existing mobile plan, and report the
exact diff and verification. Do not start WP-01 until WP-00 is reviewed.
```

## Primary platform references

- React Native security: https://reactnative.dev/docs/security
- Android Keystore: https://developer.android.com/privacy-and-security/keystore
- Apple Keychain Services: https://developer.apple.com/documentation/security/keychain-services
- Windows PasswordVault: https://learn.microsoft.com/uwp/api/windows.security.credentials.passwordvault
