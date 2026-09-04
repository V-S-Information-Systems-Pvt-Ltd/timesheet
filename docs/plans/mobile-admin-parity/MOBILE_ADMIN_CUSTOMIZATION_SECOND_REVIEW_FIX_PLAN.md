# Mobile Administration Second Review Fix Plan

## Purpose

Close the four findings from the review of `mobile-dev` at `19848f3` without
reopening the completed theme-provider and authentication-retry corrections.
This plan continues:

- `MOBILE_ADMIN_CUSTOMIZATION_REVIEW_FINDINGS_FIX_PLAN.md`; and
- `MOBILE_ADMIN_CUSTOMIZATION_POST_REMEDIATION_REVIEW_FIX_PLAN.md`.

Their migration-approval and three-platform export STOP gates remain binding.
This pass hardens the platform-neutral export core and corrects documentation;
it does not authorize a database migration or enable report export controls.

## Reviewed baseline

- Worktree: clean on branch `mobile-dev`, HEAD `19848f3`.
- The manually named `20260910000001` migration has been removed and the
  release-owner version-policy decision remains pending.
- The migration audit nevertheless states that the removed migration was never
  applied to any database, although the target histories and live functions
  have not been re-probed.
- `ReportFileExporter` refreshes only after an unauthorized outcome and requires
  `X-Total-Count`, but it accepts any response whose transport marks `ok`,
  including unexpected successful statuses such as `206 Partial Content`.
- The total-count regex accepts non-canonical strings such as `00` and `01`.
- Filename sanitization handles traversal and basic Windows characters, but it
  misses device names with extra extensions and truncates by UTF-16 code units
  rather than a cross-platform byte budget.
- The CSV ADR contains both the obsolete buffered-text description and the
  current typed-core/placeholder description.
- Review verification: mobile full suite 42 suites / 202 tests passed; mobile
  typecheck passed; mobile lint had 0 errors / 44 warnings; focused root Vitest
  had 3 files / 27 tests pass. These describe the baseline, not the fixed state.

## Scope and rules

- Do not run `supabase migration repair`, apply a migration, or edit linked
  history in this pass.
- Do not state that a migration was or was not applied unless the statement is
  supported by a dated target-specific history or live-schema probe.
- Accept only the two response statuses defined by the export protocol: `200`
  for a non-empty CSV and `204` for an empty result.
- Never share a partial, asynchronous, or otherwise unexpected 2xx response as
  a completed report.
- Treat an `X-Total-Count` string as canonical only when it is exactly `0` or a
  positive decimal integer without whitespace, sign, decimal point, exponent,
  or leading zero.
- Filename output must be valid on Android/Linux filesystems, iOS, and Windows;
  truncation must not split a Unicode scalar value or exceed the selected UTF-8
  byte budget.
- Keep `reportFileExporter` as the explicit
  `native-file-export-not-ready` adapter and keep both export controls absent
  until the existing device-evidence gate is satisfied.
- Keep the CSV ADR status `Proposed` until real Android, iOS, and React Native
  Windows evidence is linked.

## Implementation order

### S1. Correct migration evidence claims

#### S1.1 Scope the non-application statement

In `docs/plans/MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md`, replace every
absolute statement that `20260910000001` “was never applied” with a scoped,
verifiable statement:

> No application of this migration was performed or evidenced by this
> implementation pass. Its state in each target environment remains pending a
> fresh migration-history and live-function probe.

Deleting a local file proves only that it is absent from the current change
set. It does not prove the state of local, development, staging, production, or
any manually operated database.

#### S1.2 Reconcile the linked-project wording

The audit already records a successful read-only
`supabase migration list --linked`, so do not later say there are no linked
project credentials without qualification. Distinguish among:

- CLI/project linkage sufficient to read migration history;
- direct database credentials required for SQL/live-function inspection;
- a running local Supabase stack;
- operator authorization to mutate history or schema.

If direct SQL credentials were unavailable, say exactly that. Do not erase the
earlier linked-list result, and do not infer function contents from it.

#### S1.3 Preserve the STOP gate

Keep the following states explicit and independent:

- migration version policy: pending release-owner decision;
- approved post-head migration identity: none;
- application state per target: unknown until freshly probed;
- clean-database proof: pending;
- live rotation/reuse-detection proof: pending;
- history repair: not authorized and not performed by this pass.

Do not add a new migration or change the quarantine test during S1.

#### S1 tests and exit criteria

- `rg -n "never applied|no linked project credentials"` finds no unqualified
  claims in the audit or implementation notes.
- The environment matrix remains pending where no real probe exists.
- A reviewer can tell which evidence came from repository text, CLI migration
  history, direct SQL inspection, or an operator action.
- No migration file or migration-history mutation is part of the S1 commit.

### S2. Enforce the exact HTTP export protocol

#### S2.1 Validate status independently of `response.ok`

In `mobile/src/services/reportFileExport.ts`, classify the status immediately
after transport completion:

1. `401` -> retryable `unauthorized`;
2. `403` -> non-retryable `forbidden`;
3. `204` -> continue only to the empty-response header validation;
4. `200` -> continue to the non-empty/zero-count response validation;
5. every other status, including `201`, `202`, `206`, redirects exposed by an
   adapter, and all other 4xx/5xx responses -> non-retryable failure carrying a
   stable status reason such as `http-206`.

Do not use `response.ok` as the acceptance criterion. It may remain a transport
field for diagnostics, but status is the protocol authority. A `200` marked
`ok: false` should be treated as a transport-contract inconsistency, not silently
accepted; either remove `ok` from `ReportHttpResponse` or explicitly reject
status/`ok` disagreement with a stable failure reason.

The exporter must not call `response.stream`, `createTempUri`, `file.write`, or
`share.invoke` for an unexpected status.

#### S2.2 Tighten canonical total-count validation

Use the canonical decimal grammar:

```text
0 | [1-9][0-9]*
```

Then enforce:

- `204` requires exactly `X-Total-Count: 0` and never reads the body;
- `200` requires a canonical count;
- `200` plus `0` returns `empty` without creating a file;
- `200` plus a positive canonical count proceeds to content-type and filename
  validation;
- missing, empty, signed, whitespace-padded, decimal, exponential, or
  leading-zero values return non-retryable `invalid-total-count`.

Do not parse through `Number` before grammar validation because it would
normalize malformed representations. The code only needs to distinguish zero
from positive; it does not need to convert an arbitrarily large count to a JS
number.

#### S2.3 Response-contract regression tests

Extend `mobile/__tests__/report-file-export.test.ts` with table-driven cases for:

- `201`, `202`, and `206` with otherwise valid CSV headers;
- a status/`ok` disagreement;
- count values `00`, `01`, `+1`, `-1`, `1.0`, `1e3`, ` 1`, `1 `, empty, and
  missing;
- valid `0`, `1`, and a large digit-only positive value;
- `204` with `0`, with `00`, and without the header.

For every rejected case, assert that stream, temp-file, write, cleanup, and
share surfaces are untouched. Retain the existing 401-only refresh tests.

#### S2 exit criteria

- Only `200` and `204` can reach success/empty handling.
- A `206` can never be written or shared as a complete CSV.
- Only canonical total-count strings are accepted.
- Invalid response metadata causes no filesystem or share side effects.

### S3. Make filename sanitization genuinely cross-platform

#### S3.1 Define the final filename invariant

For every input, `sanitizeExportFilename` must return a basename that:

- contains no path separator, C0 control, DEL, or `<>:"/\\|?*` character;
- is neither `.` nor `..`;
- does not have a Windows device-name stem, case-insensitively, even when the
  source has one or more extensions (for example `CON.txt`, `nul.data.csv`, or
  `LPT1.backup`);
- has no trailing dot or space;
- ends in exactly one lowercase `.csv`;
- is valid Unicode and never ends with a lone surrogate;
- fits within a documented UTF-8 byte budget, including the `.csv` extension;
- falls back to `timesheet_report.csv` when no safe basename remains.

Use a conservative final limit of 244 UTF-8 bytes (240-byte basename plus the
four-byte `.csv` extension), leaving headroom below common 255-byte component
limits while also remaining below Windows' component-length limit.

#### S3.2 Correct reserved-name detection

After path removal, character replacement, trimming, and removal of repeated
`.csv` suffixes:

1. normalize the candidate consistently (NFC where supported by the JS
   runtime);
2. inspect the portion before the first `.` after trimming Windows-normalized
   spaces/dots;
3. reject `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, and `LPT1`-`LPT9` for that
   stem regardless of later extensions;
4. repeat the safety check after truncation and extension reconstruction.

Do not rely on an exact match against the entire basename.

#### S3.3 Truncate by complete code points and UTF-8 bytes

Replace `slice(0, MAX_EXPORT_BASENAME)` with a small pure helper that iterates
Unicode code points (`for...of`) and calculates each code point's UTF-8 width.
Append a code point only when adding it keeps the basename within the byte
budget. This avoids both:

- producing more than 244 UTF-8 bytes from CJK or other multibyte text; and
- splitting an emoji/supplementary character into a lone UTF-16 surrogate.

Do not add a native dependency merely for this calculation. Keep the helper
platform-neutral and deterministic under Jest and React Native. If it is
exported for direct testing, keep it narrowly named and document that its input
must already be sanitized.

#### S3.4 Filename regression tests

Add exact-output or invariant tests for:

- `CON`, `CON.csv`, `CON.txt`, `con.txt.csv`, `NUL.data`, `COM1.backup`, and
  `LPT9.anything`;
- ordinary dotted names such as `report.final.csv`, which must remain usable;
- traversal and the reviewed `../../evil?.csv` case;
- repeated extensions and mixed-case `.CSV`;
- trailing spaces/dots and empty/dot-only names;
- a CJK filename whose pre-fix form exceeded 255 UTF-8 bytes;
- an emoji filename positioned so a 100-code-unit slice would split a surrogate
  pair;
- a long ASCII name;
- the default fallback.

Test the UTF-8 byte invariant with a test-only code-point byte counter compatible
with the mobile TypeScript configuration; do not introduce Node-only types into
production mobile code. Assert that the resulting string contains no unpaired
surrogate.

#### S3 exit criteria

- `CON.txt` and every other device-name-with-extension case fall back safely.
- Every output is at most 244 UTF-8 bytes including `.csv`.
- No output truncation creates an unpaired surrogate.
- Existing traversal, invalid-character, and exact-extension tests continue to
  pass.

### S4. Reconcile the CSV ADR and implementation notes

#### S4.1 Describe the current state once

Rewrite the start of “Proposed platform-neutral client workflow” in
`docs/architecture/mobile-csv-file-export.md` to state:

- the previous implementation buffered CSV and shared message text;
- that unsafe path has been removed;
- the current code contains a tested platform-neutral typed core;
- the production platform factory deliberately returns
  `native-file-export-not-ready`;
- both report screens intentionally have no export controls;
- native Android/iOS/Windows adapters and device evidence are pending.

Present the workflow diagram as the intended/partially implemented design, not
as either a fully working feature or the obsolete text-sharing prototype.

#### S4.2 Reconcile counts and evidence labels

Update the ADR and
`docs/plans/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_NOTES.md`
after tests run:

- replace stale per-file test counts with the newly observed count;
- distinguish mocked typed-core tests from native adapter/device evidence;
- record strict-status, canonical-count, device-name, and byte-limit coverage;
- keep status `Proposed` and explicitly retain the platform STOP gate;
- avoid “implemented”, “verified”, or “cross-platform-safe” without specifying
  whether the statement refers to pure core behavior or real devices.

#### S4 exit criteria

- The ADR contains no claim that the current code still calls
  `response.text()` or `Share.share({ message })` for successful exports.
- It also contains no claim that real native file export works.
- Test counts and commands match fresh output.
- Pending platform and operator work remains plainly visible.

### S5. Verification

Run the targeted checks after each implementation slice:

```powershell
npm --prefix mobile test -- --runInBand __tests__/report-file-export.test.ts
npm --prefix mobile run typecheck
npm --prefix mobile run lint
npx vitest run tests/supabase-migrations.test.ts tests/mobile-session-store.test.ts tests/mobile-admin-reports-export-route.test.ts
rg -n "never applied|no linked project credentials" docs/plans/MOBILE_SUPABASE_MIGRATION_HISTORY_AUDIT.md docs/plans/mobile-admin-parity/MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_NOTES.md
rg -n "response\.text\(\)|Share\.share|native-file-export-not-ready|Status" docs/architecture/mobile-csv-file-export.md mobile/src
git diff --check
```

Then run the applicable full local verification:

```powershell
npm run lint
npm run typecheck
npm test
npm --prefix mobile run lint
npm --prefix mobile run typecheck
npm --prefix mobile test -- --runInBand
git diff --check
```

Do not claim the parent plan's dual-backend builds, Windows bundle, database
integration, migration application, or device checks unless those commands are
actually run and their artifacts are recorded.

## Recommended commit sequence

1. `docs(db): scope mobile migration evidence claims`
2. `fix(export): enforce exact csv response status contract`
3. `fix(export): make report filenames byte-safe`
4. `test(export): cover status count and filename edge cases`
5. `docs(mobile): reconcile csv export architecture state`

Keep S1 documentation independent from export code. Do not include a migration
file or external database operation in any of these commits.

## Final acceptance checklist

- [ ] No unprobed target is described as having or not having the quarantined
      migration.
- [ ] Linked migration-history access is distinguished from direct SQL access
      and operator authorization.
- [ ] Only `200` and `204` are accepted by the export core.
- [ ] `206 Partial Content` and other unexpected 2xx statuses have no file/share
      side effects.
- [ ] Only canonical `X-Total-Count` values are accepted.
- [ ] Device names remain rejected even when followed by another extension.
- [ ] Final filenames fit the documented UTF-8 byte budget and contain no split
      surrogate pairs.
- [ ] The CSV ADR accurately distinguishes removed behavior, current typed-core
      behavior, the placeholder production adapter, and pending device work.
- [ ] Focused and full local tests, typechecks, lint, and `git diff --check` pass
      with fresh results recorded.
- [ ] Migration approval/application and three-platform export gates remain
      pending unless backed by newly recorded external evidence.
