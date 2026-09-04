# Mobile Administration Post-Remediation Review Fix Plan

## Purpose

Close the five findings found while reviewing the uncommitted remediation delta
on `mobile-dev` at `7973d0b`. This plan is subordinate to
`MOBILE_ADMIN_CUSTOMIZATION_REVIEW_FINDINGS_FIX_PLAN.md`: its migration and
three-platform export STOP gates remain in force.

The work is corrective only. It must not be used to claim that mobile report
export or the branch as a whole is release-ready.

## Reviewed baseline

- The worktree contains an untracked
  `supabase/migrations/20260910000001_pin_mobile_session_rotation.sql` and
  documentation that calls its version policy release-owner approved.
- The audit matrix still lists the development, staging, and production
  operators and probes as pending; no approval evidence is recorded.
- `ReportFileExporter` is a typed core with a deliberately non-functional
  platform adapter. Report export controls remain absent while platform proof
  is pending.
- `exportWithRetry` refreshes credentials for every retryable outcome instead
  of only an unauthorized response.
- The export core accepts a missing `X-Total-Count` header and its filename
  sanitizer does not produce a Windows-safe filename.
- Mounted screens use `useScreenPalette`, whose production fallback hides a
  missing `ThemeProvider`, despite the parent plan requiring direct
  `useTheme().palette` access.
- Review verification passed mobile typecheck, focused root tests (57), and
  focused mobile tests (39). Mobile lint reported no errors and 44 warnings.
  These results describe the reviewed baseline, not the fixed state.

## Scope and invariants

- Do not modify linked migration history, run `migration repair`, or deploy a
  migration as part of this code-only correction.
- Do not invent or infer release-owner approval. Record the approver, decision,
  date, and approved version-allocation process only from real evidence.
- Do not restore report export controls or mark the CSV ADR `Accepted` until
  Android, iOS, and React Native Windows create, share/save, and clean up a real
  file.
- A token refresh is an authentication recovery operation, not a general
  network retry.
- A successful CSV response must satisfy the complete response contract before
  any temporary file is created.
- Every filename passed to a native adapter must be safe on Android, iOS, and
  Windows.
- Mounted authenticated UI must fail fast when rendered without
  `ThemeProvider`; only explicitly disconnected pre-branding UI may derive the
  bundled palette directly.

## Implementation order

### P1. Restore the migration approval STOP gate

#### P1.1 Correct the current evidence record

Update `docs/plans/MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md` so that R1.2 is
`pending release-owner decision`. Remove the statement that the policy was
accepted unless the repository can link to an actual approval record. Keep the
environment matrix pending where probes have not run.

Update `MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_NOTES.md` to distinguish:

- code drafted locally;
- tests run against migration text;
- operator-approved migration identity;
- live database and clean-database evidence.

Text-based migration tests must not be presented as proof of approval,
application, or live function behavior.

#### P1.2 Quarantine the unapproved migration identity

Until the release owner records the approved policy:

- remove the untracked `20260910000001` migration from the implementation
  delta rather than allowing it to be committed accidentally;
- remove or suspend assertions that require that manually selected filename;
- retain the corrected SQL body in the existing audit/plan or a non-migration
  reviewed patch so no database change is implied.

After approval, generate the migration through the approved repository process
and use the exact generated identifier everywhere. Do not rename a migration
that has been applied to any target. The forward migration must still:

- recreate `public.rotate_mobile_session(text, text, timestamptz)` with aliased
  and qualified references;
- pin `search_path = public, pg_temp`;
- revoke execution from `PUBLIC`, `anon`, and `authenticated`;
- grant execution only to `service_role`;
- be safe whether the target currently contains the original or corrected
  function body.

#### P1.3 Migration tests and evidence

After approval, update `tests/supabase-migrations.test.ts` to locate the approved
post-head definition and assert its body, `search_path`, grants, and ordering.
Then record, separately for local/development/staging/production:

- backup or snapshot identifier;
- operator and approval reference;
- local and remote migration lists;
- live function hash, owner, `prosecdef`, `search_path`, and grants;
- non-production refresh-rotation and reuse-detection result.

Any history repair remains a separately approved operator runbook.

#### P1 exit criteria

- No document claims approval that cannot be traced to a real approver.
- No manually selected migration filename is staged or committed.
- Once approved, the generated post-head identity is unique and consistent in
  the migration, tests, audit, and implementation notes.
- Clean-database and live probes are reported as pending until actually run.

### P2. Tighten the report export response and retry contracts

#### P2.1 Restrict refresh-and-retry to 401

In `mobile/src/services/reportFileExport.ts`, make `exportWithRetry` call
`refreshAccessToken` only when the first outcome is exactly:

```ts
{ kind: 'failed', retryable: true, reason: 'unauthorized' }
```

Return `network-error` and `download-incomplete` unchanged. Do not rotate auth
state for transport, stream, disk, validation, sharing, or cleanup failures.
Continue to allow at most one refresh and one reissued export request. Preserve
cancellation when the request aborts during refresh.

Add regression tests proving:

- a 401 refreshes once and retries once with the new token;
- a second 401 is returned without another refresh;
- network and partial-download failures never call the refresh callback;
- forbidden and other non-retryable outcomes never refresh;
- refresh rejection preserves the original unauthorized outcome;
- abort during refresh returns `cancelled`.

#### P2.2 Require a valid total-count contract

Validate `X-Total-Count` before creating a temporary file:

- `204` is `empty` only when the header is the canonical integer `0`;
- `200` requires a canonical non-negative integer header;
- `200` with `0` returns `empty` without touching the file adapter;
- `200` with a positive count may proceed;
- a missing, negative, decimal, whitespace-padded, or otherwise malformed value
  returns a non-retryable `invalid-total-count` failure.

Keep content-type and authorization validation ahead of file creation. Add
tests that assert the file and share adapters are not called for every invalid
or empty response.

If compatibility requires accepting a legacy missing header, document that as
a versioned server contract and add a measured fallback. Do not silently accept
it in this implementation.

#### P2.3 Produce a cross-platform-safe filename

Replace the current separator-only sanitizer with one shared by every platform
adapter. The sanitizer must:

1. extract only the filename component and discard path traversal;
2. remove control characters and replace `<>:"/\\|?*` with a safe separator;
3. trim surrounding whitespace and trailing Windows dots/spaces;
4. reject `.` and `..` and Windows device names (`CON`, `PRN`, `AUX`, `NUL`,
   `COM1`-`COM9`, and `LPT1`-`LPT9`), including names followed by `.csv`;
5. use `timesheet_report.csv` when sanitization produces no usable basename;
6. force exactly one `.csv` extension without creating `.csv.csv`;
7. cap the final filename to a conservative platform-safe length while
   retaining the extension.

Keep unique temporary-path creation inside the file adapter; the response
filename must never control a directory. Extend tests with traversal, reserved
characters, device names, trailing dots/spaces, empty input, long Unicode names,
mixed-case extensions, and the reviewed `../../evil?.csv` case. Assert the
exact sanitized filename, not only the absence of `/` and `\\`.

#### P2.4 Keep the platform STOP gate visible

The production `reportFileExporter` may remain the explicit
`native-file-export-not-ready` adapter until the compatibility spike is done.
Do not reconnect either report screen during this correction. Update the CSV
ADR and implementation notes to say that the typed core is hardened but no
native file workflow has been accepted.

#### P2 exit criteria

- Only an unauthorized outcome can invoke token refresh.
- Every successful response has a validated total count before file creation.
- All native adapters receive a portable `.csv` basename.
- Tests cannot pass while accepting `evil?.csv`, a reserved device name, or a
  missing total-count header.
- Export controls and ADR status remain gated on three-platform evidence.

### P3. Enforce the mounted theme-provider contract

#### P3.1 Remove the production fallback

Delete `useScreenPalette` from `mobile/src/theme/ThemeContext.tsx` and its
re-export from `mobile/src/theme.ts`. Migrate every mounted authenticated
consumer to:

```ts
const { palette } = useTheme();
```

Continue passing `isDarkMode` only where behavior other than palette selection
needs it. Do not catch the `useTheme` missing-provider error or reproduce the
fallback under another helper name.

`getPalette` remains permitted only in the theme implementation, theme unit
tests, and documented disconnected UI rendered before workspace branding is
available.

#### P3.2 Fix test composition instead of production behavior

Create or reuse a test render helper that wraps mounted screens/components in a
real `ThemeProvider` with configurable mode and primary color. Update affected
fixtures to use that wrapper. Add one contract test showing that a mounted
consumer outside `ThemeProvider` throws the expected error, and retain custom
primary tests for both light and dark modes.

#### P3.3 Strengthen the source guard

Update `mobile/__tests__/theme-source-guard.test.ts` so it fails when mounted
authenticated code:

- imports or calls `useScreenPalette`;
- calls `getPalette(isDarkMode)`;
- renders with `colors.primary`, `colors.primaryDark`, or
  `colors.primaryLight` outside the narrow documented disconnected allowlist.

Remove `ThemeContext.tsx` as a fallback allowance after the helper is gone.
Keep the allowlist explicit and exact; a new entry must include a reason and a
test proving the code is genuinely pre-branding/disconnected.

#### P3 exit criteria

- `rg -n "useScreenPalette" mobile/App.tsx mobile/src` returns no matches.
- Every mounted authenticated screen obtains its palette from `useTheme()`.
- Rendering such a screen without `ThemeProvider` fails instead of silently
  using the bundled palette.
- Light/dark custom-brand tests and the tightened source guard pass.

### P4. Verification and evidence reconciliation

Run focused tests while each phase is being changed:

```powershell
npx vitest run tests/supabase-migrations.test.ts tests/mobile-session-store.test.ts
npm --prefix mobile test -- --runInBand __tests__/report-file-export.test.ts
npm --prefix mobile test -- --runInBand __tests__/theme-source-guard.test.ts __tests__/theme-tokens.test.ts __tests__/workspace-brand-shell.test.tsx
npm --prefix mobile run typecheck
npm --prefix mobile run lint
git diff --check
```

After P1-P3 are green, run the parent plan's complete verification matrix:

```powershell
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

Run database integration only against an explicitly provisioned, migrated test
database. Record command, commit SHA, backend, exit code, test count, and
artifact path. Never copy credentials, refresh tokens, or signed URLs into the
evidence documents.

## Recommended commit sequence

1. `docs(db): restore mobile migration approval gate`
2. `fix(export): harden report file response contract`
3. `test(export): cover retry and portable filename failures`
4. `fix(mobile): enforce theme provider palette access`
5. `test(mobile): tighten authenticated theme source guard`
6. `docs(mobile): reconcile post-remediation evidence`

The approved migration should be a separate later commit, for example
`fix(db): add approved mobile session rotation migration`, only after P1's
external decision and evidence exist. Do not mix a migration-history operation
with application-code commits.

## Final acceptance checklist

- [ ] The migration audit contains no unsupported approval claim.
- [ ] No unapproved/manual migration identifier is included in the change set.
- [ ] If approval has arrived, its decision and generated migration identity are
      recorded consistently with clean/live verification state.
- [ ] Token refresh occurs only after a 401-derived unauthorized outcome.
- [ ] Missing or malformed `X-Total-Count` fails before file creation.
- [ ] Export filenames are safe on Android, iOS, and Windows.
- [ ] The typed export core tests cover the reviewed retry, header, and filename
      regressions.
- [ ] `useScreenPalette` is removed and mounted UI uses `useTheme().palette`.
- [ ] Tests render mounted UI through `ThemeProvider`, and the source guard
      rejects production fallbacks.
- [ ] Export controls remain absent and the ADR remains unaccepted until real
      Android, iOS, and Windows artifacts exist.
- [ ] Focused and full root/mobile verification passes with results recorded
      without overstating pending operator or platform work.
