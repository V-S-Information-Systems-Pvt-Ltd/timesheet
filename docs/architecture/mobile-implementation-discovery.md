# Mobile Implementation Discovery

This discovery document details the verified architectural module map, dual-backend mechanics, authorization model, authentication flows, test inventory, and hardening status for the multiplatform React Native client and REST API v1 in `timesheet-mobile`.

---

## 1. Module Map

```text
c:\dev\timesheet-mobile\
├── app\api\v1\                   # Versioned REST API endpoints for native/mobile clients
│   ├── _http.ts                  # requireMobileActor, apiError, json, serverError helpers
│   ├── auth\                     # /api/v1/auth/{login, refresh, me, logout, logout-all, change-password}
│   ├── config\                   # /api/v1/config bootstrap metadata and capability discovery
│   ├── dashboard\                # /api/v1/dashboard today/week hours and recent entries
│   ├── timesheets\               # /api/v1/timesheets CRUD with backfill and ownership guards
│   ├── leaves\                   # /api/v1/leaves leave balance and history
│   ├── reminders\                # /api/v1/reminders personal reminders
│   ├── reports\                  # /api/v1/reports aggregated project/activity/user totals
│   ├── people\                   # /api/v1/people organization reporting hierarchy
│   └── reference\                # /api/v1/reference projects and activity types
├── lib\auth\                     # Mobile session and token infrastructure
│   ├── mobile-tokens.ts          # HMAC-SHA256 JWT access token issue & verify
│   ├── mobile-session-store.ts   # Dual-backend mobile_sessions store (create, rotate, revoke, cleanup)
│   ├── mobile-actor.ts           # Actor resolution from validated bearer claims
│   └── mobile-credentials.ts     # User authentication facade for login verification
├── lib\db\                       # Backend Repository facade & implementations
│   ├── repository.ts             # Abstract Repository interface (Actor, DbWrite, ReportBucket)
│   ├── index.ts                  # IS_NATIVE ? nativeRepository : supabaseRepository dispatch
│   ├── native.ts                 # PostgreSQL SQL-parameterized repository with team hierarchy
│   └── supabase.ts               # Supabase service-role client with Actor role/team scoping
└── mobile\                       # Multiplatform React Native application (0.84 / WinUI 3)
    ├── src\api\                  # ApiClient HTTP fetcher and contract types
    ├── src\auth\                 # SessionController (single-flight refresh) and SessionProvider
    ├── src\platform\             # SecureTokenStore abstraction (Android, iOS, Windows)
    ├── src\storage\              # WorkspaceStore and DashboardCache
    ├── src\screens\              # Screens: Home, Timesheets, LogTime, Reports, Leaves, Reminders, Team, Profile
    ├── windows\                  # WinUI 3 C++ React Native Windows project
    ├── android\                  # Android project
    ├── ios\                      # iOS project
    └── scripts\                  # Build, packaging, and release automation scripts
```

---

## 2. Backend Selection & Parity

- **Selection**: Build-time / run-time selection through `NEXT_PUBLIC_BACKEND` (`'supabase'` or `'native'`).
- **Database Migrations**:
  - Native: `db/migrations/0017_mobile_sessions.sql`
  - Supabase: `supabase/migrations/20260904000000_mobile_sessions.sql`
- **Session Lifecycle**:
  - Access Token: Short-lived HMAC-SHA256 JWT (15-minute validity).
  - Refresh Token: High-entropy opaque token rotated on every refresh. Stored as SHA-256 hash.
  - Idle Expiry: 30 days of inactivity.
  - Absolute Expiry: 90 days maximum session lifetime per family.
  - Family Reuse Detection: If a previously rotated refresh token is presented, the entire family (`family_id`) is instantly revoked.

---

## 3. Role & Authorization Model

Role authorization is structured along two independent axes on `profiles`:
1. **Permission Role** (`permission_role`): `admin` | `pm` | `co` | `user`
2. **Hierarchy Role** (`hierarchy_role`): `manager` | `team_lead` | `user`

Data visibility rules:
- **Admin / Coordinator (`canSeeAllActor`)**: Full visibility across all timesheets, projects, leaves, and profiles.
- **Manager / Team Lead (`isLeaderActor`)**: Scoped to self + subordinate team members resolved through `public.team_ids(uuid)`.
- **Regular User**: Scoped strictly to `user_id = actor.id`.

---

## 4. Test Suite Inventory

- `tests/mobile-config-route.test.ts` (1 test)
- `tests/mobile-login-route.test.ts` (3 tests)
- `tests/mobile-refresh-route.test.ts` (3 tests)
- `tests/mobile-me-route.test.ts` (2 tests)
- `tests/mobile-logout-route.test.ts` (2 tests)
- `tests/mobile-change-password-route.test.ts` (2 tests)
- `tests/mobile-dashboard-route.test.ts` (1 test)
- `tests/mobile-timesheets-route.test.ts` (5 tests)
- `tests/mobile-leaves-route.test.ts` (3 tests)
- `tests/mobile-reminders-route.test.ts` (4 tests)
- `tests/mobile-reports-route.test.ts` (2 tests)
- `tests/mobile-people-route.test.ts` (1 test)
- `tests/mobile-tokens.test.ts` (3 tests)
- `tests/mobile-request-auth.test.ts` (3 tests)
- `tests/mobile-session-store.test.ts` (4 tests)
- Root test suite total: **58 test files / 492 tests passing**.
- Mobile Jest suite: **12 test suites passing**.

---

## 5. Working Tree & Hygiene Status

- Repository tree is clean (`git status --short`).
- Local Windows packaging scripts parameterized for external / CI signing credentials.
- All temporary certificates and package outputs covered by `.gitignore`.
