# Export and Android configuration repair — 2026-10-01

## Decision and acceptance

Repair the missing exporter import without accepting additional source schemas.
Replace the shared machine-specific Android CMake path with an optional Gradle
property; use Android Gradle Plugin defaults unless the operator selects a path.

Acceptance: web and migration type checks pass; exporter tests cover matching,
divergent, and unavailable legacy-name counts and schema/provider isolation;
Android configuration works with its default and an explicit staging override.

## Evidence and constraints

- FACT: `tools/migration/src/export.ts` imports a nonexistent
  `LEGACY_SUPABASE_SCHEMA_FINGERPRINT` and already contains a read-only
  `assertLegacyProfileData` guard. Serena references show only the exporter calls it.
- FACT: `tools/migration/src/schema.ts` fingerprints extra entity columns and
  accepts only exact provider fingerprints. `tools/migration/src/cli.ts` rejects
  unsupported source schemas before export. Adding a legacy fingerprint would
  widen the migration contract beyond this repair.
- FACT: `CatalogInspection.columns` identifies table and column names. Detecting
  `profiles.full_name` there can select the existing guard inside the exporter's
  repeatable-read snapshot without altering schema acceptance.
- FACT: `mobile/android/app/build.gradle` currently assigns every checkout the
  same `C:/tmp/cxx` directory. Existing build options use Gradle properties.
- INFERENCE: an opt-in `cmakeStagingDir` preserves the short-path workaround while
  defaults remain portable and isolated per checkout. Operators must choose a
  distinct override directory for concurrently built checkouts.
- UNKNOWN: live legacy-profile database behavior and native Android compilation
  need a suitable disposable database and complete native toolchain respectively.

## Alternatives and lifecycle

Reject adding a new accepted schema fingerprint: that requires a separate source
compatibility decision. Keep the legacy-name guard selected by catalog presence;
reject divergent or unavailable counts before writing entity files or a manifest.
Normal export, failure cleanup, retry directory rules, and source schema gates
stay unchanged. The Android override is build configuration, with no runtime,
authentication, database migration, or release-version change. Reverting this
patch requires no deployment operation.

## Verification

Run focused exporter/schema tests, migration and root lint/type checks, the full
migration suite, and Android Gradle configuration checks for default and override
paths. Record unavailable native/database checks explicitly.

## Results

- Focused exporter/schema tests: 24 passed, including six new guard regressions.
- Full migration suite: 339 passed; 26 database integration tests skipped because
  their disposable-database prerequisites were not configured.
- Root and migration lint/type checks passed. Native and Supabase production
  builds passed; the Supabase build loaded `.env.local` using Next.js's standard
  environment loader and retained the Auth configuration gate.
- Gradle configuration succeeded. A temporary verification task asserted the
  actual default CMake staging value and an explicit relative override; both
  passed. No Android APK compilation or installed-app testing was performed.
- Closure review found no additional correctness defect. Source schema
  acceptance remains unchanged.
