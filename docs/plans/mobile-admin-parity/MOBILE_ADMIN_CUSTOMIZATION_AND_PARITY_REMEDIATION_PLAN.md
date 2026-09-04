# Mobile Administration, Customization, and Parity Remediation Plan

## Purpose

Bring the local `mobile-dev` commits into conformance with
`MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_PLAN.md` after the review identified
build failures, authorization drift, non-atomic hierarchy changes, incomplete
navigation and administration flows, and an unproven export implementation.

This plan corrects the existing work. It does not expand mobile scope to
backup/restore, imports, factory reset, permanent user deletion, or email-domain
administration.

## Current baseline

- Review range: `origin/mobile-dev..mobile-dev` (17 local commits).
- Focused root tests pass: 15 files / 99 tests.
- Focused mobile tests pass: 12 suites / 38 tests.
- Root typecheck fails in the new admin routes and timesheet service.
- Root lint fails in new route tests and the user administration route.
- Mobile typecheck passes.
- Mobile lint fails in the new administration and privileged report screens.
- The implementation notes still report `Not started` and contain no platform
  evidence or recorded deviations.

## Required delivery rules

1. Preserve existing Server Action names and signatures unless the original
   plan explicitly permits an additive optional field.
2. Keep native and Supabase behavior equivalent. Any new database behavior must
   be implemented and tested for both adapters.
3. Add forward migrations only; do not edit already-applied migrations.
4. Keep API authorization server-side. Module visibility is never an
   authorization boundary.
5. Do not ship title reclassification until impact preview and atomic apply are
   both implemented.
6. Do not ship report export until Android, iOS, and React Native Windows 0.84
   have a proven file save/share path.
7. Keep each remediation slice independently reviewable and record deviations
   and evidence in `MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_NOTES.md`.

## Implementation order

### R1. Restore a buildable baseline

**Goal:** Make the branch compile and lint before changing behavior.

#### Changes

- Add one consistent validation-response helper to `app/api/v1/_http.ts`, or
  replace every `badRequest` call with `apiError('VALIDATION_ERROR', ..., 400)`.
  Do not leave route-local variants.
- Change every `json(body, { status: 201 })` call to `json(body, 201)` in the
  new admin routes.
- Add `userId?: string` to the shared `TimesheetPayload` contract used by
  `createTimesheetService`; ensure update paths cannot use it to transfer entry
  ownership.
- Remove unused values and repair Hook dependency arrays in the new mobile
  screens.
- Replace `any` in the new root route tests with typed mock responses or small
  test-only interfaces.
- Remove the three trailing blank lines reported by `git diff --check`.

#### Focused verification

```powershell
npm run typecheck
npm run lint
npm --prefix mobile run typecheck
npm --prefix mobile run lint
npx vitest run tests/mobile-admin-reference-routes.test.ts tests/mobile-admin-user-routes.test.ts tests/mobile-admin-operational-routes.test.ts tests/mobile-admin-reports-export-route.test.ts
```

#### Exit criteria

- All four static checks pass.
- Invalid admin payload tests assert the real `_http` helper rather than a mock
  export that production does not provide.
- Admin backfill still accepts `userId`, while ordinary users receive 403 for a
  foreign user ID.

### R2. Centralize super-admin authorization and protect branding

**Goal:** Restrict workspace branding and default-layout administration to the
configured super-admin on every entry point.

#### Changes

- Move the reusable `isSuperAdmin` predicate out of the Server Action module to
  a server-only policy module such as `lib/auth/super-admin.ts` so Server
  Actions and route handlers use the same implementation without importing
  from `app/actions/**`.
- Update the branding API GET/PUT/reset handlers to require super-admin.
- Update `saveBranding`, `resetBranding`, and all default-layout mutations to
  use the same policy.
- Keep repository authorization as defense in depth where the adapter owns the
  policy; do not rely on Supabase RLS alone for these global settings.
- Add role-matrix tests for super-admin, ordinary admin, CO, PM, leader,
  engineer, inactive user, and unauthenticated requests.

#### Focused verification

```powershell
npx vitest run tests/mobile-branding-route.test.ts tests/action-policy.test.ts tests/actions-extra.test.ts
```

#### Exit criteria

- Only the configured active super-admin can read or mutate the administration
  branding endpoint and default mobile layout.
- Public `/api/v1/config` continues exposing only normalized safe branding.

### R3. Make title reclassification previewable and atomic

**Goal:** Satisfy the title-reclassification STOP condition before changing any
user hierarchy roles.

#### Contract

- Add a read-only impact operation returning title, current classification,
  proposed classification, affected-user count, and whether synchronization is
  required.
- Require an explicit apply request after the user sees the impact. Do not
  default `syncUsers` to true in the UI.
- Choose and document one policy:
  - atomically reclassify the title and all explicitly confirmed matching
    users; or
  - reclassify the title only and leave existing users unchanged until an
    explicit reassignment operation.
- The recommended policy is atomic synchronized apply because the current UI
  promises title/role alignment.

#### Native implementation

- Add a repository operation implemented with one checked PostgreSQL
  transaction using a client acquired inside `lib/db/**`.
- Lock the title row and matching profile rows, recalculate the impact inside
  the transaction, update both sets, and roll back on any failure.
- Let the legacy-role trigger derive `role`; do not duplicate trigger logic in
  application SQL.

#### Supabase implementation

- Add a new forward migration containing a narrowly granted transactional RPC.
- Use `SECURITY INVOKER` where RLS permits the operation. If elevated execution
  is unavoidable, stop and document the owner, grants, fixed `search_path`, and
  authorization proof before continuing.
- Return the applied affected count and surface every RPC error.

#### UI and tests

- Update the mobile title modal to fetch and display affected-user impact,
  require confirmation, and keep apply disabled while offline.
- Add equivalent confirmation to the existing web title editor.
- Test stale-preview conflicts, missing titles, zero affected users, rollback
  after profile-update failure, and native/Supabase parity.

#### Exit criteria

- No route or repository method can report success after only one half of the
  reclassification is applied.
- Affected users are shown before mutation, not only returned afterward.

### R4. Replace sequential user mutations with one validated update

**Goal:** Make mobile user editing complete, atomic, and behaviorally identical
to web administration.

#### Changes

- Add a typed repository input for the complete editable user record: name,
  department, activation, permission role, title, hierarchy role, and manager.
- Validate all requested fields before writing:
  - self-role, self-deactivation, and self-reporting guards;
  - title/classification consistency;
  - manager existence and leader eligibility;
  - cycle prevention;
  - permission and hierarchy enum validity;
  - last-representable-value rules already enforced by web.
- Persist the update in one native transaction and one equivalent Supabase
  operation. Do not issue multiple repository writes from the route.
- Add an explicit department write; never silently ignore a supplied field.
- Return 404 for a missing target, 409 for conflicts, field errors for invalid
  input, and the updated DTO on success.
- Add audit coverage for activation, role, title, and reporting-line changes.

#### Focused verification

```powershell
npx vitest run tests/mobile-admin-user-routes.test.ts tests/title-aligned-hierarchy.test.ts tests/action-policy.test.ts tests/native-repository.test.ts
npm --prefix mobile test -- --runTestsByPath __tests__/user-admin-screen.test.tsx
```

#### Exit criteria

- Department edits persist on both backends.
- A rejected multi-field request makes no partial change.
- Direct API attempts cannot bypass title or reporting-line policy.

### R5. Complete workspace default layout administration

**Goal:** Let the super-admin save/reset the default mobile layout while every
user can manage only their own override.

#### Changes

- Add a dedicated `/api/v1/admin/layout` route rather than overloading the
  personal `/api/v1/layout` route.
- Share one registry-backed sanitizer between personal and default layout
  writes. It must discard unknown/duplicate IDs, merge new modules, force
  essential modules enabled, and reject invalid placements.
- Extend the super-admin Server Action and web default-layout editor to include
  `mobile` without breaking the existing dashboard/admin arguments.
- Add a super-admin mobile editor or a clearly separated default-layout mode in
  the layout customizer.
- Reset default layout to the code registry default; reset a personal layout to
  `null` so it inherits the current workspace default.
- Keep cached effective layouts readable offline and disable all mutations.

#### Tests

- Super-admin save/reset on both backends.
- Ordinary admin and regular-user 403 for default changes.
- User can update only their own override.
- Broken JSON recovery, new essential module merge, and capability filtering.

### R6. Finish branding editors and runtime application

**Goal:** Deliver branding as an end-to-end workspace setting, not only a
configuration API.

#### Changes

- Add super-admin web and mobile editors for app name, primary color, and HTTPS
  logo URL with save/reset and field-level errors.
- Apply app name and logo to signed-out and signed-in web surfaces.
- Apply the primary color through web semantic CSS variables; preserve safe
  fallbacks during server/render failures.
- Apply branding to signed-out and signed-in mobile surfaces through the
  semantic theme layer rather than screen-local hard-coded colors.
- Keep independent fallback behavior for name, color, and logo-load failure.
- Align the bundled fallback color with the original plan's documented VSIS
  crimson palette, or record an approved deviation with evidence.

#### Tests

- Web editor authorization, validation, reset, document branding, and failed
  image fallback.
- Mobile editor loading/error/offline/authorization states and signed-in theme
  propagation.
- Old config payloads without branding remain compatible.

### R7. Wire Team into web and member-filtered navigation

**Goal:** Make the shared Team projection reachable and preserve authorized
member context through Timesheets and Reports.

#### Changes

- Mount `app/dashboard/team-view.tsx` in the web dashboard for actors with
  `canViewTeam`; keep hierarchy editing in the admin surface.
- Add a web navigation destination and route/query state for Team.
- Pass the selected member ID from Team into Timesheets or Reports rather than
  discarding the selected object.
- Add typed mobile navigation state for an optional authorized member filter.
- Let the mobile Team row choose Timesheets or Reports and pass that member ID.
- Initialize the destination filter from navigation state, preserve it on back,
  and clear it explicitly when the user chooses their own/all scope.
- Do not grant edit controls merely because a member is visible.
- Ensure non-actionable rows are not announced as buttons.

#### Tests

- Web Team is rendered for admin/CO/leader and absent for PM/engineer/user.
- Mobile selection passes the exact member ID to both destinations.
- Back navigation preserves filters.
- Unauthorized user IDs remain scoped/rejected by the API and repository.

### R8. Implement a proven cross-platform CSV file export

**Goal:** Replace raw text sharing with a real server-generated file workflow.

#### Compatibility spike

Before changing production code, prove one maintained approach can:

- stream or download an authenticated response to an app-owned temporary file;
- share or save that file on Android and iOS;
- share or save that file on React Native Windows 0.84;
- clean up temporary files without exposing the bearer token;
- report cancellation, disk, permission, timeout, and share failures.

Use existing React Native/platform APIs if they satisfy all three platforms.
If a dependency is required, document its versions, maintenance state, native
setup, license, and test artifact. Stop the slice if Windows support cannot be
proven.

#### Server and client changes

- Keep bearer credentials in the request header only.
- Reuse repository-scoped report filters for export.
- Return an explicit row-count signal so header-only CSV is treated as empty.
- Preserve bounded server paging and CSV formula/cell escaping.
- Sanitize the filename and parse it from `Content-Disposition` safely.
- Download to a unique temporary path, share/save the file URI, and delete it
  after completion or failure.
- Disable export offline and support cancellation/retry without reusing another
  user's cached file.

#### Tests and evidence

- Empty export, large multi-page export, authorization loss, timeout,
  cancellation, cleanup failure, filename sanitization, and CSV injection.
- Android and Windows local artifacts plus iOS CI/device evidence recorded in
  the implementation notes.

### R9. Complete operational administration behavior

**Goal:** Close the remaining slice-11 gaps and apply consistent online-only
mutation behavior.

#### Changes

- Add global-reminder PATCH support with the same message/time validation and
  audit behavior as web.
- Add mobile reminder editing and focused confirmation for destructive actions.
- Use `useSessionSync().isOffline` in every admin screen; retain stale reads but
  disable create/update/delete controls while offline.
- Preserve visible collections during background refresh.
- Add bounded pagination or explicit server limits for projects, activity
  types, users, titles, leave markers, and global reminders.
- Surface 403, 409, validation field errors, and retryable network errors
  distinctly.

#### Tests

- Loading, stale refresh, empty, offline, authorization loss, validation,
  conflict, and retry states for every admin screen.
- Global-reminder create/update/delete route and mobile UI coverage.

### R10. Full regression, documentation, and rollout evidence

**Goal:** Meet the original plan's acceptable-finish definition.

#### Automated verification

```powershell
npx vitest run tests/db-migrations.test.ts tests/supabase-migrations.test.ts tests/hierarchy.test.ts tests/action-policy.test.ts tests/mobile-contract-parity.test.ts tests/mobile-config-route.test.ts
npm run lint
npm run typecheck
npm test
$env:NEXT_PUBLIC_BACKEND='supabase'; npm run build
$env:NEXT_PUBLIC_BACKEND='native'; npm run build
npm --prefix mobile run lint
npm --prefix mobile run typecheck
npm --prefix mobile test
npm --prefix mobile run test:windows
npm --prefix mobile run bundle:windows
git diff --check origin/mobile-dev..mobile-dev
```

Run authenticated Playwright coverage for web branding, Team visibility and
drill-down, and unchanged web administration. Run database integration tests
against a migrated PostgreSQL instance for the native transaction paths.

#### Manual/platform evidence

- Android: layout, branding, admin mutation, Team drill-down, large picker, and
  file export evidence.
- Windows: the same flows plus Enter-key sign-in, icon sizing, large picker,
  file save/share, and produced bundle.
- iOS: CI test/build plus device smoke evidence for theme, picker, and file
  save/share.

#### Documentation

- Update `docs/architecture/unified-experience-contract.md`.
- Update mobile README, `.env.example`, and user guide.
- Record every code-forced deviation and command result in
  `MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_NOTES.md`.
- Replace the notes' `Not started` run-end entry only after all required checks
  and platform evidence are complete.

## Recommended corrective commit sequence

1. `fix(api): restore mobile admin route type safety`
2. `fix(authz): restrict global mobile settings to super-admin`
3. `fix(hierarchy): make title reclassification atomic`
4. `fix(admin): make mobile user updates atomic and complete`
5. `feat(layout): add default mobile layout administration`
6. `feat(branding): complete web and mobile branding controls`
7. `fix(team): preserve member filters across web and mobile navigation`
8. `fix(reports): add proven cross-platform CSV file export`
9. `fix(admin): complete reminder editing and offline guards`
10. `test(mobile): close parity role-matrix and platform coverage`
11. `docs(mobile): record remediation and rollout evidence`

## Final acceptance checklist

- [ ] Root and mobile lint/typecheck pass.
- [ ] Both backend builds pass.
- [ ] All unit, integration, mobile, Windows, and authenticated web tests pass.
- [ ] Branding and default layout are super-admin-only.
- [ ] Title reclassification previews impact and applies atomically.
- [ ] User edits, including department, are complete and atomic.
- [ ] Web Team is reachable and both clients preserve member filters.
- [ ] Export shares/saves a real file on Android, iOS, and Windows.
- [ ] Global reminders support update and all admin mutations are offline-disabled.
- [ ] Collections are bounded and authorization parity is proven.
- [ ] Implementation notes contain commands, deviations, and platform evidence.
