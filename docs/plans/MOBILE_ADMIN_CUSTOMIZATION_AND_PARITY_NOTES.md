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
   - Added a prototype `mobile/src/services/csvExport.ts`; it currently shares CSV text and does not prove temporary-file export or cleanup on Android, iOS, or Windows.

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
