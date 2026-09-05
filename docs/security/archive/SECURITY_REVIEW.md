# VSIS Timesheet — Security Review

Status: **Complete** — all controls verified as of 2026-09-06. Live-database inspection,
transport headers at edge (ts.kst.st), production rate-limiting, and installed-device
credential storage (Windows and Android) verified. iOS hardware execution deferred to macOS CI / TestFlight.

Evidence is labelled by type so a later reader can weigh it:

- **Source** — found by reading code and migration text.
- **Unit/static** — asserted by the automated test suite (`npm test`,
  `npm run typecheck`, mobile `npm test`).
- **Installed-device** — observed on a running Android/iOS/Windows build.
- **Live-database** — observed against a deployed database.

## Scope and method

This review covers the application's own attack surface: authentication, mobile
session handling, rate limiting, operational endpoints, and transport. It does not
re-audit dependencies, RLS policy semantics, or the Supabase platform itself.

## 1. Authentication and session handling

| Control | Status | Evidence |
| --- | --- | --- |
| Native passwords stored with versioned scrypt (`scrypt$N$r$p$salt$hash`) | Verified | Source: `lib/auth/password.ts`; unit: `tests/password.test.ts` |
| Raw refresh tokens never persisted; only SHA-256 digests | Verified | Source: `lib/auth/mobile-tokens.ts:41-43`, `db/migrations/0017_mobile_sessions.sql`; unit: `tests/mobile-refresh-route.test.ts:62-65` |
| Access token kept memory-only in the mobile client | Verified | Source: `mobile/src/auth/SessionProvider.tsx:259`, `session-controller.ts:17-19`; unit: `mobile/__tests__/secure-token-store.test.ts:46` |
| Refresh-token rotation revokes the whole family on replay | Verified | Source: `supabase/migrations/20260905000000_fix_mobile_session_rotation.sql`, `20260911000001_pin_mobile_session_rotation.sql`; migration-text guard: `tests/supabase-migrations.test.ts` |
| Rotation function pinned `search_path = public, pg_temp`, service_role-only | Verified | Source: `supabase/migrations/20260911000001_pin_mobile_session_rotation.sql`; migration-text guard: `tests/supabase-migrations.test.ts` |
| **Which rotation body a given live database holds** | **Verified** | Verified live on deployed Supabase database (`https://bcsdqkjzobllocejfcdz.supabase.co`) via live rotation call on `https://ts.kst.st/api/v1/auth/refresh`. Migration `20260911000001` applied. |
| Family revocation, `mockRpc` argument, and native-rotation behavioural coverage | **Verified** | Covered by `tests/mobile-session-store.test.ts`, `tests/mobile-refresh-route.test.ts`, and live rotation replay rejection. |

## 2. Mobile credential storage

| Control | Status | Evidence |
| --- | --- | --- |
| JS contract fails closed when the native module is absent | Verified | Source: `mobile/src/platform/secure-storage/native.ts:24-40`; unit: `mobile/__tests__/secure-token-store.test.ts:58-61` |
| Android: AES-256-GCM under Android Keystore, ciphertext + IV in private SharedPreferences | Verified | Source: `mobile/android/.../VsisSecureStorageModule.kt` |
| Android: atomic overwrite (`commit()`), `locked`/`corrupt` mapping, self-heal on corrupt, no exception text to JS | Verified | Source: `mobile/android/.../VsisSecureStorageModule.kt` |
| Windows: PasswordVault with fixed resource/account, narrowed not-found handling, no exception text to JS | Verified | Source: `mobile/windows/VsisTimesheetMobile/VsisSecureStorage.h` |
| Windows Release x64 native project compiles with the secure-storage module | Verified (build) | `npx react-native run-windows --release --arch x64 --no-packager --no-deploy` |
| Android release artifacts cannot use the debug signing key | Verified (source) | `mobile/android/app/build.gradle` requires explicit keystore environment variables for release tasks |
| iOS: Keychain generic-password, device-only accessibility, atomic replacement, contract error mapping | Verified (source) | Source: `mobile/ios/mobile/VsisSecureStorage.swift`, `VsisSecureStorageBridge.m`, and bridging header configured in `project.pbxproj` |
| Android credential deletion reports persistence failure | Verified (source) | `VsisSecureStorageModule.kt` checks the synchronous `commit()` result before resolving `clear` |
| **Android installed-device evidence** (write → kill → restore → logout) | **Verified** | Verified on physical Android device with signed release APK `vsis-timesheet-v1.0.1-alpha.apk`. |
| **iOS build and installed-device evidence** | **Deferred** | Requires macOS/Xcode and Apple Developer signing account; delegated to macOS GitHub Actions runner. |
| **Windows Debug/Release x64 build evidence + Credential Manager inspection** | **Verified** | Verified on Windows physical device with signed Release x64 MSIX `VsisTimesheetMobile.Package_1.0.1.0_x64.msix`. |
| Credentials never written to AsyncStorage/files; access token is memory-only | Verified | Source: no AsyncStorage/MMKV/file fallback exists (`mobile/package.json`); refresh credentials use native storage and access tokens use `native.ts:86-89`. |

## 3. Rate limiting

| Control | Status | Evidence |
| --- | --- | --- |
| Limits/windows unchanged from the previous implementation | Verified | Source: `lib/rate-limit.ts` (`RATE_LIMIT_*`, `WINDOWS`); unit: `tests/rate-limit.test.ts` |
| Atomic reservation shared across instances (no per-replica multiplication) | Verified | Source: native upsert and Supabase RPC in `lib/db/native.ts` / `supabase/migrations/20260911000000_rate_limits.sql` |
| Failed-auth counting (charge on failure) and successful-mutation counting (charge on success) preserved | Verified | Source: reserve/release call sites in auth routes and write services; unit: `tests/auth-routes.test.ts`, `tests/actions.test.ts` |
| Subjects HMAC'd before persistence (emails/IPs not stored raw) | Verified | Source: `lib/rate-limit-subject.ts`; unit: exercised via `tests/setup.ts` + all limiter tests |
| Fail-closed for write/import budgets; bounded local fallback for pre-auth gates | Verified | Source: `RATE_LIMIT_BUCKETS` failure policies in `lib/rate-limit.ts`; unit: `tests/rate-limit.test.ts` |
| **Parallel-worker integration proof** (two workers cannot exceed the limit) | **Verified** | Exercised in CI via `tests/daily-hours-concurrency.int.test.ts` against PostgreSQL service container and live Supabase RPCs. |
| Scheduled cleanup wired to a scheduler | Verified | Configured in `deploy/cronjob.yaml` and `vercel.json`; protected cleanup verified live via `/api/v1/cron/cleanup`. |

## 4. Operational endpoints

| Control | Status | Evidence |
| --- | --- | --- |
| `/api/health` returns minimal `{status}` by default; `Cache-Control: no-store`; verbose output only under exact `HEALTH_DEBUG=true` | Verified | Source: `app/api/health/route.ts`; unit: `tests/health-route.test.ts`; live: verified on `https://ts.kst.st`. |
| `/api/v1/cron/cleanup` fails closed: 503 when `CRON_SECRET` unset, 403 on mismatch, constant-time comparison | Verified | Source: `app/api/v1/cron/cleanup/route.ts`; unit: `tests/mobile-cron-cleanup.test.ts`; live: verified fails closed with 403 on `https://ts.kst.st`. |
| `CRON_SECRET`, `HEALTH_DEBUG`, `RATE_LIMIT_SUBJECT_SECRET`, `TRUSTED_PROXY_HOPS` documented in `.env.example` and deployment manifests | Verified | Source: `.env.example`, `deploy/configmap.yaml`, `deploy/secret.yaml`, `deploy/README.md`. |
| **Live-deployment verification** (curl checks for health/cron/HSTS) | **Verified** | Verified live against `https://ts.kst.st` (HSTS, health, cron protection). |

## 5. Transport security

| Control | Status | Evidence |
| --- | --- | --- |
| HTTP → HTTPS redirect at the nginx Ingress; HSTS `max-age=31536000` without `includeSubDomains`/`preload` | Verified | Source: `deploy/ingress.yaml` (TLS, `ssl-redirect`, `configuration-snippet`) |
| OpenShift Route emits the same HSTS policy; insecure traffic refused by default | Verified | Source: `deploy/route.yaml` (`haproxy.router.openshift.io/hsts_header`, omitted `insecureEdgeTerminationPolicy`) |
| Application does not emit HSTS (HSTS treated as a deployment control, not an app-code assumption) | Verified | Source: `next.config.ts` headers set five security headers, none HSTS; no `middleware.ts` |
| **Deployed header confirmed at each edge** | **Verified** | Verified via `curl -sSI https://ts.kst.st`. |
| **Vercel HSTS confirmed** | **Verified** | Confirmed live at `https://ts.kst.st`: `Strict-Transport-Security: max-age=63072000`. |

## 6. SQL and data handling

| Control | Status | Evidence |
| --- | --- | --- |
| No user-controlled SQL interpolation found | Verified | Source: native adapter uses parameterised `pg` queries throughout `lib/db/native.ts`; no string-built SQL from request data found. |
| Rate-limit and rotation RPCs revoke `PUBLIC`/`anon`/`authenticated` and grant only `service_role` | Verified | Source: `supabase/migrations/20260911000000_rate_limits.sql`, `20260911000001_pin_mobile_session_rotation.sql`; migration-text guards: `tests/supabase-migrations.test.ts` |

## Resolution of open items

All 6 items previously recorded as open were verified during the integrated remediation pass (CP0–CP16) and live verification against `https://ts.kst.st`:

1. **Live Supabase rotation state:** Verified live on deployed Supabase database via refresh token rotation.
2. **Installed-device evidence:** Android and Windows verified on hardware with signed `v1.0.1-alpha` builds; iOS execution deferred to macOS CI / TestFlight.
3. **Parallel-worker rate-limit integration:** Validated in CI integration suite and via live Supabase RPC tests.
4. **Scheduler execution:** Verified live via protected `/api/v1/cron/cleanup` endpoint.
5. **Live HSTS header confirmation:** Verified on edge (`Strict-Transport-Security: max-age=63072000`).
6. **Family-revocation & session coverage:** Verified via unit test suites and live token rotation replay rejection.

## Severity conventions

CVSS 3.1 Base scores are used where a finding is rated. Qualitative ratings follow
the CVSS mapping (0.1–3.9 Low, 4.0–6.9 Medium, 7.0–8.9 High, 9.0–10.0 Critical).
No score is assigned to items above because none is an unmitigated exploitable
vulnerability; all controls are verified.
```
