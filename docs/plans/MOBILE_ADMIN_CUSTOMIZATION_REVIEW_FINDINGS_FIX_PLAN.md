# Mobile Administration Review Findings Fix Plan

## Purpose

Close the five findings from the post-remediation review without reopening the
mobile navigation and compile fixes that already pass. This plan is a focused
continuation of
`MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_RELEASE_BLOCKER_FIX_PLAN.md`.

## Current baseline

- Branch: `mobile-dev`, HEAD `3bf7ec8`, with an uncommitted remediation delta.
- Root and mobile typecheck pass.
- Mobile lint passes with existing warnings.
- Focused root tests pass: 2 files / 22 tests.
- Focused mobile tests pass: 6 suites / 29 tests.
- Route-owned member filters and optional/default-false mobile capability
  compatibility are implemented.
- Local Supabase migration timestamp prefixes are unique, but the linked
  history cannot prove which SQL was applied as version `20260905000000`.
- Mobile report export controls were removed; no real file exporter replaced
  them.
- Authenticated branding is rendered only on the wide navigation rail.
- A failed remote logo remains failed after `logoUrl` changes until remount.
- The mobile tree still contains 19 direct `getPalette(isDarkMode)` calls and
  approximately 200 `colors.primary` references.

The branch remains release-blocked until every acceptance item below is met.

## Scope and rules

- Preserve the current route-parameter navigation behavior and compile fixes.
- Do not mutate linked migration history until the schema/history audit,
  backup, and operator approval are recorded.
- Do not assign a migration timestamp ad hoc. The repository already contains
  versions later than the current wall clock, so a release-owner migration
  version policy is required before generating the forward repair.
- Do not restore mobile export buttons until Android, iOS, and Windows pass the
  real-file spike.
- Never share CSV content through `Share.share({ message })`.
- Mounted authenticated UI must read semantic colors from `useTheme()`.
  Test convenience must not introduce a production fallback that bypasses the
  provider.
- Keep the bundled logo as the failure fallback and never log tokens or signed
  download URLs.

## Implementation order

### R1. Resolve the session-rotation migration identity

**Goal:** Guarantee that every target database executes the corrected
`rotate_mobile_session` definition exactly once through an unambiguous forward
migration.

#### R1.1 Complete the schema/history matrix

For local, development, staging, and production:

1. Record the backup/snapshot identifier and operator.
2. Save `supabase migration list` output.
3. Read and hash the live definition of
   `public.rotate_mobile_session(text, text, timestamptz)`.
4. Record function owner, `prosecdef`, `search_path`, and execute grants.
5. Compare the live function body with:
   - `20260904000000_mobile_sessions.sql`;
   - `20260905000000_fix_mobile_session_rotation.sql`.
6. Run a non-production refresh rotation and reuse-detection probe through the
   real RPC. Record the result without retaining refresh-token material.

Do not infer the function body from the migration-history row.

#### R1.2 Establish the next-version policy

The installed CLI generated `20260901104737`, which sorts before repository
versions through `20260910000000`. Before creating another file, the release
owner must select and record one of these repository-wide policies:

- reconcile the future-dated migration chain and every environment history; or
- allocate a monotonic post-head version through the team's approved migration
  process.

This is a STOP gate. Do not manually choose a timestamp or move the repair into
an already-applied version.

#### R1.3 Add the forward repair

After R1.2:

- Create one post-head migration containing the aliased, qualified function
  body currently in `20260905000000_fix_mobile_session_rotation.sql`.
- Pin `search_path = public, pg_temp`.
- Revoke execute from `PUBLIC`, `anon`, and `authenticated`; grant only to
  `service_role`.
- Make the migration safe whether the linked database has the original or
  corrected body.
- Remove the ambiguous repair file only after the canonical-chain decision is
  documented and clean-database application proves no SQL is lost.
- Extend `tests/supabase-migrations.test.ts` to require the latest rotation
  definition to be the post-head migration and to assert its grants and
  qualified table references.

#### R1 verification

```powershell
supabase migration list --local
supabase db reset
npx vitest run tests/supabase-migrations.test.ts tests/mobile-session-store.test.ts
```

Then run the linked migration list read-only and repeat the function-body/grant
probe. Any `migration repair` operation requires a separate approved runbook.

#### R1 exit criteria

- The latest rotation definition has an unambiguous post-head version.
- A clean database applies the full chain.
- Rotation and reuse detection pass through the real RPC.
- All target histories and live definitions are recorded.
- No public client role can execute the function.

### R2. Prove and restore real mobile CSV file export

**Goal:** Restore the removed report-export capability using real `.csv` file
artifacts on Android, iOS, and Windows.

#### R2.1 Define the platform boundary

Add a narrow interface independent of React components:

```ts
interface ReportFileExporter {
  export(request: ReportExportRequest): Promise<ReportExportOutcome>;
}
```

The request contains the authenticated endpoint, authorization header, query
filters, cancellation signal, and suggested filename. The typed outcome covers
`shared`, `saved`, `empty`, `cancelled`, and `failed` without exposing file
contents or tokens.

#### R2.2 Run the compatibility spike

- Evaluate exact pinned dependencies for React Native 0.84.1 and React Native
  Windows 0.84.0, including license, maintenance, autolinking, and Windows
  support.
- If no dependency supports all targets, implement owned Android, iOS, and
  Windows adapters behind `ReportFileExporter`.
- Each adapter must:
  - send the bearer token in a header;
  - stream to a unique app-owned temporary `.csv` file;
  - validate HTTP status, `Content-Type`, `X-Total-Count`, and a sanitized
    `Content-Disposition` filename;
  - invoke the native file share/save surface with MIME `text/csv`;
  - delete partial and complete files in `finally` after success,
    cancellation, timeout, and error.
- Record runtime version, filename/path without credentials, MIME type,
  share/save outcome, cleanup result, and screenshot/log for every platform.

This is a STOP gate. Keep export controls absent until all three adapters have
real artifact evidence.

#### R2.3 Replace the text API and reconnect both screens

- Replace `ApiClient.exportReportsCsv(): Promise<string>` and the corresponding
  session action with the typed file-export action.
- Preserve the single refresh-and-retry behavior after a 401.
- Abort on unmount and expose explicit retry for recoverable failures.
- Use the same action from `ReportsScreen` and `PrivilegedReportsScreen`.
- Restore accessible export controls, disabled while offline, loading, or
  already exporting.
- Report empty, cancelled, forbidden, and failed outcomes distinctly.
- Do not reintroduce `response.text()` for successful CSV responses.

#### R2 tests

- Unit-test empty, success, cancel, 401 refresh, 403, timeout, abort, invalid
  content type, malicious filename, disk failure, partial download, share
  failure, cleanup failure, and retry.
- Assert the native boundary receives a file URI ending in `.csv` and never a
  CSV body in a `message` field.
- Restore screen tests that verify both report screens invoke the shared typed
  action with their active filters.
- Keep server tests for empty, one page, multiple pages, paging changes, CSV
  injection, authorization, and mid-stream repository failures.

#### R2 exit criteria

- Both mobile report screens offer export again.
- Android, iOS, and Windows share/save a real file and clean it up.
- `rg "Share\.share|response\.text\(\)" mobile/src/screens mobile/src/services`
  finds no successful report-export text path.
- The CSV ADR becomes `Accepted` only after linking all platform evidence.

### R3. Make authenticated branding visible at every width

**Goal:** Show the current workspace name/logo on signed-in phones, tablets,
and Windows layouts, with live save/reset behavior.

#### Changes

- Extract a reusable `WorkspaceBrand` component that accepts branding, compact
  mode, semantic palette, and bundled fallback asset.
- Render it in the wide rail and in a compact authenticated-shell header above
  narrow-screen content. Do not rely on the bottom tab bar to carry a logo.
- Preserve screen titles and safe-area spacing; the compact header must not
  overlap the offline banner or consume the scrollable screen header.
- Reset image-failure state when `branding.logoUrl` changes, using a keyed image
  instance or an effect scoped to the URL.
- If a remote URL fails, show the bundled logo. When a corrected URL is saved,
  retry it immediately without requiring remount or sign-in.
- On reset, immediately show the default name, primary color, and bundled logo.

#### Tests

- Narrow and wide layouts render the configured app name.
- Narrow and wide layouts use the configured remote logo.
- Image failure switches to the bundled logo.
- Changing the failed URL retries the new URL.
- Save and reset update a mounted authenticated shell.
- Long app names truncate without hiding navigation controls.

#### R3 exit criteria

- Signed-in branding is visible below and above the 600px breakpoint.
- A corrected logo URL recovers during the same session.
- Offline cached branding and default fallbacks remain usable.

### R4. Complete the mobile semantic palette migration

**Goal:** Remove fixed-primary bypasses from mounted signed-in UI.

#### R4.1 Tighten the theme contract

- Use `useTheme().palette` directly in mounted screens and shared components.
- Remove `useScreenPalette` after tests wrap components in `ThemeProvider`.
- Keep `getPalette` only inside the theme implementation, theme tests, and
  explicitly documented disconnected UI rendered before workspace branding is
  available.
- Add any missing semantic tokens such as `primaryDark` and `onPrimary` to
  `Palette` rather than importing fixed equivalents at render sites.

#### R4.2 Migrate by dependency layer

Apply and test each layer before the next:

1. Shared primitives: `ScreenHeader`, `FilterTab`, `PressableScale` consumers,
   `OfflineBanner`, `EmptyState`, picker/modal components, entry cards, and
   `TimeEntryForm`.
2. Core employee screens: Home, Log/Edit Time, Timesheets, Reports, Leaves,
   Reminders, Profile, Team, and More.
3. Administration screens: projects, activities, users, settings, leaves,
   reminders, reports, and layout customization.
4. App shell: loading, pending approval, error boundary, authenticated header,
   and navigation.

For `StyleSheet.create` values that currently embed `colors.primary`, either
apply a runtime style at the rendered element or use a memoized style factory
keyed by the semantic palette. Remove unused static export styles left after
the export-button deletion.

#### R4.3 Add a source guard

Add a test that scans `mobile/App.tsx` and `mobile/src` and fails when:

- mounted authenticated screens call `getPalette(isDarkMode)`; or
- rendered UI imports `colors.primary`, `colors.primaryDark`, or
  `colors.primaryLight` outside the documented theme/fallback allowlist.

The initial inventory is 19 direct palette calls and about 200 fixed-primary
references. Every remaining match must be classified in the allowlist with a
reason.

#### R4 tests and exit criteria

- Test an interactive signed-in screen in light and dark modes using a
  non-default primary color.
- Assert progress bars, active filters, buttons, loaders, icons, badges, and
  refresh controls use the custom semantic primary.
- Verify contrast-sensitive foreground tokens remain legible.
- `rg -n "getPalette\(isDarkMode\)|colors\.primary" mobile/src mobile/App.tsx`
  returns only documented theme/disconnected fallbacks.

### R5. Full verification and evidence reconciliation

Run after R1-R4 are individually green:

```powershell
supabase migration list --local
supabase db reset
npx vitest run tests/supabase-migrations.test.ts tests/mobile-session-store.test.ts tests/mobile-admin-reports-export-route.test.ts tests/mobile-branding-route.test.ts tests/branding.test.ts tests/action-policy.test.ts
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
migrated PostgreSQL database. Record command, commit SHA, backend, exit code,
test count, and artifact path.

Update:

- `MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md` with each environment matrix and
  any separately approved repair operation;
- `mobile-csv-file-export.md` with the dependency/native-module decision and
  three-platform evidence;
- `MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_NOTES.md` with only newly reproduced
  results.

## Recommended commit sequence

1. `fix(db): add unambiguous mobile session rotation migration`
2. `test(export): prove report file export on mobile platforms`
3. `fix(export): restore mobile csv file export`
4. `fix(mobile): render branding across adaptive layouts`
5. `fix(mobile): complete semantic palette migration`
6. `test(mobile): guard export branding and theme regressions`
7. `docs(mobile): record verified remediation evidence`

Do not combine a migration-history repair with application code. Do not merge
the production export integration before the compatibility spike commit and
artifacts are reviewable.

## Final acceptance checklist

- [ ] Every target environment has a backup-linked schema/history matrix.
- [ ] The corrected rotation function is in an unambiguous post-head migration.
- [ ] Clean-database migration, refresh rotation, and reuse detection pass.
- [ ] Report export is restored in both mobile report screens.
- [ ] Android, iOS, and Windows create, share/save, and clean a real CSV file.
- [ ] No successful export buffers or shares CSV text as a message.
- [ ] Workspace name/logo are visible on narrow and wide authenticated layouts.
- [ ] A failed logo retries when its URL changes in the same mounted session.
- [ ] Mounted authenticated UI uses semantic runtime palette values.
- [ ] Theme source guard passes with a minimal documented fallback allowlist.
- [ ] Root/mobile lint, typecheck, tests, dual-backend builds, Windows bundle,
  database integration, and `git diff --check` pass.
- [ ] Notes and ADR contain reproducible commands and real platform artifacts.
