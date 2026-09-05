# Security Remediation — Verification Notes

This file records the approvals, deviations, and verification output for the
security remediation pass. It is the evidence ledger the plan points at.

## Migration identity approval

- **Status:** Approved
- **Approved by:** Sathindra
- **Approved on:** 2026-09-04
- **Generation method:** monotonic post-head timestamps after the previous head
  `20260910000000`:
  - `20260905000001_ensure_mobile_sessions.sql` — additive table existence bridge.
  - `20260911000000_rate_limits.sql` — shared rate-limit counters + RPCs.
  - `20260911000001_pin_mobile_session_rotation.sql` — hardened rotation body.
- **Rationale:** Monotonic post-head timestamps preserve migration order and
  resolve the historical version collision without renaming applied migrations.
  Live database application remains gated on operator backup and snapshot audit.

## Slices delivered in code

| Slice | Deliverable | Evidence |
| --- | --- | --- |
| 0 | `TRUSTED_PROXY_HOPS`, `RATE_LIMIT_SUBJECT_SECRET`, `CRON_SECRET`, `HEALTH_DEBUG` in `.env.example`, `deploy/configmap.yaml`, `deploy/secret.yaml`, `deploy/README.md`; `getClientIp` regression tests | `tests/ip.test.ts` |
| 1 | Minimal health + `HEALTH_DEBUG` + no-store; cron fails closed (503/403, constant-time) | `app/api/health/route.ts`, `app/api/v1/cron/cleanup/route.ts`, `tests/health-route.test.ts`, `tests/mobile-cron-cleanup.test.ts` |
| 2 | Ingress TLS/ssl-redirect/HSTS; Route HSTS; deploy README transport section | `deploy/ingress.yaml`, `deploy/route.yaml`, `deploy/README.md` |
| 3 | Android Keystore module hardened (atomic commit, locked/corrupt codes, self-heal, no exception text) | `mobile/android/.../VsisSecureStorageModule.kt` |
| 4 | iOS Keychain Swift module + Objective-C bridge shim + bridging header + pbxproj registration | `mobile/ios/mobile/VsisSecureStorage.swift`, `VsisSecureStorageBridge.m`, `VsisSecureStorage-Bridging-Header.h` |
| 5 | Windows PasswordVault module hardened (narrowed catches, absence contract, no exception text) | `mobile/windows/VsisTimesheetMobile/VsisSecureStorage.h` |
| 6 | Distributed reserve/release rate limiting: native + Supabase migrations, repo methods, async API, all call sites, 14 test files, vitest setup for subject secret | `lib/rate-limit.ts`, `lib/rate-limit-subject.ts`, `lib/db/*`, `db/migrations/0024_rate_limits.sql`, `supabase/migrations/20260911000000_rate_limits.sql`, `tests/*` |
| 7 | Rotation pin with `search_path = public, pg_temp`; migration-text guards flipped | `supabase/migrations/20260911000001_pin_mobile_session_rotation.sql`, `tests/supabase-migrations.test.ts` |
| 9 | Security review authored; docs index entry | `docs/security/SECURITY_REVIEW.md` |
| 10 | Windows Release x64 compile blocker fixed; Android release signing now requires explicit keystore credentials; iOS/Android version metadata synchronized; root and mobile production dependency audits clean | `mobile/windows/VsisTimesheetMobile/VsisSecureStorage.h`, `mobile/android/app/build.gradle`, `mobile/ios/mobile.xcodeproj/project.pbxproj`, `scripts/bump-version.mjs`, `package-lock.json`, `mobile/package-lock.json` |
| 11 | Rate-limit fallback no longer evicts active subjects; password-change reservations release on unexpected service errors; Kubernetes and Vercel cleanup schedulers added | `lib/rate-limit.ts`, `app/api/v1/auth/change-password/route.ts`, `deploy/cronjob.yaml`, `vercel.json` |

## Decisions taken during implementation

- **Pre-auth storage failure policy:** bounded in-process fallback with loud
  logging (`local-fallback`); write/import budgets fail closed. Rationale: pool
  exhaustion on the attacked path must not become an authentication outage.
- **Absence contract on Windows:** `ReactPromise<std::string>` cannot resolve
  `null`, so the Windows module resolves `""` and the JS adapter treats empty as
  absent. Documented in `mobile/src/platform/secure-storage/native.ts`.
- **Batch services** (`batchDeleteTimesheetsService`,
  `batchDuplicateTimesheetsService`) now release the reservation when nothing was
  written (`deletedCount`/`duplicatedCount === 0`), correcting the previous
  unconditional charge and matching the actions layer.

## Verification output

```powershell
npx tsc --noEmit            # clean
npx vitest run              # 708 passed, 1 skipped
npm run lint                # see CI output
```

- `tests/health-route.test.ts` now sets `HEALTH_DEBUG=true` for the verbose-body
  assertions and adds a minimal-body/no-store test.
- `tests/rate-limit.test.ts` rewritten for the reserve/release API; shared fake
  store in `tests/helpers/rate-limit-store.ts`; `tests/setup.ts` pins a test
  subject secret.
- Both backend modes pass `npm run build` with placeholder configuration.
- Mobile `npm test`, typecheck, lint, and `npm audit --omit=dev` pass; the
  Windows Release|x64 native compile passes with deployment skipped.

## Still open (not code, requires environment access)

- Android/iOS/Windows installed-device evidence and the slice-8 bearer gate.
- Live Supabase rotation inspection + controlled smoke test (slice 7 live half).
- Parallel-worker rate-limit integration tests (needs `TEST_DATABASE_URL`).
- Applying `deploy/cronjob.yaml` and observing successful cleanup runs in each
  deployment environment.
- Live HSTS header confirmation per environment; Vercel project access.
- `deploy/networkpolicy.yaml` ingress rule has no `from:` selector (tracked
  separately in the plan's out-of-scope note).
