# Architecture Delta

## 2026-10-20 — Department boundary for admins and COs

- Migration `0045_departments.sql`: new `public.departments` list (unique trimmed `name`), seeded from existing `profiles.department`; new `profiles.scope_departments text[]` (null/empty = unrestricted). `profiles.department` stays free text but writes must name a listed department (or '').
- Scope is read live in SQL (`lib/db/native/visibility.ts`: `departmentScopeClause`, `departmentScope`, `isOrgAdmin`, `userInScope`, `canManageUser`); it is not carried on `Actor`. The super admin is always unrestricted.
- A department-limited admin/CO only sees and manages people, timesheets, reports and leave inside its departments; it can only manage `pm`/`user` accounts there and only grant `pm`/`user`. Org-wide setup (entry window, departments, global reminders, import/backup/reset, titles, email domains) requires `isOrgAdmin`; projects/activity types keep their admin|pm rule.
- New routes: `GET /api/v1/departments`, `POST /api/v1/admin/departments`, `PATCH|DELETE /api/v1/admin/departments/[id]`, `PUT /api/v1/admin/users/[id]/department-scope` (org admin only). Renames cascade to profiles and scopes; deletes are refused while a department has members or appears in any scope (so no admin silently becomes unrestricted).
- Known limit: users with no department are visible only to unrestricted admins, so new sign-ups need an unrestricted admin (or a department) before a limited admin can approve them.
- Migration `0044_backfill_month_default.sql`: entry-window default becomes month start + 5 days (updates only an untouched default row).

## 2026-10-19 — Rollback transports retired

- Removed the Server Action facade (`app/actions.ts`, `app/actions/`) and the legacy `app/api/auth/*` and `app/api/data/*` routes. None had production callers; the browser uses `/api/v1` through `lib/data/client.ts` and `lib/auth/client.ts`. The shared handlers in `app/api/_native-browser-*.ts` and the cookie guards in `app/api/_http.ts` stay because `/api/v1/auth/browser/*` and some `/api/v1` routes use them.
- Removed the `lib/dates.ts` re-export; importers use `@vsis/core` directly.
- Kept deliberately: the migration-compatibility idempotency path (`portable-retry`, fresh-key tickets, write gate). Shipped mobile builds require `/api/v1/idempotency-tickets` before creating reminders and leave, so retiring it is a mobile protocol change and needs its own decision.

## 2026-10-16 — Supabase backend and migration tool retired

- Native is the only backend. Removed `lib/supabase/`, `lib/db/supabase/`, `lib/auth/supabase*.ts`, `lib/auth/registration-supabase.ts`, `supabase/` (config + migrations), Supabase-only scripts/tests, the `@supabase/*` dependencies, `lib/backend/config.ts` (`IS_NATIVE`/`IS_SUPABASE`/`BACKEND`) and `NEXT_PUBLIC_BACKEND`.
- Removed the one-off `migrations/` tree (`@vsis/migration-tool`, evidence, rehearsal, docs), its workspace/scripts, CI job and the Supabase auth-migration runbook. `db/migrations/` is untouched.
- Kept deliberately: bcrypt verification in `lib/auth/password.ts` (imported users upgrade to scrypt on login), `lib/idempotency/portable-retry.ts`, `lib/idempotency-fresh-key.ts` and `lib/db/write-gate.ts` with their `migration_*` tables (native request paths still call them), and the `'supabase'` member of `IdentityProvider` in `@vsis/contracts` (shared with mobile).
- `/api/v1/config` still reports `backend: 'native'`; `durableIdempotency` is now always `true`. Mobile access tokens are accepted only with the native audience.
- Earlier entries above describe the dual-backend era and are historical.

## 2026-10-16 — Telegram bot command feature retired

Baseline `5149992`. The Telegram helpers (`lib/telegram.ts`,
`mobile/src/utils/telegram.ts`), the dashboard `telegram` tile, the entry-form and
bulk "copy command" actions and the bot-number editors are removed. Server Actions
`setProjectTelegramNo` / `setActivityTypeTelegramNo`, the matching domain,
persistence-port and data-client methods, and the browser activity-type
`operation: 'telegram'` mutation are deleted. `telegram_no` leaves the
project/activity-type DTOs, `app/types.ts` and backup export.

Compatibility: v1 admin routes silently ignore a `telegramNo` field from older
mobile builds; backup restore ignores `telegram_no` in older files; saved
dashboard layouts drop the unknown `telegram` tile through `lib/layout.ts`.
Schema: `db/migrations/0042_retire_telegram.sql` drops both columns and their
partial unique indexes. Its header still names a paired Supabase migration; that
pairing was dropped when merging the Supabase backend removal, and the comment is
left unchanged because the file's checksum is already recorded on the Neon
preview database.

## 2026-10-07 — PR17 mobile replay, layout guard and status contrast repairs

Baseline `6db1fae2ff19642f5799ef07859f4e6b01960c92`. Manual-review resolution now
shares the finite timestamp / 90-day absolute replay boundary with automatic
sync, preserves API errors and uses the existing generation-aware authenticated
invoker. Stale queue-summary reads cannot publish across session transitions.
Personal and workspace layout snapshots jointly drive the existing shell discard
guard for header, tab and hardware navigation; standalone consumers retain local
confirmation. Dedicated themed success/warning text tokens preserve fill colors.
No API, persistence, schema, dependency or backend changes. Finding ledger and
acceptance evidence: [PR17 review fixes decision](archive/PR17_REVIEW_FIXES_DECISION.md).

## 2026-10-06 — Global reminder banner presentation

Decision: persist the optional create input `displayAsBanner` as
`global_reminders.display_as_banner boolean NOT NULL DEFAULT false` in both
backends. Existing rows and older clients keep tile presentation. Shared DTOs
expose an optional additive `display_as_banner` field; the mapper defaults absent
values to false. Personal reminders and existing reminder update APIs are unchanged.

The dashboard owns one due-reminder provider, keyed to the session/auth epoch.
Due, undismissed banner reminders appear above all dashboard tabs regardless of
tile settings. The tile shows ordinary reminders only. Dismissal removes a row
from shared state after persistence succeeds; failed requests leave it visible.
Admin creation/deletion refreshes both views. Authorization, due filtering,
per-user dismissal and write-budget rules retain their existing boundaries.

Application backup export/parser/restore preserve the field, default omitted
values to false and reject invalid values. Restore identity includes normalized
presentation alongside message/time, preserving mixed banner/tile rows and
repeat-restore idempotency. Paired additive migrations are `0041` and
`20261009000000`; the latter replaces the established transactional restore RPC
while retaining its exclusive lock, owner, search path and service-role grants.

Portable operator bundles intentionally retain exact v1/v2 schemas and canonical
bytes. They omit banner preferences; newly imported rows use the database default
false. Existing matched destination rows retain their current preference. A future
portable format extension requires separate versioning and compatibility work.
No live database or deployment changes were made.

## 2026-10-05 - Mobile release bundling repair

Metro now maps shared-contract Zod imports to the mobile installation. Babel
explicitly transforms namespace exports using the declared existing 7.29.7
plugin, allowing Zod v4 to bundle on Windows and Android. No runtime API or
persistence contract changes. Unsigned Android release and Windows x64 MSIX
packaging passed; mobile tests passed 432/432 and affected config lint passed.
Android used the existing optional cmakeStagingDir with C:/tmp/vsis63cf606-cxx
to avoid the Windows path-length limit. Artifact hashes and source/build-fix
provenance are in ignored mobile/build/build-info.json. Windows was subsequently rebuilt and signed using the app PFX from the directory
configured in .env.local; signtool verify /pa passed. The Android release APK is unsigned; a separate test APK was signed with the repository development keystore and passed apksigner verification and 16 KB alignment checks. Version 1.2.0 is synchronized across application manifests (Android build 20, Windows 1.2.0.0).
Installed application smoke tests were not performed.


## 2026-10-05 — Timesheet Type → Activity classification v2

- Added a stable contract taxonomy in `@vsis/contracts` and threaded it through
  web, mobile, domain and persistence without renaming public Server Actions or
  changing response envelopes. Stored `entry_type` is authoritative for edit
  format; absence identifies a historical-format row. No historical timesheet
  row is converted.
- Added paired additive migrations `db/migrations/0039_timesheet_classification.sql`
  and `supabase/migrations/20261007000000_timesheet_classification.sql`: nullable
  `project_id`, classification/detail columns, NULL-safe SQL constraints, project
  eligibility, reserved-name guards, and classification-aware idempotency
  fingerprint/bulk-update definitions. Reporting/restore support is additive in
  `db/migrations/0040_classification_reporting.sql` and
  `supabase/migrations/20261008000000_classification_reporting_restore.sql`.
- Updated read/write mappings on both adapters, project eligibility lookup,
  mixed-format bulk edit/duplicate outcomes, report Type/Activity filters and
  grouping, CSV details, backup format v2 and migration bundle v2 with an
  explicit legacy v1 adapter. Supabase grouped reporting remains RLS-scoped
  `SECURITY INVOKER`; restricted privileged restore remains a server boundary.
- Added the server-owned `TIMESHEET_CLASSIFICATION_V2` rollout gate and shared
  `X-Timesheet-Format: 2` client marker. Fresh unclassified API writes and
  timesheet-bearing bearer reads get `409 CLIENT_UPDATE_REQUIRED` only after
  committed replay recovery; cookie/server-action web flows and legacy stored-row
  edits remain compatible. Updated contract, domain, route, idempotency,
  persistence, backup/report, offline/mobile and web interaction coverage.
- Continuation: duplicate and batch-duplicate bearer writes use the same post-replay
  compatibility gate. Mobile compatibility refusals retain prior commit uncertainty
  across restart and block fresh-key replacement until recovery proves the outcome;
  never-sent drafts and definitive first-send refusals remain replaceable.

- Continuation closure (2026-10-05): duplicate and batch-duplicate mutations now share the post-replay classification compatibility guard; offline recovery preserves prior commit uncertainty after compatibility rejection and blocks fresh-key replacement until recovery resolves it. Regression and final verification evidence, including unavailable checks and the Supabase placeholder browser limitation, is recorded in `docs/plans/TIMESHEET_CLASSIFICATION_DECISION.md`.
## 2026-10-05 — Runtime maintenance ingress

- Delta against `a82b318`: root `proxy.ts` gates new application requests for exact server-only runtime `MAINTENANCE_MODE=true`, with no identity/role/IP bypass. GET/HEAD pages reaching Proxy receive a no-store 307 to `/maintenance` without their query; APIs and all non-read requests reaching Proxy receive no-store 503 JSON and `Retry-After: 60`. Versioned APIs retain `{ data: null, error: { code, message } }`; other requests use `{ error: string }`.
- Read exemptions are exact maintenance/health paths, enumerated existing public/metadata assets, bounded Next static/image paths, and exact development asset endpoints. The matcher includes every path/method, so exemptions cannot admit Server Action POSTs. `app/layout.tsx` waits for a request before reading the flag and uses `DEFAULT_BRANDING` for layout, metadata, and viewport during maintenance, avoiding branding database calls.
- `app/maintenance/page.tsx` renders 200 with a plain home retry link. The switch needs restart/container recreation or platform redeployment and consistent rollout across instances. Next may canonicalize URLs with a body-preserving redirect before Proxy; the destination is still gated. Proxy JSON 503 rejects Server Action promises without their normal action-specific error message.
- This is a UX/application-ingress control, separate from migration fencing: already-running requests, loaded browser content, external Supabase calls/auth, jobs, and direct DB writers remain outside its boundary. No auth/repository/schema changes. See [decision packet](archive/MAINTENANCE_DECISION_PACKET.md) and [operator workflow](../../deploy/README.md#maintenance-mode).

Older entries: `archive/ARCHITECTURE_DELTA_TO_2026-10-05.md`.
