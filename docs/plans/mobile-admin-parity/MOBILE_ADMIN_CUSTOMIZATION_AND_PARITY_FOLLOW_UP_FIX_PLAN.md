# Mobile Administration, Customization, and Parity Follow-up Fix Plan

## Purpose

Correct the six regressions found while reviewing commits
`b7b6adf..7c301d9` against
`MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_PLAN.md`. This is a focused follow-up to
`MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_REMEDIATION_PLAN.md`; completed behavior
outside the findings below should not be redesigned.

## Confirmed gaps

1. The Supabase title-reclassification migration references the nonexistent
   `public.hierarchy_role` type and cannot be deployed to the repository schema.
2. Native `setDefaultLayouts` cannot distinguish "preserve mobile" from
   "clear mobile", so workspace-default reset is a no-op only on native.
3. The mobile workspace-default editor edits the personal/effective layout and
   exposes super-admin operations to ordinary admins.
4. Team-to-Reports navigation loses or rejects the selected member for CO,
   managers, and team leads.
5. Mobile CSV export shares an in-memory text message instead of a CSV file and
   has no Android/iOS/Windows file-flow evidence.
6. Persisted branding is not applied to signed-out/signed-in web UI or the
   signed-in mobile semantic theme.

## Delivery constraints

- Keep native and Supabase behavior identical and verify both backends.
- Do not weaken API/repository authorization to make a client route work.
- Treat `undefined` as "leave unchanged" and `null` as "clear" for optional
  persisted settings; document this contract in the repository interface.
- Derive super-admin UI visibility from a server-authored capability. Do not
  compare the actor email with a client-side environment value.
- Do not add a file-export dependency until Android, iOS, and React Native
  Windows 0.84 support is demonstrated with a runnable spike.
- Keep bearer tokens in request headers and out of filenames, query strings,
  logs, share payloads, and persisted export metadata.
- Preserve existing Server Action names/signatures and add forward migrations
  if the migration-history check shows a file has been applied anywhere.
- Do not mark the original plan complete until the automated and platform
  evidence in this document is recorded.

## Implementation order

### F1. Restore Supabase migration deployability

**Goal:** Make the title-reclassification migration executable against the
actual text-based hierarchy schema before any other fix is accepted.

#### Migration-history gate

1. Compare local and shared Supabase migration history before editing
   `20260910000000_reclassify_title_atomic.sql`.
2. If it is unshipped and unapplied, correct that branch-local migration in
   place because its current statement cannot execute against this schema.
3. If any shared database records it as applied, stop and add a uniquely named
   forward repair migration instead. Do not rewrite shared migration history.

#### Changes

- Change `p_hierarchy_role public.hierarchy_role` to
  `p_hierarchy_role text` in the function and its `REVOKE`/`GRANT` signatures.
- Validate the value inside the function against exactly `manager`,
  `team_lead`, `engineer`, and `user` before updating either table. Reject null
  and unknown values with a stable PostgreSQL error code/message that the
  adapter can map to a validation error.
- Retain the fixed `search_path`, service-role-only execution grant, row locks,
  and transactional title/profile updates.
- Update `tests/supabase-migrations.test.ts` so it asserts the real `text`
  signature, the role validation, the restricted grants, and the absence of a
  reference to `public.hierarchy_role`.
- Add a migration-application check, not only a regex check. Apply the complete
  Supabase migration chain to a clean local database in CI or a documented
  local verification command.

#### Focused verification

```powershell
npx vitest run tests/supabase-migrations.test.ts tests/title-aligned-hierarchy.test.ts
supabase db reset --local
```

If the repository's local Supabase workflow uses a different clean-reset
command, record that exact command and result in the implementation notes.

#### Exit criteria

- A clean database applies every Supabase migration, including the corrected
  RPC, without an undefined-type error.
- The RPC rejects every value outside the four hierarchy roles.
- Its executable signature is granted only to `service_role`.

### F2. Make default-layout persistence and administration truthful

**Goal:** Give the repository contract consistent tri-state behavior and make
the mobile editor load the target it claims to edit.

#### Repository behavior

- Document `DefaultLayouts.mobile` as:
  - `undefined`: preserve the current database value;
  - `null`: clear the workspace override and use the registry fallback;
  - `MobileLayout`: replace the workspace override.
- In `lib/db/native.ts`, use separate SQL paths (or an explicit update flag) so
  `undefined` omits `default_mobile_layout` while `null` writes SQL `NULL`.
  Remove `coalesce($3, default_mobile_layout)` from the clear path.
- Keep `lib/db/supabase.ts` aligned with the same three cases.
- After an admin reset, return the registry-resolved default from the route but
  persist `NULL`, matching the documented fallback model.
- Add adapter tests for preserve, clear, and replace. Assert both the resulting
  SQL/payload and a read-after-write value; route mocks alone are insufficient.

#### Server-authored capability

- Add a narrow capability such as `canManageWorkspaceCustomization` to
  `ActorCapabilities`, `MobileActorDto`, the mobile contracts, and layout
  responses.
- Calculate it on the server with the shared `isSuperAdmin(actor)` policy.
  Keep `canManageSettings` unchanged for ordinary admin operations.
- Use the new capability for workspace-default and branding controls. API
  handlers must continue calling `isSuperAdmin`; the capability is presentation
  state, not the authorization boundary.

#### Mobile editor state

- Add `loadAdminDefaultLayout(): Promise<MobileLayout>` to the session-facing
  mobile API. It must call the existing admin-layout GET endpoint with refresh
  retry behavior identical to the save/reset methods.
- Keep independent personal and workspace-default drafts in
  `LayoutCustomizerScreen`. Do not reuse the effective personal `layout` state
  for the workspace draft.
- On first entry into workspace mode, show a loading state and populate that
  draft from `loadAdminDefaultLayout`. Surface 401/403/network errors without
  switching or saving the personal draft.
- Replace the workspace draft with the server response after save/reset. Keep
  the personal draft unchanged when switching modes or when a workspace
  mutation fails.
- Render workspace mode only when
  `canManageWorkspaceCustomization === true`; ordinary admins retain personal
  customization only. Apply the same visibility rule to the branding editor in
  `SettingsAdminScreen`.

#### Tests

- Native and Supabase preserve/clear/replace parity.
- Admin route reset persists `NULL` and returns the registry default.
- A super-admin whose personal and workspace layouts differ sees and edits the
  correct value in each mode.
- Switching modes does not copy one draft into the other.
- Ordinary admin, CO, PM, leader, and user never see workspace mode or branding
  controls; direct endpoint attempts still return 403.
- Loading, offline, authorization-loss, save failure, and reset failure states.

#### Focused verification

```powershell
npx vitest run tests/native-repository.test.ts tests/supabase-layouts.test.ts tests/mobile-layout-route.test.ts tests/action-policy.test.ts
npm --prefix mobile test -- --runTestsByPath __tests__/layout-customizer-screen.test.tsx __tests__/branding.test.tsx
```

### F3. Preserve the Team member filter through Reports navigation

**Goal:** Let every authorized Team viewer open the ordinary Reports flow for
the selected visible member without entering an admin-only route.

#### Navigation contract

- Extend the navigation stack entry with typed route parameters rather than
  holding one unscoped global member object. Store only the member ID and the
  display fields needed by the destination.
- Add report/timesheet member-filter parameters and reducer actions for push,
  back, and explicit filter clearing. Back navigation must restore the previous
  stack entry and its parameters.
- From `TeamScreen`, always navigate report selections to the ordinary
  `reports` route. Keep `admin-reports` reserved for the admin module; do not
  relax its `canManageSettings` gate to repair Team navigation.
- Remove the hand-written `canPrivileged` role branch from `mobile/App.tsx`.

#### Reports behavior

- Add an optional authorized member filter to `ReportsScreen`.
- Include that user ID in both grouped-report and export requests, show the
  active member clearly, and provide an explicit reset to the actor's normal
  scope.
- When the filter changes while the screen is mounted, refresh report data and
  avoid showing the prior member's totals during loading.
- Keep authorization server-side. Add route/service tests proving that admin
  and CO can use their allowed scope, managers/team leads remain team-scoped,
  and an arbitrary out-of-scope ID cannot expose rows.

#### Tests

- Admin, CO, manager, and team lead Team selections reach `reports` with the
  exact member ID.
- No Team selection attempts to push `admin-reports`.
- PM/engineer/user do not gain Team visibility.
- Timesheets and Reports retain independent filters across back navigation.
- Clearing the report filter returns to the actor's default authorized scope.
- A rejected route does not silently leave a stale filter behind.

#### Focused verification

```powershell
npm --prefix mobile test -- --runTestsByPath __tests__/navigation-reducer.test.ts __tests__/team-screen.test.tsx __tests__/reports-screen.test.tsx
npx vitest run tests/team-hierarchy-view.test.ts tests/mobile-admin-reports-export-route.test.ts
```

### F4. Replace text sharing with a proven CSV file workflow

**Goal:** Download the authenticated streaming response to a unique temporary
`.csv` file and share/save that file on Android, iOS, and Windows.

#### F4a. Mandatory compatibility spike

Create a small isolated spike and record the decision in
`docs/architecture/mobile-csv-file-export.md`. The spike must demonstrate:

- authenticated streaming download with request headers;
- a unique app-owned temporary file ending in `.csv`;
- native share/save UI on Android, iOS, and React Native Windows 0.84;
- cancellation and error propagation;
- cleanup after success, cancellation, and failure; and
- no token in URLs, logs, persisted metadata, or the share payload.

Evaluate maintained dependencies against the exact installed React Native and
Windows versions. If no dependency passes all three platforms, implement a
small first-party native module behind the same TypeScript interface. Do not
merge a production dependency or repeat the `Share.share({message: csv})`
fallback when Windows support is unproven.

The spike is a STOP gate: if iOS and Windows cannot produce a real shared/saved
file, report the blocker and options before changing production screens.

#### Server contract

- Resolve authorization and the effective user filter before starting the
  response.
- Fetch the first bounded page with an authorized count. Return an explicit
  empty result (recommended: HTTP 204) when the row count is zero.
- For non-empty exports, stream the first page and subsequent pages without
  re-querying page one. Include a sanitized `Content-Disposition` filename and
  an explicit row-count header.
- Preserve CSV formula escaping, no-store headers, bounded paging, and
  repository scoping.
- Test a failure after the first page so a partial download is deleted and
  never presented as a successful export.

#### Mobile production integration

- Introduce one platform-neutral export service used by both
  `ReportsScreen` and `PrivilegedReportsScreen`; screens should not handle raw
  CSV strings.
- Let the service obtain a current bearer token, perform one refresh-and-retry
  on 401, stream to a unique temporary path, validate status/content type and a
  sanitized response filename, invoke the verified share/save operation, and
  clean up in `finally`.
- Return typed outcomes for saved/shared, empty, cancelled, and failed. Treat
  cancellation as non-error UI and make other failures retryable.
- Support an `AbortSignal` or equivalent native cancellation handle and cancel
  the export when its screen unmounts.
- Never cache an exported file under a user-independent fixed name.

#### Tests and platform evidence

- JS tests mock the file-export boundary and cover success, empty, 401 refresh,
  timeout, cancellation, invalid filename, wrong content type, partial write,
  cleanup failure, and retry.
- Server tests cover empty, one page, multiple pages, row-count header,
  authorization, CSV injection, and mid-stream repository failure.
- Capture a real artifact and share/save result on Android and Windows.
- Capture iOS CI build/test plus device or simulator share-sheet evidence on a
  macOS runner. A JavaScript mock is not platform evidence.

### F5. Apply branding through web and mobile runtime themes

**Goal:** Make the persisted app name, logo URL, and primary color affect all
required signed-out and signed-in surfaces with per-field fallbacks.

#### Shared branding rules

- Add a pure palette-derivation helper that accepts only a validated primary
  color and produces the semantic normal, pressed/hover, tint, focus, and
  on-primary values used by both clients. Fall back independently for invalid
  name, color, and logo.
- Choose the documented bundled fallback (including the original plan's VSIS
  crimson requirement) or record an explicitly approved deviation. Keep web
  and mobile defaults identical.

#### Web runtime

- Load normalized safe branding at the root server boundary and provide it to
  client components through a small branding context/provider.
- Replace the fixed primary Tailwind theme values with runtime CSS custom
  properties populated from the derived palette. Existing semantic
  `primary-*` classes should then update without screen-local inline colors.
- Update `app/page.tsx` and `AppShell` to render the runtime app name and
  `BrandMark` logo URL on signed-out and signed-in surfaces.
- Use the supported Next.js 16 metadata/viewport APIs from the installed docs
  to update document title and browser theme color. Do not rely on remembered
  pre-v16 caching or metadata behavior.
- After a web branding save/reset, refresh or invalidate the root branding data
  with the supported Next.js 16 API so the shell changes without a new login.
- Preserve the bundled logo if the remote image fails and do not let a branding
  read failure block authentication or dashboard rendering.

#### Mobile runtime

- Move `SessionProvider` above the theme wrapper, or add a small bridge wrapper,
  so `ThemeProvider` receives the normalized session branding color.
- Extend `ThemeProvider`/`getPalette` to derive its palette from that runtime
  color. Components must use `palette.primary`, `palette.primaryLight`, and
  semantic on-primary values instead of importing fixed `colors.primary` for
  interactive UI.
- Migrate signed-in screens and shared navigation/components to the semantic
  palette. Keep fixed constants only as fallback inputs, not rendered runtime
  colors.
- Apply app name/logo to an authenticated shell surface as well as the existing
  sign-in surface. Update immediately after the settings editor saves/resets.
- Keep cached safe branding available during offline startup and fall back per
  field when cache/config/image loading fails.

#### Tests

- Palette derivation, invalid-value fallback, and accessible action contrast.
- Web signed-out page, signed-in shell, metadata, save/reset propagation, and
  remote-logo failure.
- Mobile signed-out and signed-in surfaces, light/dark palette propagation,
  save/reset propagation, offline cached branding, and image failure.
- Add a source guard ensuring runtime components no longer use the fixed
  primary color directly except in the theme/fallback implementation.

#### Focused verification

```powershell
npx vitest run tests/branding.test.ts tests/mobile-branding-route.test.ts
npm --prefix mobile test -- --runTestsByPath __tests__/branding.test.tsx __tests__/theme-context.test.tsx
```

### F6. Regression, migration, and evidence gate

**Goal:** Prove the fixes in both backends and all claimed mobile platforms
before updating completion claims.

#### Automated verification

```powershell
npx vitest run tests/db-migrations.test.ts tests/supabase-migrations.test.ts tests/title-aligned-hierarchy.test.ts tests/native-repository.test.ts tests/supabase-layouts.test.ts tests/mobile-layout-route.test.ts tests/action-policy.test.ts tests/mobile-admin-reports-export-route.test.ts tests/mobile-branding-route.test.ts tests/team-hierarchy-view.test.ts
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
git diff --check
```

Also apply both migration chains to clean PostgreSQL databases and run the
database integration tests with `TEST_DATABASE_URL`. A static SQL regex suite
does not satisfy this gate.

#### Manual/platform matrix

| Flow | Android | iOS | Windows |
| --- | --- | --- | --- |
| Personal/workspace layout separation | device/emulator | simulator/device | packaged app |
| Workspace reset and inheritance | device/emulator | simulator/device | packaged app |
| Team member to Reports filter | device/emulator | simulator/device | packaged app |
| Branding signed out and signed in | device/emulator | simulator/device | packaged app |
| Non-empty/empty/cancelled CSV file export | device/emulator | simulator/device | packaged app |

Record OS/runtime versions, build identifiers, screenshots or logs, produced
CSV filename, cleanup result, and tester/date in
`MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_NOTES.md`.

#### Documentation correction

- Change any current "complete" or "proven" statement that is not backed by
  the matrix above to `In progress` before implementation starts.
- Record the migration-history decision, export compatibility choice, fallback
  branding palette, deviations, and exact command results.
- Remove the trailing blank line currently reported in
  `tests/supabase-migrations.test.ts` while updating that test.
- Update the unified experience contract and mobile README for the new
  super-admin capability, runtime branding, route parameters, and file export
  behavior.

## Recommended corrective commit sequence

1. `fix(db): repair title reclassification migration signature`
2. `fix(layout): align default reset semantics across backends`
3. `fix(mobile): separate personal and workspace layout drafts`
4. `fix(mobile): preserve team report member filters`
5. `test(export): prove cross-platform csv file workflow`
6. `fix(export): share reports as temporary csv files`
7. `fix(branding): apply workspace branding at runtime`
8. `test(mobile): verify follow-up parity fixes`
9. `docs(mobile): record follow-up rollout evidence`

The compatibility spike commit must precede the production export commit. Keep
the migration-history decision in the first commit message/body or notes.

## Final acceptance checklist

- [ ] The full Supabase migration chain applies to a clean database.
- [ ] The title RPC uses a valid signature and rejects invalid hierarchy roles.
- [ ] Native and Supabase default-layout preserve/clear/replace behavior matches.
- [ ] Only the configured super-admin sees workspace layout/branding controls.
- [ ] Personal and workspace layout drafts never overwrite each other.
- [ ] Admin, CO, manager, and team lead can open Reports for an authorized Team member.
- [ ] An out-of-scope report user ID cannot expose data.
- [ ] CSV export produces, shares/saves, and cleans up a real `.csv` file on Android, iOS, and Windows.
- [ ] Signed-out and signed-in web/mobile surfaces use the persisted branding.
- [ ] Branding failures fall back independently without blocking app use.
- [ ] Root/mobile lint, typecheck, tests, both backend builds, Windows tests/bundle, and `git diff --check` pass.
- [ ] Completion notes contain real migration and three-platform evidence.
