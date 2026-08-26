# VSIS Timesheet Multiplatform Implementation Plan

## 1. Objective

Build installable VSIS Timesheet applications for:

- Android
- iOS
- Windows 10/11

All day-to-day development will happen on the current Windows machine. Android
Studio and a local Mac are not required. Android and iOS binaries will be built
with a cloud build service. Windows binaries will be built locally and in a
Windows CI runner.

The existing Next.js application remains the web application and backend. The
new clients will use the same authorization rules, repositories, validation,
and database deployments rather than accessing PostgreSQL directly.

## 2. Recommended technical direction

Use a React Native application with React Native for Windows, TypeScript, and
Hermes. Keep Android, iOS, and Windows on the same React Native minor version.
At the start of implementation, pin the latest mutually supported stable pair;
as of 25 August 2026, React Native Windows 0.84 is in active support.

Use EAS Build for Android and iOS cloud builds. EAS supports existing React
Native projects, runs Android builds on Linux, and runs iOS builds on hosted
macOS workers. Use the React Native Windows CLI/MSBuild toolchain for Windows.

Why this direction:

- The current application is React 19 and TypeScript, so domain logic, schemas,
  API contracts, and developer skills can be reused.
- React Native Windows provides a native Windows target from the same React
  component model.
- EAS removes the requirement for Android Studio and Xcode on this machine.
- A WebView wrapper would reuse more HTML, but would not give a strong Windows
  solution, would preserve desktop-oriented dashboard behavior on phones, and
  would make authentication, file handling, and native navigation harder to
  maintain.

Do not depend on an unverified native package in the shared application layer.
Every native dependency must demonstrate Android, iOS, and Windows support in
the compatibility spike. Where no suitable Windows implementation exists, use
a small platform adapter or a Windows Turbo Native Module.

## 3. Current-codebase assessment

### Reusable without major changes

- `app/types.ts`: backend-neutral domain types.
- `lib/validation.ts` and `lib/validation-schemas.ts`: validation rules and Zod
  schemas.
- Pure TypeScript helpers such as dates, reports, hierarchy, roles, smart
  hours, CSV, layout, and shortcuts where they do not import browser APIs.
- `lib/db/repository.ts` and both repository implementations. The mobile app
  will reach these through the server API.
- Existing Vitest coverage, authorization tests, migration tests, and dual
  backend CI jobs.

### Reusable after extraction or refactoring

- Server Action logic in `app/actions/`: move the business operation into
  authenticated service functions and let both Server Actions and REST routes
  call those functions.
- `lib/data/client.ts`: keep its interface ideas, but create a base-URL-aware,
  bearer-token API client suitable for React Native.
- `lib/auth/client.ts`: retain the facade shape, but add native token lifecycle
  and secure storage.
- Visual tokens from `app/globals.css` and primitives from
  `app/components/ui.tsx`: convert colors, spacing, typography, radii, and
  component states into React Native tokens and components.

### Must be rewritten for native UI

- Next.js pages, HTML tables/forms, Tailwind classes, DOM dialogs, clipboard
  code, keyboard shortcut handling, and browser downloads.
- The dashboard's dense panel layout must become phone navigation and a
  responsive Windows layout.

### Backend gaps to close before feature work

- The existing REST surface is read-heavy. Timesheet writes, project/admin
  writes, user management, settings, layouts, import/export, and most
  super-admin operations exist only as Next.js Server Actions.
- Native authentication currently uses a same-origin HttpOnly cookie and REST
  mutations reject missing or cross-origin browser headers. A native client
  needs an explicit bearer-token flow.
- Supabase mode currently lets the browser talk directly to Supabase for much
  of its data. Mobile should use one versioned server API in both backend modes
  to prevent behavior and authorization drift.

## 4. Target repository structure

Keep the change additive so the existing Next.js, Docker, and deployment paths
do not need a disruptive move into a new directory.

```text
vsis-mobile/
  app/                         existing Next.js web UI and API
  lib/                         existing backend/auth/repository code
  mobile/
    android/                   generated React Native Android project
    ios/                       generated React Native iOS project
    windows/                   generated React Native Windows project
    src/
      app/                     providers and application bootstrap
      navigation/              shared route definitions
      screens/                 feature screens
      components/              cross-platform design system
      platform/                storage, files, links, notifications adapters
      state/                   query cache and session state
    eas.json                   Android/iOS build profiles
  packages/
    contracts/                 shared DTOs, Zod schemas, error envelopes
    core/                      platform-neutral domain helpers
    api-client/                typed HTTP client and token lifecycle
```

Use npm workspaces. Keep native project files checked in so EAS, Windows CI,
and developers build the same native configuration. Run EAS commands from the
`mobile` directory.

## 5. Backend and API design

### 5.1 Versioned API

Add `/api/v1` and define an OpenAPI document plus shared Zod request/response
contracts. Every endpoint returns a consistent envelope:

```ts
type ApiResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string; fieldErrors?: Record<string, string[]> } }
```

Keep existing Server Action names and signatures. Refactor each operation into
`lib/services/*` functions that accept an authenticated `Actor` and validated
input. Server Actions and API routes become thin authorization/transport
adapters around the same service.

Initial endpoint groups:

- `auth`: config, login, refresh, logout, me, signup, password change.
- `timesheets`: list, create, update, delete, duplicate, bulk update.
- `reference`: projects, activity types, backfill settings, titles.
- `people`: current profile, profiles, team hierarchy.
- `reports`: grouped totals and comparisons.
- `leave`, `reminders`, and `global-reminders`.
- `layouts`: user dashboard and admin layout.
- `admin`: users, projects, activity types, settings, whitelist, import/backup.
- `superadmin`: destructive operations, isolated and disabled in the native app
  unless explicitly enabled by policy.

Add idempotency keys to create/duplicate/import mutations so a network retry
cannot create duplicate time entries. Keep the database's 24-hour cap and
backfill checks as the final authority.

### 5.2 Mobile authentication

Support `Authorization: Bearer <access-token>` in addition to the current web
cookie flow.

- Use a short-lived access token held in memory.
- Use a rotating, revocable refresh token stored only in platform-secure
  storage: Android Keystore, iOS Keychain, and Windows PasswordVault.
- Store only a hash of each refresh token on the server, with device name,
  created time, last-used time, expiry, and revocation time.
- Add dual-backend migrations for the session table.
- Preserve the current cookie flow for the web app.
- Apply Origin/Referer CSRF checks to cookie-authenticated browser mutations;
  authenticate native bearer requests independently of browser origin.
- Require HTTPS outside local development and never embed service-role keys,
  database credentials, or `AUTH_SECRET` in the application.
- Recheck `is_active`, roles, hierarchy, and super-admin policy on every server
  operation rather than trusting token claims alone.

The first native build should target one server environment selected through a
build profile. A later internal-only setting may support choosing among
approved server URLs; arbitrary URLs should not be accepted in production.

### 5.3 Online and offline behavior

Version 1 is online-first:

- Cache reference data and recent reads for fast startup.
- Show stale cached entries when offline, clearly marked read-only.
- Do not queue time-entry writes offline in the first release because the
  24-hour cap, backfill window, concurrent edits, and role changes require a
  server decision.
- Retry safe reads automatically. Retry mutations only with an idempotency key
  and after the user can see the state.

Evaluate an offline mutation queue only after production usage demonstrates a
need and a conflict-resolution policy has been approved.

## 6. Application UX and feature scope

### Release 1: employee MVP

- Environment bootstrap, sign in/out, signup where enabled, pending approval,
  change password, and session recovery.
- Home summary with today's hours, recent entries, due reminders, and quick
  actions.
- Create, edit, delete, and duplicate time entries.
- Project/activity selection, smart hours, recent work, and backfill rules.
- Paginated entry history with date filters.
- Personal profile editing.
- Leave markers, personal reminders, and global-reminder dismissal.
- Personal reports, date presets, project filtering, and CSV share/save.
- Responsive navigation: bottom tabs on phones and navigation rail/sidebar on
  Windows and wide screens.

### Release 1.1: manager and coordinator capabilities

- Team/member filtering according to hierarchy.
- Team entries and reports.
- Period comparisons and exports.
- Keyboard accelerators and denser data grids on Windows.

### Release 2: administration parity

- User creation, activation, roles, hierarchy, and profile maintenance.
- Project and activity-type management.
- Backfill and reminder settings.
- Dashboard/admin layout configuration.
- Whitelisted domains, titles, import, backup, and restore.
- Explicit review before enabling reset, user deletion, or other super-admin
  operations in a mobile build. These may remain web-only without reducing the
  employee/manager application value.

## 7. Delivery phases and acceptance criteria

| Phase | Estimate | Main work | Exit criteria |
| --- | ---: | --- | --- |
| 0. Compatibility spike | 3-5 days | Generate a minimal React Native app; pin matching RN/RNW versions; create Android and iOS EAS development builds; build Windows x64 locally; test navigation, secure storage, date input, files, and networking | Installable hello-world artifacts on all three platforms; dependency compatibility report; no Android Studio or local Mac used |
| 1. Workspace and contracts | 1 week | Add workspaces, `contracts`, `core`, and `api-client`; extract shared types/schemas with compatibility re-exports | Existing web lint/typecheck/tests/build remain green in both backends; shared packages have unit tests |
| 2. API and authentication | 2-3 weeks | `/api/v1`, bearer/refresh sessions, dual migrations, service extraction, employee write endpoints, OpenAPI/contract tests | Android/iOS/Windows test clients can authenticate and complete a time-entry lifecycle against both backend modes |
| 3. App foundation | 1-2 weeks | Navigation, responsive shell, theme/tokens, query cache, forms, errors, secure session, logging | Authenticated shell works on phone and Windows layouts; token recovery/revocation tested |
| 4. Employee MVP | 3 weeks | Entries, profile, leave, reminders, personal reports and export | Release 1 feature acceptance suite passes on all platforms |
| 5. Manager features | 1-2 weeks | Team views, reports, filters, Windows productivity behavior | Role/hierarchy matrix matches repository tests and web behavior |
| 6. Admin parity | 2-3 weeks | Remaining API routes and administration screens | Agreed Release 2 scope passes admin and failure-path tests in both backends |
| 7. Hardening | 2 weeks | Accessibility, performance, poor-network behavior, security review, crash reporting, device QA | No critical accessibility/security findings; startup and key flows meet agreed performance budgets |
| 8. Release automation | 1 week | EAS profiles/submission, Windows MSIX, signing, CI gates, release runbook | A version tag produces signed candidate artifacts and provenance for all platforms |

Planning range:

- Employee MVP: approximately 8-10 calendar weeks for one experienced
  developer after accounts and test devices are available.
- Full manager/admin parity: approximately 14-18 calendar weeks for one
  developer.
- Two developers can overlap API and UI work, but platform stabilization and
  store review remain sequential; expect roughly 9-12 calendar weeks for full
  parity rather than half the single-developer duration.

The estimates include engineering and automated tests, but not delays for
store-account approval, procurement, or external security review.

## 8. Build and release model

### Android

- Build `development`, `preview`, and `production` profiles with EAS Build.
- Use internal-distribution APKs for testers and signed AABs for Google Play.
- EAS or Google Play manages signing credentials according to company policy.
- No Android Studio is installed. For local device log collection, install only
  Android platform tools (`adb`) if allowed; it is not required for cloud builds.

### iOS

- Build on EAS hosted macOS workers from this Windows checkout.
- Use an EAS development build or TestFlight on physical iPhones for runtime
  testing. There is no local iOS simulator on Windows.
- Manage distribution certificates/provisioning profiles through EAS or
  company-controlled credentials.
- Require Apple Developer Program and App Store Connect access before the first
  signed device build.

### Windows

- Develop and run with `npx react-native run-windows` from PowerShell.
- Produce Release x64 and, if required, ARM64 artifacts using MSBuild.
- Package and sign MSIX for internal distribution or Microsoft Store
  submission.
- Repeat the release build in a GitHub Actions `windows-*` runner to prove a
  clean, reproducible build.

### CI gates

Keep the existing web/backend jobs and add:

1. Shared packages: lint, typecheck, unit, contract, and API tests.
2. Mobile JavaScript: lint, typecheck, component tests, and bundle checks.
3. Windows: x64 Debug smoke build on pull requests; signed Release/MSIX on tags.
4. Android/iOS: EAS preview builds on release-candidate branches and production
   builds on approved tags.
5. Backend matrix: mobile API integration tests against both Supabase and
   native configurations.
6. Artifact retention: AAB/APK, IPA/TestFlight build reference, MSIX, checksums,
   source commit, and dependency lockfiles.

## 9. Testing strategy

- Keep Vitest for shared pure TypeScript and backend tests.
- Add contract tests proving every endpoint matches its shared Zod/OpenAPI
  schema.
- Add API integration tests for happy paths, inactive users, unauthorized
  roles, invalid input, expired/revoked tokens, idempotent retries, backfill,
  and the daily 24-hour concurrency rule.
- Add React Native component tests for screens, forms, loading, empty, error,
  and permission states.
- Run end-to-end smoke journeys on physical/cloud Android and iOS devices and a
  Windows VM/runner: login, create/edit/delete entry, leave, reminder, report,
  logout, and session recovery.
- Test phone, tablet/wide, keyboard-only, screen-reader, high contrast, font
  scaling, dark/light theme, slow network, offline startup, and timezone/date
  boundaries.
- Require a real iPhone and Android device for final release acceptance even
  when cloud simulators are used during development.

## 10. Current-machine readiness

Observed on 25 August 2026:

- Windows 10 Pro is present.
- Node.js 24.19.0, npm 11.19.0, and Git 2.51.1 are present.
- .NET 8 runtimes are present, but no .NET SDK is installed.
- Java, `adb`, MSBuild, Visual Studio discovery tools, and the React Native
  Windows C++/UWP toolchain are not currently available.

Required setup for Phase 0:

1. Verify the Windows build is at least the supported React Native Windows
   minimum and enable Windows Developer Mode.
2. Install/switch to Node 22 LTS to match the existing CI and current React
   Native Windows guidance; pin it in the repository.
3. Install Visual Studio 2022 build dependencies: Desktop development with C++,
   UWP/Windows application tooling, MSVC v143, and Windows SDK 10.0.22621.0 or
   the version required by the selected RNW release.
4. Install the .NET SDK required by that RNW release.
5. Create Expo/EAS access and EAS build-project configuration.
6. Obtain Android, Apple, and Microsoft signing/store accounts and company
   ownership decisions for credentials.
7. Provide at least one physical Android device and one registered iPhone, or
   approve a cloud device-testing service.

Java and the full Android SDK are optional when all Android builds run on EAS.
They become necessary only if local Android builds or emulators are later
required.

## 11. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A required native library lacks Windows support | Blocks a shared screen or creates platform forks | Complete the module spike first; prefer React Native core and pure-JS packages; isolate native capabilities behind adapters |
| Cookie/Supabase/native auth behavior diverges | Security defects and inconsistent sessions | One versioned API, bearer auth for native clients, actor lookup on every request, dual-backend contract tests |
| Server Action and API rules drift | Different validation or authorization between web and native | Extract shared authenticated service functions; transports contain no business rules |
| No local iOS simulator | Slower feedback and device-only bugs | EAS development builds, registered iPhone/TestFlight, cloud device tests, small platform changes |
| Cloud-build queue or outage | Delayed development | Keep Windows/TypeScript work local, cache stable development builds, allow GitHub macOS CI as an approved fallback |
| Offline retries duplicate entries | Data integrity errors | Online-first writes, mutation idempotency keys, server constraints, visible retry state |
| Full admin UI expands scope | Delays employee value | Ship employee MVP, then manager features, then approved admin parity |
| RN/RNW upgrade cadence | Build breakage | Pin matching minors and lockfiles; schedule controlled upgrades; use only supported stable versions |

## 12. Decision gates

Do not proceed past each gate without its evidence:

1. **Platform gate:** installable Android, iOS, and Windows spike artifacts and
   an approved native-module list.
2. **Security gate:** approved access/refresh token model, session migrations,
   credential ownership, and threat-model review.
3. **MVP gate:** signed-off employee feature list and explicit decision on
   offline writes, push notifications, and server selection.
4. **Parity gate:** signed-off list of manager/admin/super-admin features that
   belong in native apps versus remaining web-only.
5. **Release gate:** store accounts, privacy/support metadata, signing recovery,
   device acceptance, and release rollback runbook complete.

## 13. Definition of done

- One source tree produces Android, iOS, and Windows applications.
- A clean Windows checkout can develop TypeScript/UI, run the Windows app, and
  trigger Android/iOS cloud builds without Android Studio or a local Mac.
- Signed Android, iOS, and Windows release candidates are reproducible from a
  tagged commit.
- Employee flows and the approved role-specific scope behave identically with
  both existing backend modes.
- No application contains database or service-role secrets.
- Authentication tokens use platform-secure storage and can be revoked.
- API, domain, component, integration, accessibility, and end-to-end gates pass.
- Operations has documented environment configuration, signing ownership,
  monitoring, rollout, rollback, and support procedures.

## 14. Primary references

- React Native 0.84 without a framework:
  https://reactnative.dev/docs/0.84/getting-started-without-a-framework
- React Native Windows getting started:
  https://microsoft.github.io/react-native-windows/v1/docs/getting-started
- React Native Windows prerequisites:
  https://microsoft.github.io/react-native-windows/docs/rnw-dependencies/
- React Native Windows support policy:
  https://microsoft.github.io/react-native-windows/support/
- React Native Windows community-module guidance:
  https://microsoft.github.io/react-native-windows/docs/supported-community-modules/
- EAS Build for existing React Native projects:
  https://docs.expo.dev/build/introduction/
- EAS monorepo builds:
  https://docs.expo.dev/build-reference/build-with-monorepos/
- GitHub-hosted Windows/macOS runners:
  https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job
- Microsoft MSIX overview and CLI tooling:
  https://learn.microsoft.com/en-us/windows/msix/overview
