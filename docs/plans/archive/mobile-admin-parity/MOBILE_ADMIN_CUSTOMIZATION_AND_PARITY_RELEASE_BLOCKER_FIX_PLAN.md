# Mobile Administration and Parity Release-Blocker Fix Plan

## Purpose

Resolve the release-blocking issues found while reviewing commits
`84f6e67..3bf7ec8` and restore truthful completion evidence for
`MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_FOLLOW_UP_FIX_PLAN.md`.

This plan supersedes the completion claims in
`MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_NOTES.md`. It does not replace the
original product scope or reopen completed parity slices that are unrelated to
the findings below.

## Reviewed baseline

- Branch: `mobile-dev`, HEAD `3bf7ec8`.
- Worktree was clean when this plan was created.
- Root lint and typecheck pass.
- Focused root tests pass: 13 files / 137 tests.
- Focused mobile Jest tests pass: 6 suites / 25 tests.
- Mobile lint exits successfully with 45 warnings.
- Mobile typecheck fails with production and test errors.
- `git diff --check` reports trailing blank lines in `lib/branding.ts` and
  `mobile/src/navigation/navigation-reducer.ts`.
- No clean linked/local Supabase migration application or real Android, iOS,
  and Windows CSV-file artifact was recorded.

## Release blockers

1. Migrations already present on upstream branches were renumbered without a
   recorded remote-history reconciliation. Supabase compares timestamp
   versions, so `20260905000000_fix_mobile_session_rotation.sql` may be treated
   as an older already-applied migration and skipped.
2. `npm --prefix mobile run typecheck` fails.
3. Team member filters still have both route-param and global state, allowing a
   cleared Reports filter to leak into Timesheets.
4. CSV export still buffers `response.text()` and shares a message. It does not
   create, share/save, or clean up a file.
5. Runtime mobile branding reaches the theme provider but most signed-in UI
   bypasses it through fixed palettes and `colors.primary`; authenticated app
   name/logo surfaces are absent.
6. Implementation notes claim completion and verification that the repository
   cannot reproduce.

## Non-negotiable rules

- Freeze database deployment until migration history is reconciled for every
  linked environment.
- Never run `supabase db reset --linked` against a shared environment.
- Never use `supabase migration repair` to pretend SQL ran. It changes history
  only and is allowed only after independently verifying actual schema state.
- Create every new Supabase migration with `supabase migration new`; do not
  invent timestamps manually.
- Keep one local migration file per timestamp version after reconciliation.
- Preserve native/Supabase behavior and server-side authorization.
- Keep `canManageWorkspaceCustomization` additive and safe for mixed client and
  server versions; an absent capability must behave as false.
- Do not merge production CSV code until the exact Android/iOS/Windows file
  path is demonstrated.
- Do not restore `Complete`, `Accepted`, or `PASS` documentation labels until
  the associated command or platform evidence exists.

## Implementation order

### B0. Correct status documentation before implementation

**Goal:** Prevent the current notes and ADR from being used as release approval.

#### Changes

- Change the follow-up state in
  `MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_NOTES.md` from complete to
  `Remediation in progress`.
- Replace the claimed mobile typecheck/build/platform results with the reviewed
  baseline above.
- Correct the title RPC name to `reclassify_title_atomic`.
- Change `docs/architecture/mobile-csv-file-export.md` from `Accepted` to
  `Proposed — compatibility proof pending`.
- Replace its asserted platform compatibility matrix and cleanup lifecycle with
  explicit hypotheses and empty evidence fields. The current TypeScript service
  is not evidence because it shares text.

#### Exit criteria

- Documentation distinguishes implemented server streaming from unimplemented
  mobile file persistence/share behavior.
- No statement claims Android, iOS, Windows, dual-backend, or typecheck success
  without a dated command/artifact.

### B1. Reconcile Supabase migration identity and schema state

**Goal:** Produce one canonical, deployable migration chain whose timestamp
history matches actual database state without rerunning or skipping SQL.

#### B1.1 Discover the installed CLI workflow

Before any history mutation, run and record:

```powershell
supabase --version
supabase migration --help
supabase migration list --help
supabase migration repair --help
supabase migration new --help
```

Use the flags printed by the installed CLI. Current Supabase documentation
states that migration comparison uses timestamp versions and that
`migration repair` edits only `supabase_migrations.schema_migrations`; confirm
the installed version behaves the same.

#### B1.2 Build a per-environment history matrix

For local, development, staging, and production databases that may have seen
these branches:

1. Take or verify a recoverable database backup/snapshot.
2. Run the read-only migration list against the target and save the output.
3. Read the migration-history rows for versions around `20260904000000` through
   `20260910000000` where access permits.
4. Probe actual schema effects independently:
   - `mobile_sessions` table and the current `rotate_mobile_session` body;
   - leave/reminder length constraints;
   - `my_locked_profile_fields` and the own-profile update policy;
   - composite timesheet/session cleanup indexes;
   - `reclassify_title_atomic(text, text, boolean)` and its grants.
5. Record `history version`, `actual schema effect`, `source commit`, and
   `decision` for every target. Do not infer applied SQL from a history row
   whose timestamp was shared by multiple files.

#### B1.3 Construct the canonical local chain

- Revert the assumption that simply renaming all historical files is safe.
- For each duplicated historical timestamp, retain one canonical file only when
  it matches the SQL represented by shared history.
- Move every other colliding or displaced change into a new forward migration
  created with `supabase migration new <descriptive_name>`.
- Move the session-rotation repair out of version `20260905000000`; that version
  already existed upstream and may be skipped remotely. Generate a new forward
  migration after the current migration head.
- Make each reconciliation migration safe for the observed schema states:
  inspect before creating/dropping constraints, policies, functions, and
  indexes; preserve data; and avoid destructive table rebuilds.
- Keep `rotate_mobile_session` and `reclassify_title_atomic` as narrowly granted
  `SECURITY DEFINER` functions with pinned `search_path` and execute revoked
  from `PUBLIC`, `anon`, and `authenticated`.
- Add a test that fails when two local migration files share a timestamp
  prefix.

#### B1.4 Repair history only when justified

For each environment:

- Apply missing SQL through the canonical forward migration chain first.
- Use `supabase migration repair --status applied|reverted <version>` only when
  the history matrix proves the schema and history disagree.
- Record the exact command, operator, target, timestamp, before/after migration
  list, and backup identifier.
- Require separate approval before repairing production history.

#### Verification

```powershell
supabase migration list --local
supabase db reset
npx vitest run tests/supabase-migrations.test.ts tests/title-aligned-hierarchy.test.ts tests/mobile-session-store.test.ts
```

Then run the linked read-only migration list and a dry-run/preview if supported
by the installed CLI. Run database advisors after the functions/policies are
present and address security findings before deployment.

#### Exit criteria

- Local migrations have unique timestamp prefixes.
- A clean local Supabase database applies the full chain.
- Every shared environment has a documented matching history/schema matrix.
- The session-rotation fix has a new version that cannot alias an old applied
  migration.
- Refresh rotation and reuse detection execute successfully through the real
  RPC; anon/authenticated execution remains denied.

### B2. Restore the mobile compile gate

**Goal:** Make the mobile production tree and all TypeScript test fixtures pass
`tsc --noEmit` before changing more behavior.

#### Navigation and filter types

- Import `RouteParams` and the shared member-filter type into `mobile/App.tsx`.
- Replace the partial/full-profile mismatch with one narrow shared type, such
  as `MemberFilterParam = Pick<PersonProfile, 'id' | 'name' | 'email'>`.
- Update `TimesheetListScreen`, `ReportsScreen`, `PrivilegedReportsScreen`, and
  navigation stack parameters to accept that narrow type where only identity
  and display text are used.
- Do not cast the partial object to `PersonProfile` or add placeholder role
  fields.

#### Capability compatibility

- Keep the server DTO field required and always serialize a boolean.
- Treat `canManageWorkspaceCustomization` as optional/default-false in the
  mobile input contract so a new client remains safe against an older server.
- Update capability factories/fixtures to cover explicit true, explicit false,
  and absent values.

#### Reducer and icon errors

- Update every constructed `NavigationState` test fixture to contain the new
  stack/parameter fields, or provide a typed test-state builder using
  `initialNavigationState`.
- Replace the unsupported `Icon` name `users` with a valid registered icon such
  as the existing Team icon.
- Remove the two trailing blank lines reported by `git diff --check`.

#### Verification

```powershell
npm --prefix mobile run typecheck
npm --prefix mobile run lint
npm --prefix mobile test -- --runTestsByPath __tests__/navigation-reducer.test.ts __tests__/navigation-modules.test.ts __tests__/reports-screen.test.tsx __tests__/team-screen.test.tsx
git diff --check
```

#### Exit criteria

- Mobile typecheck has zero errors.
- No `as PersonProfile` or equivalent cast hides the route-param mismatch.
- Capability absence hides workspace controls and does not crash navigation.

### B3. Make route parameters the single member-filter source

**Goal:** Eliminate stale cross-screen filters while preserving filters on
back navigation.

#### Changes

- Remove the global `memberFilter` state from `mobile/App.tsx`.
- Store member filters only in `NavigationStackEntry.params`.
- Pass `navState.currentParams?.filterUser` directly to Timesheets and Reports.
- `CLEAR_PARAMS` must clear only the current stack entry and current params.
- Admin Reports should receive only its own route parameters; it must not inherit
  the last Team selection through a global fallback.
- Direct root-tab navigation without parameters must start unfiltered.
- Back navigation must restore the previous entry's own parameters.
- Keep server-side repository/RLS scoping unchanged and add direct out-of-scope
  user-filter regression tests for both backends.

#### Required scenarios

1. Team → Reports(member A) → Clear → Timesheets = unfiltered.
2. Team → Timesheets(member A) → Back → Team → Reports(member B) = member B.
3. Reports(member A) → Back → Reports root tab = unfiltered.
4. Reports(member A) → nested route → Back = member A restored.
5. Rejected navigation cannot retain pending member parameters.
6. Manager/team lead cannot retrieve a visible-looking but out-of-scope user ID.

#### Verification

```powershell
npm --prefix mobile test -- --runTestsByPath __tests__/navigation-reducer.test.ts __tests__/team-screen.test.tsx __tests__/reports-screen.test.tsx __tests__/timesheet-list-screen.test.tsx
npx vitest run tests/team-hierarchy-view.test.ts tests/mobile-admin-reports-export-route.test.ts
```

### B4. Implement a real cross-platform CSV file export

**Goal:** Replace both raw-text share paths with a verified file download and
share/save operation.

#### B4.1 Compatibility proof before production integration

- Keep the ADR in proposed state.
- Build the smallest runnable spike against React Native 0.84.1 and React Native
  Windows 0.84.0.
- Evaluate maintained dependencies using exact pinned versions and license,
  maintenance, Android/iOS autolinking, and Windows support evidence.
- The proof must make an authenticated request with headers, write a unique
  `.csv` file incrementally to app-owned temporary storage, invoke each native
  platform's file share/save UI, and delete the file after success,
  cancellation, and error.
- If no dependency passes all platforms, implement a narrow owned native module
  behind a TypeScript `ReportFileExporter` interface. Do not fall back to
  message sharing.
- Capture the produced filename/path (without tokens), MIME type, share/save
  result, cleanup confirmation, platform/runtime version, and screenshot/log.

This remains a STOP gate. Do not connect screens until Android, iOS, and Windows
all produce a real file artifact.

#### B4.2 Server export contract

Keep the useful server changes already present, then complete their coverage:

- Return 204 plus `X-Total-Count: 0` for an authorized empty result.
- Stream the already-fetched first page and bounded subsequent pages.
- Preserve CSV injection escaping and `Cache-Control: no-store`.
- Sanitize the `Content-Disposition` filename.
- Add tests for exactly one full page, multiple pages, changed/removed rows
  during paging, and repository failure after headers/first chunk.
- Confirm admin, CO, manager, team lead, and ordinary-user scope against both
  repositories.

#### B4.3 Mobile integration

- Replace `exportReportsCsv(): Promise<string>` with a session action returning
  the typed file-export outcome.
- The session action must obtain a current access token, retry once after a 401
  refresh, and never pass the token in the URL or logs.
- The file service must validate HTTP status, content type, row-count header,
  and sanitized filename before sharing.
- Use streaming/native download APIs rather than `response.text()`.
- Clean partial and complete temporary files in `finally`.
- Support cancellation on unmount and explicit retry after recoverable errors.
- Use the same service from both `ReportsScreen` and
  `PrivilegedReportsScreen`; remove their `Share` imports and raw CSV parsing.
- Delete or replace the current unused `mobile/src/services/csvExport.ts` so no
  message-share implementation remains reachable.

#### Automated tests

- Empty, success, cancel, 401 refresh, 403, timeout, abort, invalid content type,
  malicious filename, disk failure, partial download, share failure, cleanup
  failure, and retry.
- Assert the native share boundary receives a file URI ending in `.csv` and
  never receives the CSV body as `message`.
- Assert temporary filenames are unique per user/export and contain no token.

#### Exit criteria

- `rg "Share\.share|response\.text\(\)" mobile/src/screens mobile/src/services`
  finds no report-export text path.
- Android, iOS, and Windows each share/save a real CSV file and clean it up.
- ADR status changes to `Accepted` only after evidence is linked.

### B5. Finish runtime branding on mobile and refresh web branding

**Goal:** Make saved branding visible across signed-out and signed-in clients
without fixed primary-color bypasses.

#### Mobile semantic theme migration

- Make `useTheme().palette` the only runtime palette source inside mounted
  screens and shared components.
- Replace screen-local `getPalette(isDarkMode)` calls with `useTheme`, retaining
  direct `getPalette` only in theme tests and disconnected fallback code that
  genuinely has no workspace configuration.
- Replace rendered `colors.primary`, `colors.primaryDark`, and
  `colors.primaryLight` usage with semantic palette values. For values currently
  embedded in `StyleSheet.create`, move the color to a runtime style or use a
  memoized style factory keyed by the palette.
- Preserve fixed colors only as inputs to the bundled fallback palette.
- Add signed-in app-name/logo rendering to the authenticated shell or adaptive
  navigation header. Keep the bundled logo on image failure.
- Update the error boundary so its fallback uses the active theme instead of a
  hard-coded light mode.
- Confirm save/reset immediately updates the session branding and all mounted
  consumers without relaunching.

#### Web completion

- Keep the root branding provider/CSS-variable approach.
- Verify the installed Next.js 16 documentation for metadata, viewport, and
  Server Action revalidation before changing those paths.
- Ensure web save/reset invalidates or refreshes root branding so title, logo,
  and semantic colors update in the current session.
- Avoid three independent branding database reads per request when one
  request-scoped cached read can supply layout, metadata, and viewport safely.
- Test independent fallbacks for name, primary color, and remote-logo failure.

#### Source guard and tests

- Add a source test that permits fixed primary tokens only in theme/fallback
  implementation files and explicitly documented disconnected UI.
- Test at least one interactive signed-in component in light and dark modes
  with a non-default primary color.
- Test authenticated app name/logo, image failure, offline cached branding, and
  live save/reset propagation.

#### Verification

```powershell
npx vitest run tests/branding.test.ts tests/mobile-branding-route.test.ts
npm --prefix mobile test -- --runTestsByPath __tests__/branding.test.tsx __tests__/theme-tokens.test.ts __tests__/theme-context.test.tsx
rg -n "getPalette\(isDarkMode\)|colors\.primary" mobile/src mobile/App.tsx
```

Every remaining search result must be an intentional fallback/theme-definition
location documented in the source-guard allowlist.

### B6. Full verification and evidence reconciliation

**Goal:** Re-establish a release claim from reproducible commands and real
platform artifacts.

#### Automated verification

```powershell
supabase migration list --local
supabase db reset
npx vitest run tests/db-migrations.test.ts tests/supabase-migrations.test.ts tests/title-aligned-hierarchy.test.ts tests/mobile-session-store.test.ts tests/native-repository.test.ts tests/supabase-layouts.test.ts tests/mobile-layout-route.test.ts tests/action-policy.test.ts tests/mobile-admin-reports-export-route.test.ts tests/mobile-branding-route.test.ts tests/team-hierarchy-view.test.ts tests/branding.test.ts tests/layout.test.ts tests/mobile-contract-parity.test.ts tests/mobile-me-route.test.ts
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

Run native database integration tests with `TEST_DATABASE_URL` against a clean,
migrated PostgreSQL instance. Record command, commit SHA, backend, exit code,
test counts, and artifact location.

#### Platform evidence matrix

| Flow | Android | iOS | Windows |
| --- | --- | --- | --- |
| Personal/workspace layout separation | Required | Required | Required |
| Team member filter and clear/back behavior | Required | Required | Required |
| Signed-out/signed-in branding | Required | Required | Required |
| Non-empty CSV file share/save | Required | Required | Required |
| Empty/cancelled/failed export cleanup | Required | Required | Required |

For every cell, record runtime version, build/commit, tester/date, result, and a
log/screenshot/file artifact. iOS evidence must come from macOS CI plus a
simulator/device share-sheet run; Windows evidence must use the packaged app,
not only the JS Jest configuration.

#### Documentation finalization

- Update the implementation notes with actual results, not expected counts.
- Link the migration-history matrix and any approved repair operations.
- Link the accepted export ADR and three-platform evidence.
- Mark each B item complete independently; retain blockers for missing evidence.
- Restore the overall `Complete` state only when every acceptance item below is
  checked.

## Recommended commit sequence

1. `docs(mobile): reopen parity follow-up blockers`
2. `fix(db): reconcile Supabase migration history`
3. `fix(mobile): restore navigation type safety`
4. `fix(mobile): isolate member filters in route state`
5. `test(export): prove csv file flow on supported platforms`
6. `fix(export): share reports as temporary csv files`
7. `fix(branding): complete runtime workspace theming`
8. `test(mobile): close release blocker coverage`
9. `docs(mobile): record verified release evidence`

Do not combine migration-history repair with mobile UI changes. The export
compatibility proof must precede its production implementation.

## Final acceptance checklist

- [ ] Every Supabase environment has a backed-up, recorded history/schema matrix.
- [ ] Local migration timestamp prefixes are unique.
- [ ] The full Supabase chain applies cleanly from zero.
- [ ] Session rotation repair uses a new unambiguous forward version.
- [ ] Mobile lint and typecheck pass.
- [ ] Route filters have one source of truth and do not leak between screens.
- [ ] Direct out-of-scope report filters remain denied/scoped on both backends.
- [ ] Report export creates, shares/saves, and cleans a real CSV file on Android, iOS, and Windows.
- [ ] No report path shares CSV body text as a message.
- [ ] Signed-out and signed-in mobile/web surfaces use persisted branding.
- [ ] Mobile runtime UI no longer bypasses branded semantic colors.
- [ ] Both backend builds, root/mobile suites, Windows tests/bundle, database integration tests, and `git diff --check` pass.
- [ ] Notes and ADR contain reproducible commands and real platform evidence.

## References

- Supabase database migration workflow:
  <https://supabase.com/docs/guides/deployment/database-migrations>
- Supabase CLI migration list/repair reference:
  <https://supabase.com/docs/reference/cli/supabase-migration>
