# Mobile Administration, Customization, and Parity Implementation Notes

## Remediation in progress

The implementation slices landed, but the release evidence below was found to
overstate their completion. The release-blocker remediation is tracked in
`MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_RELEASE_BLOCKER_FIX_PLAN.md`.

### Follow-up Fixes (F1–F6)

1. **F1 (`fix(db): repair title reclassification migration and regression test`)**:
   - Repaired Supabase RPC signature to `reclassify_title_atomic(text, text, boolean)` with robust textual hierarchy role validation.
   - Updated `tests/supabase-migrations.test.ts` to assert against invalid enum casts.

2. **F2 (`fix(layout): implement tri-state default layout persistence and capability gating`)**:
   - Implemented tri-state persistence on `nativeRepository.setDefaultLayouts` and `supabaseRepository.setDefaultLayouts` (`undefined` = preserve, `null` = clear to factory default, `MobileLayout` = JSON override).
   - Added `canManageWorkspaceCustomization` capability on both server and mobile actor interfaces.
   - Updated `LayoutCustomizerScreen.tsx` with separate drafts (`personalModules` vs `workspaceModules`) and capability gating.

3. **F3 (`fix(navigation): preserve team member filter into reports navigation`)**:
   - Added `RouteParams` and stack entry param tracking in `navigation-reducer.ts`.
   - Updated `ReportsScreen.tsx` and `getReportsService` (`/api/v1/reports`) to support `userId` filter scoping.
   - Added member filter banner with clear filter button.

4. **F4 (`feat(reports): cross-platform CSV file export workflow and spike`)**:
   - Published architectural spike: `docs/architecture/mobile-csv-file-export.md`.
   - Updated `/api/v1/reports/export` to return HTTP 204 on 0 rows and include `X-Total-Count` header with efficient single-query first-page streaming.
   - The initial `csvExport.ts` prototype shared CSV text and was removed. The
     current `reportFileExport.ts` typed core is mocked/tested only; its
     production adapter returns `native-file-export-not-ready` until Android,
     iOS, and Windows temporary-file/share/cleanup evidence exists.

5. **F5 (`feat(branding): apply workspace branding at runtime across web and mobile`)**:
   - Added pure `derivePalette` 10-shade tonal scale derivation in `lib/branding.ts`.
   - Connected Tailwind `@theme inline` in `app/globals.css` to root CSS custom properties.
   - Integrated `BrandingProvider` in `app/layout.tsx` for dynamic web titles, logos, and styling.
   - Updated `ThemeProvider` and `getPalette` in mobile for runtime workspace branding themes.

6. **F6 (`test(all): full verification suite and rollout evidence`)**:
   - Verification must be rerun after the release-blocker remediation. No platform evidence has been recorded for the file export workflow.

---

## Reviewed baseline (2026-09-01)

- Root lint and root typecheck previously passed, but that is not a release claim for the new mobile work.
- Mobile TypeScript had compile failures in `App.tsx`, navigation test fixtures,
  and `ReportsScreen`; remediation is in progress and must be verified afresh.
- The Supabase migration history needs a per-environment schema/history matrix;
  no linked or production history repair has been run from this branch.
- CSV server streaming is implemented, but no Android, iOS, or Windows proof
  exists for writing, sharing/saving, and cleaning a real CSV file.

## Release state

Do not treat this branch as release-approved until the remediation plan records
fresh command output and platform evidence for each blocker.

## Newly reproduced remediation results (2026-09-01, review-findings fix pass)

Only results reproduced in this pass are listed (commands as run):

- Migration identity (R1, pre-quarantine result):
  `npx vitest run tests/supabase-migrations.test.ts` → 17 passed against the
  then-drafted `20260910000001` file. That result proved repository text only;
  the unapproved migration was subsequently removed and the current quarantine
  guard replaced the filename assertion. Operator probes remain pending (see
  `MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md`).
- R1+R2 focused root tests: mobile-session-store, mobile-admin-reports-export-route,
  mobile-branding-route, branding, action-policy → 40 passed.
- Export core (R2): `npx jest --runInBand __tests__/report-file-export.test.ts`
  → 20 passed. Typed `ReportFileExporter` in `mobile/src/services/reportFileExport.ts`;
  session action `exportReportsFile`; `client.ts` `exportReportsCsv` removed.
  No `Share.share({message})` and no `response.text()` for success remain.
  Screens stay without export controls per R2.2 STOP gate (device evidence
  pending).
- Branding across widths (R3): `workspace-brand-shell.test.tsx` → 9 tests
  (narrow + wide name/logo, failure fallback to bundled asset, corrected-URL
  retry in the same session, reset to defaults, long-name truncation,
  save/reset updating the mounted shell). `WorkspaceBrand` shared component;
  compact authenticated-shell header added for narrow layouts.
- Semantic palette (R4): all mounted screens/components migrated off
  `colors.primary/primaryDark/primaryLight/onPrimary`; `Palette` gained
  `primaryDark` and `onPrimary`; unused `exportBtn` styles removed from both
  report screens. Mounted UI now reads the provider palette via
  `useTheme().palette` after the P3 enforcement pass below, and the source
  guard is tightened under P3.3 with an exact allowlist (`theme.ts`,
  `SignInScreen.tsx`, and `App.tsx` disconnected components only).
- Full mobile verification in this pass: `npx jest --runInBand` → 42 suites /
  189 tests passed; `npx tsc --noEmit` → 0 errors; `npx eslint .` → 0 errors
  (pre-existing warnings unchanged). Root R1/R2 focused tests pass as listed
  above. Root/mobile full suites, dual-backend builds, Windows bundle, and DB
  integration remain to be re-run in the R5 verification stage with recorded
  commands.

## Evidence-type disclaimer and post-remediation reconciliation (2026-09-01)

Results recorded in this document are evidence of **code drafted locally and
tests run against migration text / unit mocks** only. They are NOT release
approval, migration application, clean-database, or live-behavior evidence:

- `tests/supabase-migrations.test.ts` and `report-file-export.test.ts` assert
  file/unit behavior in-process. No local Supabase stack, direct SQL/live-
  function query, or provisioned Postgres was exercised here. A separate
  read-only `supabase migration list --linked` result is recorded in the audit;
  it proves version-list visibility, not live function contents.
- The `rotate_mobile_session` forward migration drafted as
  `20260910000001_pin_mobile_session_rotation.sql` was **quarantined** (removed
  from the change set): its version was manually selected and no release owner
  approved a version-allocation process. The corrected SQL body remains
  reviewable in `20260905000000_fix_mobile_session_rotation.sql` and the audit
  document. Operator-approved migration identity and live/clean-database probes
  are pending.
- Report export screens remain without export controls and the CSV ADR remains
  unaccepted; both stay gated on real Android, iOS, and Windows file artifacts.

## P3 enforcement pass (2026-09-01) — theme-provider contract

Mounted authenticated UI now reads the runtime palette from `useTheme()` and
fails fast when rendered without `ThemeProvider`:

- `useScreenPalette` was deleted from `mobile/src/theme/ThemeContext.tsx` and
  its re-export removed from `mobile/src/theme.ts`; every mounted screen and
  `TimeEntryForm` uses `const palette = useTheme().palette`. `rg "useScreenPalette"
  mobile/App.tsx mobile/src` returns no matches.
- Test fixtures now compose a real `ThemeProvider` via
  `mobile/test-utils/theme-fixture.tsx` (`ScreenTheme`, configurable mode +
  primary color); 18 fixture files were wrapped. A contract test proves a
  mounted consumer outside `ThemeProvider` throws the expected error, and the
  custom primary is verified in both light and dark modes.
- The source guard (`theme-source-guard.test.ts`) now rejects any
  `useScreenPalette` reference anywhere, keeps `getPalette(isDarkMode)` and
  `colors.primary/primaryDark/primaryLight` out of mounted code, and its
  allowlist is exactly `theme.ts`, `SignInScreen.tsx`, and `App.tsx`
  (disconnected components, enforced by a dedicated test).
- Full mobile suite in this pass: 202 tests passed; typecheck and lint (0
  errors) clean.

## Second review correction pass (2026-09-02)

This pass implements
`MOBILE_ADMIN_CUSTOMIZATION_SECOND_REVIEW_FIX_PLAN.md` while preserving the
migration-approval and three-platform export STOP gates:

- **Migration evidence wording:** removing the locally drafted
  `20260910000001` file is now described only as change-set quarantine. No
  application was performed or evidenced by this pass, and every target's
  actual state remains pending a fresh history/live-function probe. The audit
  distinguishes read-only linked migration-list access from unavailable direct
  SQL inspection and operator authorization.
- **Exact response protocol:** the mocked export core accepts only `200` and
  `204`; unexpected successful responses such as `201`, `202`, and `206` fail
  before stream, file, cleanup, or share calls. A status/`ok` disagreement also
  fails closed. `X-Total-Count` accepts only `0` or a positive decimal without
  leading zeros.
- **Portable pure-core filenames:** Windows device-name stems are rejected even
  with additional extensions. Sanitization iterates complete Unicode code
  points, removes unpaired surrogates, and caps the basename at 240 UTF-8 bytes
  (244 including `.csv`). This is mocked/pure-core evidence only; native device
  behavior remains pending.
- **ADR reconciliation:** the obsolete text-sharing path is identified as
  removed, the typed core and placeholder production adapter are distinguished,
  and the intended workflow is not presented as native implementation proof.

Fresh commands and results:

```text
npm --prefix mobile test -- --runInBand __tests__/report-file-export.test.ts
  1 suite / 33 tests passed
npm --prefix mobile run typecheck
  passed
npm --prefix mobile run lint
  0 errors / 43 existing warnings
npm --prefix mobile test -- --runInBand
  42 suites / 205 tests passed
npm run lint
  passed
npm run typecheck
  passed
npm test
  80 files passed, 1 skipped / 685 tests passed, 1 skipped
npm --prefix mobile run test:windows
  42 suites / 205 tests passed
npm --prefix mobile run bundle:windows
  passed; wrote a fresh Windows bundle and asset
```

No migration was added or applied by this pass, no history repair was run,
export controls remain absent, and no Android/iOS/Windows file artifact was
produced by a native export flow.
