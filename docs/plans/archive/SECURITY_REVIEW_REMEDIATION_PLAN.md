# Security Remediation and Re-audit Implementation Plan

## Summary

Fix the validated server and deployment gaps, complete OS-backed mobile credential storage on Android, iOS, and Windows, add distributed rate limiting, re-establish known Supabase refresh-rotation state in live environments, and publish an evidence-based security report.

Keep `MOBILE_BEARER_AUTH_ENABLED=false` until every rollout gate passes.

## Validated Preconditions

Findings that shape the slices below. Each is source-verified in the current tree.

- `/api/health` returns `version`, `commit`, `backend`, pool metrics, and `db.error` unconditionally (`app/api/health/route.ts:50-61`). Container probes read only the status code (`deploy/deployment.yaml:39-50`), so minimizing the body is safe.
- Cron cleanup fails **open** when `CRON_SECRET` is unset (`app/api/v1/cron/cleanup/route.ts:15-22`); the unset case has no test.
- `CRON_SECRET` and `HEALTH_DEBUG` are absent from `.env.example`. `HEALTH_DEBUG` is read by no code.
- The nginx Ingress has no `tls:` block, no `ssl-redirect`, and no HSTS; it routes to port 80 (`deploy/ingress.yaml:6-19`). This is the real transport exposure.
- The OpenShift Route sets `termination: edge` with no `insecureEdgeTerminationPolicy` (`deploy/route.yaml:13-14`). Omitting that field makes OpenShift **drop** HTTP rather than serve it in clear, so a redirect is a usability change; the Route's only security gap is the missing HSTS annotation.
- No HSTS exists in application code and none should be added there (`next.config.ts:44-61` sets five headers; no `middleware.ts` exists anywhere).
- Rate limiting is process-local: seven exported `Map` objects with prune-on-read and no persistence (`lib/rate-limit.ts:18,36-42`). 58 invocation lines plus 10 `getRetryAfter` calls span 15 files; all are synchronous.
- `getClientIp` fails closed to the literal string `'direct-client'` in production when `TRUSTED_PROXY_HOPS` is unset (`lib/ip.ts:103`), and it is unset everywhere — absent from `.env.example` and `deploy/configmap.yaml`, referenced only inside `lib/ip.ts`.
- Android and Windows native modules now exist **uncommitted in the working tree** and are partially complete; iOS still has only `AppDelegate.swift`. The JavaScript contract already fails closed (`mobile/src/platform/secure-storage/native.ts:24-40`). Slices 3 and 5 are therefore hardening-and-evidence work rather than greenfield implementation; the gaps are enumerated in each slice.
- The uncommitted work also loosened the JavaScript read contract from `raw === null` to `!raw` (`mobile/src/platform/secure-storage/native.ts:121`) so that an empty string counts as absent, because `ReactPromise<std::string>` cannot resolve `null`. That is a real contract change and must be either accepted deliberately or replaced with an optional-returning Windows signature.
- A version bump to `0.4.1` (Android `versionCode 8`) is present across all six manifests required by `docs/maintenance/RELEASE_POLICY.md`.
- `rotate_mobile_session` in `supabase/migrations/20260904000000_mobile_sessions.sql:65,71,75` references `RETURNS TABLE` columns unqualified, so PL/pgSQL raises `column reference is ambiguous`. Bodies parse lazily, so `create or replace` succeeded and the failure appears only on the first RPC call.
- Which body a live database holds is **unresolvable by inspection**: version `20260905000000` was used by three different SQL bodies across history, and `origin/main` still ships `20260905000000_freeze_manager_id_own_update.sql` — a different body under the identical version. Supabase reconciles on version, so a database seeded from `main` skips the repair permanently.
- Both candidate rotation bodies pin `search_path = public` only (`20260904000000:57`, `20260905000000:35`). The one body that pinned `public, pg_temp` was deleted in `a774ac9`.
- No prior security review exists in the repository. `docs/security/` does not exist and the phrase "zero SQL template interpolation" appears nowhere in tracked or untracked files. The report being superseded is external to the repo, so slice 9 authors a new document and treats the correction list as drafting constraints.

## Interface and Policy Changes

- Add server-only `HEALTH_DEBUG`; only the exact value `true` enables verbose `/api/health` output. Unset, invalid, or `false` returns only `{ status: "ok" | "degraded" }`.
- Require `CRON_SECRET` in every environment: unset returns 503, mismatch returns 403, and only an exact constant-time match runs cleanup.
- Require `TRUSTED_PROXY_HOPS` in every proxied deployment, and document it per topology.
- Add a server-only rate-limit subject key for HMAC derivation, available in **both** backend modes.
- Replace the synchronous rate-limit exports with an asynchronous repository-backed reserve/release contract, preserving current limits, keys, retry headers, failed-auth counting, and successful-mutation counting.
- Preserve the existing `VsisSecureStorage` JavaScript contract: `read`, `write`, `clear`, and `clearLegacy`.
- Add no new credential-storage or cache dependency.
- Enforce one-year HSTS at deployment edges without `includeSubDomains` or `preload`.

## Implementation Slices

### 0. Request Identity and Secret Prerequisites

**Blocked by:** None

- Set and document `TRUSTED_PROXY_HOPS` for the nginx Ingress and OpenShift Route topologies; add it to `.env.example` and `deploy/configmap.yaml`.
- Add a regression test asserting `getClientIp` does not return `'direct-client'` under each documented topology.
- Select the rate-limit subject HMAC key and add it to `.env.example` with a both-modes note. `AUTH_SECRET` is native-only and `MOBILE_AUTH_SECRET` is bearer-only, so neither is guaranteed present in supabase mode.
- Add `CRON_SECRET` and `HEALTH_DEBUG` to `.env.example`, deployment secrets, and operational documentation.

Rationale: without a trusted-hop policy, every unproxied production request collapses onto the single key `direct-client`. That collapse is per-process today. Behind shared storage it becomes cluster-wide, so `signup:direct-client` at a limit of 10 would cap the entire deployment at ten signups per hour.

### 1. Operational Endpoints Fail Closed

**Blocked by:** None

- Make health output minimal by default.
- Add `HEALTH_DEBUG`, `Cache-Control: no-store`, and server-side diagnostic logging.
- Require `CRON_SECRET` and compare it with a constant-time comparison.
- Test default and debug health responses, and missing, incorrect, and correct cron secrets.

### 2. Public Deployments Enforce HTTPS and HSTS

**Blocked by:** None

- nginx Ingress: add an operator-supplied TLS secret, a `tls:` block, `nginx.ingress.kubernetes.io/ssl-redirect`, and the HSTS response header.
- OpenShift Route: add `haproxy.router.openshift.io/hsts_header`. Optionally add `insecureEdgeTerminationPolicy: Redirect`, recorded as a usability choice rather than a security fix, because the current omission already drops insecure traffic.
- Verify Vercel's deployed HSTS header. There is no `vercel.json` or `.vercel/` in the repository, so this can only be confirmed against a live deployment.
- Do not add a global HSTS header to `next.config.ts`.
- Update `deploy/README.md`, whose current exposure step (`:34-36`) mentions no TLS at all.

### 3. Android Secure Credential Storage

**Blocked by:** None

A working module and package exist uncommitted (`VsisSecureStorageModule.kt`, `VsisSecureStoragePackage.kt`), registered at `MainApplication.kt:17`. AES-256-GCM under Android Keystore with ciphertext and IV in private SharedPreferences is already in place. Remaining work:

- Make overwrite atomic. `write` uses `prefs.edit().apply()` (`:89-92`), which is asynchronous and can leave ciphertext and IV inconsistent across a crash. Use `commit()` or a single combined value.
- Distinguish `locked` from `read-failed`. `read` maps every exception to `read-failed` (`:71-73`), so a user-not-authenticated or key-permanently-invalidated Keystore failure is indistinguishable from corruption, and the JavaScript contract cannot surface the locked state it defines.
- Stop returning exception text to JavaScript. `${e.message}` (`:72,96,106`) can carry provider and key detail; the JavaScript layer discards it, so it only widens the surface.
- Treat undecryptable ciphertext as `corrupt` and self-heal by clearing, rather than leaving the app permanently unable to read.
- Decide `clearLegacy` semantics. It currently resolves unconditionally (`:111-113`), which satisfies the idempotent no-op contract only if no Android legacy artifact is ever identified. Record the decision either way.
- Confirm no credential payload reaches logcat.
- Produce installed-build evidence: write, kill, restore, logout, and a SharedPreferences XML inspection proving only ciphertext and IV are at rest.

### 4. iOS Secure Credential Storage

**Blocked by:** None

Nothing exists yet; `mobile/ios/` contains only `AppDelegate.swift`.

- Implement the React Native Swift bridge using a Keychain generic-password item, on the legacy `NativeModules` bridge through new-architecture interop. `newArchEnabled=true` and `RnwNewArch=true` are set but the project has no `codegenConfig`, and the JavaScript side reads `NativeModules` directly (`mobile/src/platform/secure-storage/native.ts:1,25`).
- Add the bridging-header build setting; `mobile/ios/mobile.xcodeproj/project.pbxproj` currently compiles only `AppDelegate.swift` and defines no `SWIFT_OBJC_BRIDGING_HEADER`.
- Use device-only accessibility and fixed service/account identifiers.
- Provide atomic replacement and idempotent deletion.
- Map locked, corrupt, read, write, and deletion failures to the existing JavaScript error contract (`mobile/src/platform/secure-storage/types.ts:6-22`). iOS is the platform that can most cleanly express `locked` via `errSecInteractionNotAllowed`, so use it as the reference for the Android and Windows mappings.
- Match whichever absence representation slice 5 settles on, so all three platforms agree.

### 5. Windows Secure Credential Storage

**Blocked by:** None

A `PasswordVault`-backed module exists uncommitted at `mobile/windows/VsisTimesheetMobile/VsisSecureStorage.h`, included in `VsisTimesheetMobile.cpp:10` and listed in both `VsisTimesheetMobile.vcxproj:104` and `VsisTimesheetMobile.vcxproj.filters:27`. Source and header entries are configuration-agnostic across all six configurations (`VsisTimesheetMobile.vcxproj:24-49`), and `windowsapp.lib` was already linked (`:86`), so no per-configuration or dependency change was needed. Remaining work:

- Resolve the empty-string-as-absent contract. `read` resolves `""` for a missing credential (`:26,37`) because `ReactPromise<std::string>` cannot resolve `null`, which is why the JavaScript side was changed to `!raw`. Either accept this deliberately and document it in the JavaScript contract, or return an optional so the platform can express absence directly.
- Narrow the swallowed exceptions in `write` (`:53`) and `clear` (`:76`). `catch (...) {}` around `Retrieve`/`Remove` also swallows genuine vault failures, so a `write` can silently leave a stale credential and a `clear` can silently fail to delete. Distinguish not-found from every other error, as `read` already does at `:25`.
- Make replacement atomic or, failing that, ordered so a crash between `Remove` (`:52`) and `Add` (`:60`) cannot leave no credential where one is required.
- Map vault-locked and corrupt-value conditions to the `locked` and `corrupt` contract codes; only `read-failed`, `write-failed`, and `delete-failed` are produced today.
- Stop returning `ex.message()` to JavaScript (`:29,40,63,79`); the JavaScript layer discards it.
- Decide `clearLegacy` semantics; it resolves unconditionally (`:86-88`).
- Confirm Debug and Release x64 builds include the module, and inspect Credential Manager to prove only the application's entry is written and removed.

### 6. Distributed Rate Limiting

**Blocked by:** Slices 0 and 1, and approved Supabase migration identity

- Add forward-only native (`0024_*.sql`) and Supabase migrations for hashed rate-limit subjects, counters, reset timestamps, and cleanup bounds.
- Replace the seven exported `Map` objects with an asynchronous reserve/release contract carrying a reservation handle, and adapt all 58 invocation lines across 15 files plus the 10 `getRetryAfter` call sites.
- Implement atomic reservation plus compensating release so concurrent instances cannot exceed configured limits.
- Preserve current failed-auth and successful-mutation counting semantics. Decide explicitly whether the unconditional batch charging at `lib/api/v1/services/timesheets.ts:285,495` — which diverges from the actions layer's `if (updated > 0)` — carries forward or is corrected.
- Derive subjects with an HMAC keyed by the slice 0 secret, not bare SHA-256. The two existing precedents (`lib/auth/mobile-tokens.ts:42`, `lib/db/password-recovery.ts:21`) hash 32-byte random tokens where unkeyed digests are sound; emails and IPv4 addresses are fully enumerable and an unkeyed digest of them is reversible by dictionary.
- Pass the evaluation timestamp as a bound SQL parameter. `tests/rate-limit.test.ts` uses no fake timers — determinism comes entirely from an explicit `now` argument — so without this the 11 existing assertions lose their anchor.
- Add repository methods for asynchronous reserve, release, and cleanup. They must be actor-less, since login and signup gate pre-authentication; the precedent is `findWhitelistedDomain(domain)`.
- For the Supabase RPC:
  - Use `SECURITY DEFINER` only because it is server-only.
  - Fully qualify database objects.
  - Pin `search_path = public, pg_temp`.
  - Revoke execution from `PUBLIC`, `anon`, and `authenticated`.
  - Grant execution only to `service_role`.
  - Add a hand-written guard block to `tests/supabase-migrations.test.ts`. That file has no generic SECURITY DEFINER rule, so an unguarded RPC passes silently. Match the `bulk_update_timesheets` template at `:84-114`: exactly one defining migration, `security definer`, the exact `search_path` string, the verbatim argument-type list in the revoke and grant assertions, and a negative assertion against permissive grants.
- Storage-failure policy, split by path:
  - Write and import budgets fail closed. Never fall back to process memory.
  - Pre-authentication gates (login, signup, domain-check, password-reset) fall back to a bounded in-process window with an error log and a metric, and never silently bypass enforcement. Failing closed here would convert a login flood into 5xx for legitimate users: `DB_POOL_MAX` defaults to 10 (`lib/db/pool.ts:46`) and every query awaits `ensureMigrated()` (`:79-86`), so pool exhaustion on the attacked path would take authentication down.
- Schedule cleanup rather than relying on an endpoint nothing invokes. There is no `CronJob` manifest in `deploy/`, no `vercel.json`, and no scheduler in CI, so either add a `CronJob` alongside the protected endpoint or retain opportunistic SQL-side expiry. Today `prune()` runs on every peek and consume (`lib/rate-limit.ts:68,91`), so expiry is automatic and moving it to an uncalled endpoint would let the table grow unbounded.
- Update all 14 test files that manipulate the exported stores directly, not just `tests/rate-limit.test.ts`:
  - `rate-limit`, `actions`, `actions-extra`, `auth-routes`, `domain-check-route`, `signup-route`, `password-recovery-routes`, `mobile-login-route`, `mobile-change-password-route`, `mobile-signup-v1-route`, `mobile-timesheet-duplicate-route`, `mobile-timesheets-route`, `mobile-leaves-route`, `mobile-reminders-route`.
  - Three pre-seed exhausted budgets via `.set()` with hand-computed `resetAt` (`mobile-timesheets-route.test.ts:216`, `mobile-leaves-route.test.ts:86`, `mobile-reminders-route.test.ts:104`) and need an equivalent seam.
  - The `?.count === 1` assertions in `tests/actions.test.ts` and `tests/actions-extra.test.ts` are the only automated proof of success-only charging; replace them with equivalent assertions against the new storage rather than deleting them.

### 7. Supabase Refresh Rotation: Re-establish Known State and Harden `search_path`

**Blocked by:** Approved migration identity, release-owner database access

The corrected body already exists in `20260905000000_fix_mobile_session_rotation.sql:41-127`, and family revocation is present in both replay branches. The deliverables are therefore a `search_path` hardening migration under an approved identity, plus live evidence of which body each environment actually holds.

- Back up each target environment.
- Inspect the live function definition, ownership, `prosecdef`, `search_path`, ACL, and migration history.
- Generate — never invent — an approved post-head forward migration.
- Recreate the corrected, fully qualified rotation function with:
  - `search_path = public, pg_temp`
  - Execution revoked from `PUBLIC`, `anon`, and `authenticated`
  - Execution granted only to `service_role`
- Apply the migration first to a disposable or nonproduction database.
- Run Supabase security advisors.
- Update `tests/supabase-migrations.test.ts:196-221`: the current test asserts the hardened migration is **absent** and will fail once it is staged. Replace the quarantine assertion with body, `search_path`, grant, and ordering assertions against the approved identity.
- Close the rotation test gaps, none of which exist today:
  - Assert `mockRpc` call arguments, so the RPC name and parameter names — the exact surface the ambiguity bug breaks — are covered.
  - Add the first family-revocation assertions; `family_id` currently appears only as fixture data.
  - Make `nativeRotate` reachable under test. `NEXT_PUBLIC_BACKEND` is unset in the test environment, so `IS_NATIVE` is false and the `mockQuery`/`mockTransaction` mocks at `tests/mobile-session-store.test.ts:4-13` are dead code.
- Test successful rotation, replay detection, family revocation, expiry, and concurrent refresh attempts.
- Decide whether to repair the two native/Supabase divergences in `revokeSession` and `revokeAll`, where native preserves the original `revoked_at` and Supabase overwrites it (`lib/auth/mobile-session-store.ts:295,300` versus `:426,432-439`).
- Promote through the approved release process.
- Repeat read-only inspection and a controlled production smoke test.

### 8. Bearer Authentication Rollout Gate

**Blocked by:** Slices 2–7

- Keep the default rollout flag disabled until all platform evidence passes.
- Commit the uncommitted native modules before gathering evidence, so the artifacts under test correspond to a reviewable tree. `git status` currently shows the Android and Windows modules and the JavaScript contract change as untracked or modified.
- Test Android, iOS, and Windows against both native and Supabase backends.
- Verify:
  - Login and secure credential write
  - Process termination and session restoration
  - Access-token refresh
  - Concurrent protected requests
  - Logout and credential deletion
  - Global session revocation
  - Reused refresh-token handling
  - Locked or corrupt storage
  - Server unavailability
- Confirm access tokens remain memory-only.
- Confirm credentials never appear in these concrete artifacts: `localStorage['vsis_timesheet_secure_tokens']`, `%LOCALAPPDATA%/vsis-timesheet-workspace.json`, offline-queue keys, Android private SharedPreferences XML, an iOS Keychain dump, the Windows Credential Manager, and logs, snapshots, analytics, or crash output. AsyncStorage is not a dependency of this project.
- Enable bearer authentication only in deployments whose transport, storage, distributed-rate-limit, and rotation evidence all passed.

### 9. Security Review Report

**Blocked by:** Slices 1, 2, and 8

- Author `docs/security/SECURITY_REVIEW.md`. No prior report exists in the repository; the document being superseded is external, so this is new authoring under corrected drafting rules.
- Add the report to the `docs/README.md` index.
- Distinguish between:
  - Source inspection
  - Unit and static tests
  - Installed-device evidence
  - Live-database evidence
- State "no user-controlled SQL interpolation found" rather than any absolute claim about template interpolation.
- Make CVSS scores and qualitative severities consistent.
- Treat HSTS as a verified deployment control rather than an application-code assumption.
- Mark controls as verified only where corresponding evidence exists.
- Record unresolved items as open rather than resolving to a predetermined rating.

## Verification Plan

### Server and Database

```powershell
npx vitest run tests/health-route.test.ts tests/mobile-cron-cleanup.test.ts tests/rate-limit.test.ts tests/supabase-migrations.test.ts tests/ip.test.ts tests/mobile-session-store.test.ts tests/mobile-refresh-route.test.ts
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run e2e
```

Run the full suite, not only the named files: 14 test files touch the rate-limit stores directly.

Note that `lib/rate-limit.ts` is outside the coverage include list (`vitest.config.mts:24-30`), so CI's 60% thresholds neither constrain nor validate the new limiter code.

Add native and Supabase integration tests proving that parallel workers cannot exceed the configured limit.

Build both backend modes, supplying the placeholders CI uses:

```powershell
$env:NEXT_PUBLIC_BACKEND = 'supabase'
$env:NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon-key'
npm run build

$env:NEXT_PUBLIC_BACKEND = 'native'
$env:DATABASE_URL = 'postgres://placeholder:placeholder@localhost:5432/vsis'
$env:AUTH_SECRET = 'placeholder-secret-at-least-32-chars-long'
npm run build
```

### Mobile

From `mobile/`:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:windows
npm run package:android
npm run windows:release
```

`npm run test:windows` is a JavaScript regression run on a Windows host, not native-platform evidence: `jest.config.windows.js` is identical to `jest.config.js` and its header records that react-native-windows is not exposed to Jest. Windows evidence comes from the Release x64 build plus a Credential Manager inspection.

Produce an iOS registered-device or TestFlight build and record the same smoke-flow evidence used for Android and Windows.

### Deployment

- Confirm HTTP returns a permanent redirect to HTTPS at the nginx Ingress.
- Confirm HTTPS returns:

```text
Strict-Transport-Security: max-age=31536000
```

- Confirm the header excludes `includeSubDomains` and `preload`.
- Confirm the OpenShift Route emits the same header.
- Confirm `getClientIp` resolves a real client address under the deployed proxy topology and never returns `direct-client`.
- Confirm `/api/health` is minimal when `HEALTH_DEBUG` is unset.
- Confirm cron cleanup returns:
  - 503 when `CRON_SECRET` is unset
  - 403 for an invalid secret
  - 200 only for an exact valid secret
- Confirm the rate-limit cleanup schedule actually fires.

### Supabase

- Compare local and remote migration histories, accounting for version `20260905000000` having carried three different bodies across branches.
- Inspect the deployed rotation function and grants directly; the migration list alone cannot identify which body is installed.
- Run the security advisor after migration.
- Using a controlled test account:
  1. Issue a refresh token.
  2. Rotate it successfully.
  3. Replay the old token.
  4. Confirm the family is revoked.
  5. Confirm the replacement token is rejected afterward.
- Do not retain raw access or refresh tokens in evidence artifacts.

## Rollout and Recovery

- Deploy additive database migrations before dependent application code. In native mode the two are coupled: `lib/db/pool.ts:79-86` awaits `ensureMigrated()` on every query, so the application deploy performs the migration. Only the Supabase half is a separate `supabase db push`.
- Roll application code back without dropping newly added tables if deployment fails.
- Keep bearer authentication disabled during partial rollout.
- Capture the existing live Supabase function definition before replacement as a rollback artifact.
- Roll out TLS changes to nonproduction first and verify controller compatibility before production.
- Treat write-budget storage failures as service errors. Treat pre-authentication storage failures as degraded enforcement with alerting, never as bypass.

## Out of Scope

- Redesigning access-token formats, session lifetimes, or authentication routes.
- Changing Server Action names or signatures.
- Adding a new credential-storage library or external cache service.
- Enabling HSTS preload or applying it automatically to all subdomains.
- Unrelated RLS, schema, dependency, or UI refactors.
- A new application-wide dependency audit.
- Tightening `deploy/networkpolicy.yaml`, whose ingress rule has no `from:` selector and therefore admits port 3000 from any pod despite its comment. Track separately.

## Assumptions and Stop Conditions

- Direct OS-native storage modules remain the selected approach, on the legacy `NativeModules` bridge.
- The Android and Windows modules currently in the working tree are the baseline for slices 3 and 5; they are not reviewed or committed, and their gaps are enumerated in those slices.
- `HEALTH_DEBUG=true` is an explicit diagnostic exposure and is permitted only on restricted environments.
- TLS certificates are supplied through the deployment platform's secret-management process.
- Migration filenames are generated through the approved release process. Record the approver, approval date, and generation method in the notes file before staging any Supabase filename; the history audit currently records this policy as pending with no approver.
- Stop the affected slice if:
  - Migration identity is not approved.
  - A recoverable database backup is unavailable.
  - Live Supabase inspection access is unavailable.
  - The ingress controller does not support the planned TLS/HSTS configuration.
  - Vercel project access is unavailable for HSTS verification.
  - The proxy topology cannot be determined well enough to set `TRUSTED_PROXY_HOPS`.
  - Required signing accounts, physical devices, or installed-build access are unavailable.
- Record deviations, verification output, and final evidence in `docs/plans/SECURITY_REVIEW_REMEDIATION_NOTES.md`.
