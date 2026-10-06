# Timesheet Type and Activity Implementation Plan

## Summary

Replace the Project + Type selection for new timesheet entries with an explicit Type → Activity structure. Project is a Type, and the project picker appears only for Project entries. Support and Internal entries do not reference a project. Keep existing timesheet rows in their current format: no historical-row conversion or backfill.

This plan covers web, mobile, API/domain, both database backends, reports, offline work, and data portability. The implementation must preserve current identity, authorization, date-window, daily-hours, and response-envelope behavior.

## Product rules

| Type | Activity | Additional fields |
| --- | --- | --- |
| Project | Planning, Implementation, Testing, R&D | Required project selection |
| Support | Internal IT | None |
| Support | Customers | Required Ticket Number |
| Internal | R&D, Meetings, Certifications, POC, Presales Support | None |
| Internal | Other | Required activity description |

- The Type selector starts unselected. Do not default to the legacy project named Internal.
- Form order is Type → Project → Activity for Project, and Type → Activity for Support and Internal.
- For Support → Customers, show a text field labelled **Ticket Number** with placeholder **Enter Ticket Number**. Trim outer whitespace; reject empty values; preserve letter case, leading zeros, and punctuation. Limit to 100 characters. Ticket numbers need not be unique.
- For Internal → Other, show a text field labelled **Other Activity** with placeholder **Describe the activity**. Trim outer whitespace; reject empty values; limit to 200 characters.
- Changing Type clears the project, activity, Ticket Number, and Other Activity. Changing Activity clears conditional fields that no longer apply.
- Work description remains separate and required under existing rules. No customer directory, ticket lookup, or external ticket integration is included.

## Shared model and interfaces

Define the taxonomy and validation once in `packages/contracts/src/timesheets.ts`, export it through the package entry point, and consume it from web, server, and mobile code. Use stable values rather than display labels:

| Field | Values or meaning |
| --- | --- |
| `entryType` / `entry_type` | `project`, `support`, `internal`; null identifies a historical-format row |
| `activityCode` / `activity_code` | `planning`, `implementation`, `testing`, `research_development`, `internal_it`, `customers`, `meetings`, `certifications`, `poc`, `presales_support`, `other` |
| `activityOther` / `activity_other` | Description for Internal → Other only |
| `ticketNumber` / `ticket_number` | Ticket for Support → Customers only |
| `projectId` / `project_id` | Required for Project; null for Support and Internal |
| `activityTypeId` / `activity_type_id` | Existing activity reference, retained for historical entries; null for new-format entries |

Create separate validators for new entries and historical-format edits. New-format validation requires a compatible Type and Activity, requires a project only for Project, and disallows classification-specific text outside its branch. Normalize omitted optional values to null consistently. Extend `TimesheetEntry`, create/update/bulk inputs, database row types, browser mappings, mobile aliases, and server DTO mappings. Keep Server Action names and existing response envelopes.

Likely shared-boundary touchpoints include `app/types.ts`, `lib/db/repository.ts`, `lib/api/v1/contracts.ts`, `lib/data/client.ts`, `packages/client`, and `mobile/src/api/contracts.ts`. Verify the live symbol/reference set before editing; do not duplicate contract definitions in mobile.

## Database, domain, and API work

Add paired additive migrations under `db/migrations/` and `supabase/migrations/`. Do not edit applied migrations. Add nullable classification/detail columns, allow nullable `project_id`, and add checks that enforce valid new-format row combinations without rejecting legacy rows. Account for SQL NULL semantics when writing constraints. Do not update historical timesheet rows.

Add `projects.is_timesheet_project boolean not null default true`. Mark the existing Internal, Internal IT, and Support reference rows ineligible using trimmed, case-insensitive name matching. These reference-data flags do not reclassify timesheet rows. Keep those projects readable for historical editing and reporting. Expose the flag on project DTOs, hide ineligible projects from the new Project picker, and verify eligibility server-side. Preserve the flag on rename and prevent new real projects from using the three reserved names. Include the flag in seeds and portability paths.

Follow the established flow: UI → Server Action or HTTP route → `lib/domain/timesheets.ts` → `TimesheetPersistence` → native/Supabase adapter. The domain validates taxonomy and server-fetched project eligibility; it must not create provider clients. Update both adapters’ insert/update/read mappings. Keep both implementations behaviorally equivalent.

Determine the editing format from the persisted row, not client input. Historical rows continue using Project + Type validation and keep their stored format when edited. New-format rows must not become legacy by omitting fields. All new entries, including backdated entries, use the new format. Preserve existing permissions, ownership checks, backfill limits, hourly limits, and sanitization.

Extend every affected entry path: create, edit, backfill, bulk edit, single duplicate, and batch duplicate. Copying a new-format row preserves Type, Activity, Ticket Number, and Other Activity. Copying a legacy row into a new entry opens a draft and requires classification; a batch duplicate reports a per-row `CLASSIFICATION_REQUIRED` outcome for legacy source rows. Mixed-format bulk edits validate each row according to its stored format.

Update the Supabase bulk-update RPC’s record shape and `SET` clause for all new fields while retaining its existing actor checks and restricted grant. Update TypeScript, native SQL, and Supabase SQL idempotency canonicalization together. Preserve the exact existing canonical payload for legacy operations. Include Type, Activity, Other Activity, and Ticket Number for new-format operations; normalize null/default values identically in all three implementations. Tests must prove that changing only Ticket Number changes a new-format effect fingerprint while historical retries continue to match.

Keep privileged backup/restore and migration-import paths able to restore legacy rows through their existing trusted boundary. Never add a client-controlled validation bypass. Preserve ordinary authenticated create/update authorization and database checks.

## Web, mobile, and offline behavior

Update the web create form, backfill form, entry editor, bulk editor, entry table, and dashboard mapping. Relevant known surfaces include `app/dashboard/time-entry-form.tsx`, `app/dashboard/backfill-form.tsx`, `app/dashboard/entries-table.tsx`, and `app/dashboard/bulk-edit-modal.tsx`. Update the shared mobile `TimeEntryForm`, create/edit screens, list and duplicate actions, API client/DTOs, and screens that display entries. Reuse existing design-system controls.

Show field-level validation errors, retain drafts on failed submission, and validate before enqueueing offline. For legacy entries, open the old-format editor and display the stored project/activity values without guessing new classifications. Render new-format rows with Type, applicable project, Activity, and applicable Ticket Number or Other Activity. Use type-qualified activity display, for example “Project · R&D” and “Internal · R&D”.

Include all new fields in mobile queued payloads. Missing classification fields in existing cached drafts mean legacy-format data; do not infer a Type from project names. Use the existing `manual_review` state for an uncommitted legacy create. Add **Review and re-enter**: open a prefilled new-entry draft, retain the old queued item until the replacement is durably queued, then retire it. A payload change requires a fresh idempotency key. Resolve commit-uncertain requests through existing recovery before allowing replacement, so one uncertain request cannot create a duplicate. Existing queued edits to known legacy rows continue through legacy validation.

Update web and mobile copy-last-entry caches to include classification and conditional details. Older cache shapes remain readable; an entry with missing classification opens with Type unselected. Never mutate a queued payload under its existing idempotency key.

Use the existing `/api/v1/config` capabilities object to publish `timesheetClassificationV2`. Updated HTTP clients send `X-Timesheet-Format: 2`. Once the new format is activated, reject unsupported fresh mutations and incompatible timesheet-bearing reads, including dashboard recent entries, with `409 CLIENT_UPDATE_REQUIRED` in the current error envelope. Keep authentication/config endpoints usable for clients that need to learn server capabilities. Resolve any committed idempotency replay before applying the fresh-mutation compatibility rejection. Update all in-repository web and mobile callers before activation.

## Reports and data portability

Add Type and Activity report filters and Type grouping while preserving existing user, project, and activity options. Ensure unfiltered reports include both formats and totals are unchanged. Use consistent grouping in native reporting, Supabase’s grouped RPC, and the Supabase user-filtered fallback:

| Grouping | New-format rows | Historical rows |
| --- | --- | --- |
| Type | Project, Support, Internal | Legacy |
| Project | Real project name; “Support — no project” or “Internal — no project” | Existing project name |
| Activity | Type-qualified label | Existing activity label under Legacy |

Ticket Number and Other Activity are detail fields, never grouping keys. Keep Supabase grouped reads RLS-scoped and `SECURITY INVOKER`. Extend CSV output with Type, Activity, Ticket Number, and Other Activity while retaining historical values and correct CSV escaping.

For application backup, emit version 2 with nullable project references, classification/detail fields, and project eligibility. Continue accepting version 1 as legacy-format data. Update validation, native restore, Supabase restore, and deduplication keys so rows with different activities or ticket numbers are not collapsed. Reject malformed version 2 combinations rather than silently dropping fields.

For database transfer bundles, update `lib/migration/format.ts` and the export/import/schema-fingerprint consumers. Emit a new bundle format for the expanded schema; read version 1 through an explicit legacy adapter. Do not claim the old schema fingerprint for the expanded format. No operation in this work converts historical timesheet rows.

## Worker sequence and file ownership

Implement in dependency order. Keep shared package, app, database migrations/adapters, reporting/portability, and mobile work in separate reviewable commits or clearly separated change batches. If several workers contribute, assign exclusive ownership by subsystem and have one integrator own the shared contract and final parity review.

| Batch | Ownership / likely paths | Completion gate |
| --- | --- | --- |
| 0. Baseline | Integrator: worktree, current diff, bounded architecture decision packet, Next.js docs for affected APIs | No unrelated edits overwritten; interfaces and constraints recorded |
| 1. Contract | Shared: `packages/contracts`, `packages/client`, app and mobile DTOs | One exported taxonomy; branch validation tests pass |
| 2. Persistence | DB owner: paired migrations, repository/port, native and Supabase timesheet/reference adapters, bulk RPC, idempotency functions | Legacy rows unchanged; paired backend checks pass |
| 3. Domain/API | Domain owner: timesheet domain, actions, `/api/v1` services/routes, config capability | Create/edit/bulk/duplicate API tests pass |
| 4. Clients | Web owner and mobile owner: forms, entries, caches, duplicate flows, offline review | Web/mobile interaction and offline tests pass |
| 5. Reporting/portability | Data owner: reports, CSV, app backup, migration bundle export/import | Mixed-format totals and round trips pass |
| 6. Integration | Integrator: reconcile API/DB/client payloads, release notes, architecture delta | Both backend builds and required verification pass |

Before patching, inspect current worktree state and use `docs/ai-context/ARCHITECTURE_DECISION_PACKET_TEMPLATE.md` for a bounded decision record. Treat this plan as the product decision baseline; only return with questions if source evidence contradicts a concrete requirement or a required environment capability is missing. Read the installed `node_modules/next/dist/docs/` material before changing framework-specific APIs. Update `docs/ai-context/ARCHITECTURE_DELTA.md` because the shared contract and persistence schema change.

## Tests and acceptance criteria

Add focused tests to existing suites rather than duplicating implementation logic in tests. Cover:

- Every allowed Type/Activity branch; reject incompatible combinations.
- Project required for Project and rejected for Support/Internal; ineligible project rejected server-side.
- Ticket Number required only for Support/Customers; blank rejection; letter, leading-zero, and punctuation round trip; maximum length.
- Other Activity required only for Internal/Other; blank rejection and maximum length.
- Type/activity changes clear stale conditional fields and preserve unrelated draft fields.
- Historical entries remain readable/editable in the legacy format; ordinary edits cannot reclassify them implicitly.
- New-format copy preserves details; legacy copy requests classification; mixed batch operations return clear per-row outcomes.
- Ownership, role, inactive-account, date-window, sanitization, and 24-hour rules remain enforced.
- Offline legacy review/re-entry, queue restart, fresh replacement key, and uncertain-commit handling.
- Native/Supabase create, update, list, bulk RPC, authorization, and migration parity.
- Reports retain Support/Internal rows and totals; the two R&D activities remain distinct.
- CSV fields and escaping; version 1 backup import; version 2 mixed-format round trip; no backup dedupe across distinct tickets.
- Migration bundle v1 compatibility, new-format round trip, and expected schema-fingerprint change.
- Old client capability/error flow and updated web/mobile client interoperability.

Run focused tests by batch, then the relevant project checks: root lint, typecheck, unit tests and coverage; mobile lint, typecheck and tests; native and Supabase builds; database integration tests against migrated test databases; and Playwright/accessibility checks for affected flows. Report database/E2E checks as skipped if their environment prerequisites are unavailable. Do not call skipped checks passed.

## Release and rollback

Release in order: back up the target database; deploy additive migrations; deploy compatible server support and updated web/mobile clients; verify Project, Support → Customers, Internal → Other, and legacy edit flows; activate new-entry validation and compatibility rejection; then monitor validation errors, offline manual-review volume, report totals, and backup output.

If rollback is needed after new-format rows exist, retain the expanded schema and data. Disable incompatible writes or deploy a compatible corrective server/client release. Do not restore code that assumes every timesheet has a project.

Completion report must name migrations and changed areas, show verification results and unavailable checks, confirm historical rows were not converted, and list any environment-specific deployment steps.
