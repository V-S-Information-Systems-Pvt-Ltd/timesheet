# Architecture Delta

## 2026-10-05 — Runtime maintenance ingress

- Delta against `a82b318`: root `proxy.ts` gates new application requests for exact server-only runtime `MAINTENANCE_MODE=true`, with no identity/role/IP bypass. GET/HEAD pages reaching Proxy receive a no-store 307 to `/maintenance` without their query; APIs and all non-read requests reaching Proxy receive no-store 503 JSON and `Retry-After: 60`. Versioned APIs retain `{ data: null, error: { code, message } }`; other requests use `{ error: string }`.
- Read exemptions are exact maintenance/health paths, enumerated existing public/metadata assets, bounded Next static/image paths, and exact development asset endpoints. The matcher includes every path/method, so exemptions cannot admit Server Action POSTs. `app/layout.tsx` waits for a request before reading the flag and uses `DEFAULT_BRANDING` for layout, metadata, and viewport during maintenance, avoiding branding database calls.
- `app/maintenance/page.tsx` renders 200 with a plain home retry link. The switch needs restart/container recreation or platform redeployment and consistent rollout across instances. Next may canonicalize URLs with a body-preserving redirect before Proxy; the destination is still gated. Proxy JSON 503 rejects Server Action promises without their normal action-specific error message.
- This is a UX/application-ingress control, separate from migration fencing: already-running requests, loaded browser content, external Supabase calls/auth, jobs, and direct DB writers remain outside its boundary. No auth/repository/schema changes. See [decision packet](MAINTENANCE_DECISION_PACKET.md) and [operator workflow](../../deploy/README.md#maintenance-mode).

## 2026-10-04 â€” OpenShift Local destination selected

- Final host barrier restored: CRC host-network-access default False and pod TCP
  denial verified before Supabase core test services resumed. Rehearsal workloads
  remain stopped; primary TLS/SCRAM remains. Supabase Vector restart and absent
  performance fixture are disclosed restoration exceptions. No source production
  controls changed. Fresh final migration/timing and production SMTP/freeze-owner
  inputs remain outstanding.
- Restored-backup OpenShift Route/reset/login/CRUD/report/failure/proxy checks
  passed using the pinned numeric-USER native 1.1.6 image. App/mail deployments
  are now zero replicas; messages, test effects and port-forward are removed.
  Primary and original all-table digests are unchanged. This is host functional
  qualification, not fresh migration admission or new-platform timing proof.
  [Host evidence](../../migrations/evidence/c08-openshift-host-functional-2026-10-04.json).
- Resumed preparation qualifies disposable TLS/SCRAM and scoped migration
  ownership. Selected Docker primary now requires TLS/SCRAM and has a scoped
  non-superuser runtime role; all 24 public-table digests are unchanged and no
  primary migration/import was run. Operator-approved local Supabase/performance
  containers are paused with data preserved. CRC host access is enabled and
  restart is in progress; actual pod/image/Route validation remains pending.
  [Sanitized results](../../migrations/evidence/c08-openshift-access-2026-10-04.json).
- CRC restart recovered; actual OpenShift pod TLS with mounted CA and allocated
  UID passes to the unchanged primary. Namespace candidate build resources now
  exist. Dockerfile USER changed from named nextjs to numeric 1001 after an
  observed Kubernetes runAsNonRoot failure, preserving the same non-root user.
  A pinned replacement candidate image is built; cloned app/Route/mail smoke
  remains pending. No primary app or cron was started.
- Operator selected local mail capture for the OpenShift rehearsal; actual
  external SMTP delivery remains unqualified and is not implied by this choice.
- Operator selected local OpenShift project `vsis-timesheet`, HTTPS host
  `timesheet.apps-crc.testing`, and confirmed all writers may be stopped.
  Vercel pause is the proposed app control; direct Supabase and privileged
  writers still need separate idle/denial/drain evidence.
- Read-only `crc-admin` inspection reached OpenShift 4.22.1. The project does
  not exist, node DiskPressure is True and machine-config is degraded.
  Operator confirmed keeping Docker PostgreSQL `vsis_migration_destination_20261003`;
  its container publishes PostgreSQL 16 only on host loopback port 5432. Secure
  pod-to-host connectivity and final application/operator binding remain unverified.
  No cluster resources or production controls were changed. Immutable image,
  deployment access remain open. Later checks show storage pressure recovered:
  CRC Running, node DiskPressure False, machine-config healthy, 16 GiB writable
  space available. No resize or cleanup was performed by this preparation.
- CRC host-network-access defaults to false; a controller-pod TCP probe to
  `host.crc.testing:5432` timed out. PostgreSQL has broad TCP trust authentication,
  only a passwordless superuser login and TLS off. Do not enable host access
  before authentication/transport preparation; the bounded security protocol is
  [under review](../../migrations/docs/decisions/C08_OPENSHIFT_DATABASE_ACCESS_PACKET.md).
  [Destination preparation](../../migrations/docs/OPENSHIFT_LOCAL_CUTOVER_PREPARATION.md).

## 2026-10-04 â€” C08 resumed; native 1.1.6 qualification selected

- User resumed the disposable actual-data rehearsal and selected native 1.1.6;
  production source remains 1.0.3. Release admission now explicitly permits
  this directional pair at preflight, plan and apply without changing artifact
  provenance, historical defaults or other migration guards.
- Fresh read-only production inspection at 13:53 UTC confirms ledger entry
  `20261006000000`. Its table/column fingerprint is unchanged; index catalog,
  production EXPLAIN and latency evidence remain outstanding.
- A fresh unmodified native 1.1.6 production build passed. It includes existing
  checkout changes and is not an immutable deployed release. The operator
  transition patch passed 445 tests (41 optional integration skips), lint,
  typecheck, coverage and independent review. Fresh actual-data import created
  958 rows and mapped 53; recorded verification and no-op replay had zero drift.
  Two separate restores matched all 24 tables. Disposable intent/admit and
  native 1.1.6 loopback enrollment/login/create/replay/edit/report/refusal smoke
  passed. Original seeded baseline and previous successful clone are unchanged.
- The accepted 60-minute rehearsal reserves 15 minutes for abort/recovery,
  leaving 45 minutes for the normal sequence including review. The unchanged
  clock measured 33m 36.376s including launcher failures and final checks;
  adding the reserve gives 48m 36.376s within 60 minutes. Production
  writer controls, final host and external enrollment remain separate gates.
  [Decision packet](../../migrations/docs/decisions/C08_RESUME_PACKET.md).

## 2026-10-04 â€” D2 sort index deployed; production verification pending

- D2's additive `(log_date DESC, created_at DESC, id DESC)` index is applied in
  the disposable native PostgreSQL database and the local Supabase stack only.
  The native migration checksum matches its ledger, rerunning the canonical
  native migrator is a no-op, and both focused PostgreSQL D2 tests pass.
- The local Supabase database was exactly one migration behind; `supabase
  migration up --local` applied only
  `20261006000000_timesheet_list_sort_index.sql`.
- The operator subsequently reported that D2 was pushed to production. This
  session has not independently queried the production ledger/index catalog or
  captured production `EXPLAIN`/latency, so deployment is operator-confirmed and
  production runtime evidence remains pending. [Packet](D2_TIMESHEET_SORT_INDEX_PACKET.md).

## 2026-10-04 â€” P2 server-rendered dashboard and render-pass auth cache verified

- `app/dashboard/page.tsx` now resolves an explicit server seed before handing
  interactivity to `dashboard-client.tsx`. The seed uses existing auth/domain
  boundaries and independently settles reference data, role-scoped people,
  workspace settings/layouts, one bounded entries page and month totals.
- `lib/auth/render.ts` uses React render-pass caching for one composite
  identity; the cached self-profile consumer reuses it. Route Handler/browser
  authentication stays fresh and there is no cross-request auth cache.
- Actor/profile identity, roles and active state must align before privileged
  sibling reads. Serialized profile/timesheet/reference/layout data is
  explicitly projected; missing/error/inactive states retain distinct UI gates.
- SSR and first hydration share an unknown calendar snapshot. Seeded entry rows
  remain visible with literal dates; one confirmed browser-local day activates
  relative labels, edit bounds, the entry form and leave calendar together.
  The rebuilt fixed-2099 browser regression passed with zero hydration errors.
- Settled verification: coverage passed (74.19% statements / 66.65% branches /
  80.76% functions / 77.45% lines), full lint/typecheck passed, and both native
  and Supabase production builds passed. The selected native browser matrix
  passed 25 flows; the pending-account case then passed separately with the
  inactive fixture actually present in the disposable DB (26 covered flows).
  Exact PostgreSQL auth-query cardinality remains an unmeasured performance
  metric. [Packet](P2_SERVER_RENDERING_PACKET.md).
- D2 production deployment was subsequently operator-reported complete;
  production `EXPLAIN`/runtime evidence remains outstanding. P4 stays deferred
  to Supabase retirement; migration transfer remains parked. There is no further
  unparked performance implementation item.

## 2026-10-04 â€” P1 bounded dashboard reads verified

- Dashboard table reads one URL-selected server page with exact counts;
  `/api/v1/timesheets` normalizes inclusive ranges to default 50/max 1,000.
  Existing 1,000-row report pagination remains supported.
- Checkbox selection starts with the displayed page; explicit filtered-history
  selection retrieves complete bounded pages. CSV/deactivation snapshots and
  independent Telegram pagination preserve old/future history access. Personal
  Today reads its own local-date range; month aggregates remain independent.
- Reads and consequential export callbacks are bound to their initiating
  session/scope. Mutations invalidate reusable selection; captured bulk edits
  hold dashboard locks through write and reconciliation and block dismissal.
  Last actions resolve server truth independently of the displayed page.
- Complete-history reads detect count drift, duplicate IDs and incomplete pages;
  offset paging cannot prove transactional consistency under count-neutral
  external changes. No server snapshot protocol or production operation added.
- Independent closure closed R1â€“R4/S1. Final matrix: 1,872 tests passed,
  61 optional skips; coverage gates, full lint/typecheck and both builds passed.
  Disposable native database: 22 focused regressions passed. Production native
  browser: 21 passed, covering paging/selection/export/bulk recovery, pending
  account, reports and accessibility. [Packet](P1_BOUNDED_READS_PACKET.md).
- P2 server rendering is next; migration transfer remains parked.

## 2026-10-04 â€” D3 independent month aggregates verified

- Dashboard month hours/count use the existing authorized grouped report API,
  independently of table rows; full local-calendar month bounds include future
  dates. Loading/failure does not become zero; retry is explicit.
- Mutation callbacks refresh aggregates independently of table reconciliation.
  The personal Today predicate and optimistic row behavior are retained.
- Dashboard aggregates bypass shared browser singleflight; actual-facade
  successive-controller tests prove old-session responses cannot update a
  remounted dashboard. Independent closure review found no material issues.
- Settled D3/D4 matrix: 1,829 passed / 61 skipped; coverage gates, lint,
  typecheck and both backend compile-only builds passed. No isolated test DB
  or authenticated E2E/a11y/benchmark proof. [Packet](D3_MONTH_TOTALS_PACKET.md).
- User chose page-first selection with explicit all-filtered-history selection
  for upcoming P1. Data migration remains parked.

## 2026-10-04 â€” D4 dashboard count suppression; P3 scope correction

- `/api/v1/timesheets` accepts optional strict `includeCount=true|false`.
  Browser query serialization and shared schema preserve the flag through to
  existing persistence options; invalid values return 400 before listing.
- Dashboard opts out of unused counts. Mobile/report paginator defaults and
  numeric response shape are retained; CSV export already opts out.
  Single-flight keys distinguish counted and count-free reads.
- 272 focused tests passed; lint/typecheck/diff checks passed. Independent
  compatibility review found no material issue. No latency benchmark claimed.
- P3 is deferred to an actual Server Component consumer: installed Next guidance
  limits React cache to render-pass memoization, and current auth facade callers
  are routes/compatibility actions. No auth caching or validation change.
- [Decision and evidence](P3_D4_PERFORMANCE_PACKET.md).

## 2026-10-04 â€” D2 canonical timesheet list index prepared

- Additive native `0038` and Supabase `20261006000000` migrations add a nonunique
  B-tree on `(log_date DESC, created_at DESC, id DESC)` for the canonical list.
  Existing user/project scope indexes and authorization contracts are retained.
- Ordinary creation fits the transactional runner; index deployment may block
  writes while building. No live deployment or production performance claim.
- Five focused migration suites passed (70 tests); optional PostgreSQL execution/
  query-plan check skipped without `TEST_DATABASE_URL`. Decision and limitations:
  [D2 packet](D2_TIMESHEET_SORT_INDEX_PACKET.md).
- Supabase-to-native migration work is parked at the user's request. The next
  performance implementation is P3 request-local actor memoization.

## 2026-10-04 â€” Reporting list de-duplication via composition injection

- The reporting persistence adapters no longer implement their own scoped timesheet list. `lib/db/native/reporting.ts` and `lib/db/supabase/reporting.ts` now export factories (`createNativeReportingPersistence` / `createSupabaseReportingPersistence`) that receive the canonical list through a **required constructor parameter**; the duplicated list SQL and its `mapTimesheet` mapper are deleted. Wiring sits at `lib/db/reporting.ts`, the surviving composition root.
- Canonical list order is unified to `log_date desc, created_at desc, id desc` in both `lib/db/native/timesheets.ts` and `lib/db/supabase/timesheets.ts`, removing a native pagination-ordering drift between the timesheet and reporting paths. Public `ReportingPersistence`/`TimesheetPersistence` and `/api/v1` contracts are unchanged.
- **Why injection, not a direct import:** `tests/boundary-enforcement.test.ts` forbids a domain adapter importing a sibling domain adapter. Direct delegation failed that invariant; injecting the list at the composition root satisfies it while still removing the duplicate. Supabase scope is now the adapter's explicit scope (RLS remains the backstop); the leader path fails closed.
- Merged from branch `perf/d1-reporting-dedup` (delta against `98f8a4f`). No schema or migration change.

## 2026-10-04 â€” Supporting plan references archived

- Twelve supporting or completed records moved from `docs/plans/` into
  `docs/plans/archive/`; relative links and explicit path references were updated.
  The active folder retains eight plans/runbooks with current work.
- Migration inventories and the implemented retry/session contract remain usable
  references. Recorded limitations and outstanding controls retain their scope;
  archiving grants no production or retirement authorization and changes no code.
- The documentation index distinguishes current work from archived evidence.

## 2026-10-04 â€” Migration execution simplified; runtime contracts retained

- The [reviewed packet](../../migrations/docs/decisions/MIGRATION_SIMPLIFICATION_PACKET.md) replaces active C00â€“C10
  execution prerequisites with Prepare / Dry run / Cutover / Observe in the
  [migration plan](../../migrations/docs/SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN.md).
  Current notes, actual-data rehearsal and freeze/drain runbooks use one protected
  disposable native dry run and the accepted 60-minute actual-fit gate. Complete
  pre-change bodies are dated historical snapshots; deferred certification is
  not PASS and older successes retain their evidence scope.
- Seeded overlaps/ID mappings/hierarchy decisions, transactional import, receipts,
  reconciliation, retries, writer stop/deny/drain and credential smoke remain.
  Publication stays verify --record â†’ intent â†’ admit. Pre-intent source recovery
  releases the exact provider artifact before matching gate recovery; post-intent
  bypasses are refused, and later native writes need preservation/reconciliation
  before source return. Source retirement criteria remain unchanged.
- Source binding is operator-confirmed; MIGRATION_DESTINATION_DB is hosted
  timesheet-test recovery, not native primary. CLI supports 1.0.3 only. Final
  release/host/enrollment, pristine native artifact validation, writer controls/
  drain and actual fit remain open. Production 1.0.3 lacks cron gate hardening;
  earlier native build proof used a compatibility harness.
- Documentation only: no runtime/schema/provider/database/UI change, test rerun,
  production approval or retirement decision. The architecture assessment gains
  only a current-precedence notice; its other contents remain unchanged.

## 2026-10-03 â€” Scheduled maintenance obeys the migration write gate

- The current architecture branch hardens `/api/v1/cron/cleanup`: only after
  `CRON_SECRET` authentication does it read migration gate state, and cleanup is
  refused with 503 when the gate is fenced, missing, or unreadable.
- `lib/db/write-gate.ts` now provides a fresh scheduler-specific read that bypasses
  the ordinary 5-second request cache. Native uses the direct database pool;
  Supabase uses the server-only service-role client, avoiding request-scoped
  cookie/bearer clients in cron execution.
- Regression coverage was added for POST/GET fenced refusal, unreadable/missing
  fail-closed behavior, auth-before-gate ordering, privileged Supabase selection,
  and native direct reads. After a clean locked dependency install, the focused
  cron/write-gate suites pass 14/14 tests across 2 files; root TypeScript and
  targeted ESLint checks also pass. The native production build passes. The
  Supabase production build is environment-blocked at its existing prebuild gate
  because this shell does not define `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`; compilation was not reached. `git diff --check`
  is rerun on the settled delta.
- This is branch source hardening only. Production 1.0.3 still needs deployment
  plus provider-level cron stop/deny and in-flight drain evidence before C06B can
  close.
- `migrations/docs/C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md` now fixes the lifecycle
  ordering for the durable application gate, Supabase ordinary-role DML fence,
  ingress/cron, privileged Auth/admin/database writers, external jobs and drain
  proof. C08's example gate/fence commands were corrected to include
  `--target-env`; no provider or production control was executed.

## 2026-10-03 â€” Native 1.0.3 C07 binding and live browser fence proof

- An isolated archive of production commit
  0cf125a249c3e00feac55337b43e7d72fbc8e95b confirms package/app version
  1.0.3 and locked Next.js 16.3.8. Pristine source is rejected by current
  route-module validation because the forgot-password route exports a file-local
  constant. A test-only compatibility harness removes only that export modifier;
  request behavior is unchanged and the native build completes.
- The loopback runtime reports app 1.0.3 / backend native and binds to Docker
  vsis_migration_destination_20261003 with the existing 37-migration ledger.
  An authenticated browser session receives 503 WRITERS_FENCED on mutation while
  reads remain 200; after gate restoration the same malformed mutation reaches
  normal validation (400). The local cron route fails closed when its secret is
  absent. Test profile/session artifacts were removed and the gate ended open.
- This is runtime/binding and application-fence evidence, not a byte-for-byte
  pristine native release artifact and not provider-wide shutdown/drain proof.
  Evidence: migrations/evidence/c07-native-app-binding-2026-10-03.json.

## 2026-10-03 â€” Vercel deployment identity and writer inventory

- Read-only authenticated CLI and public API checks verified main/production at
  ts.kst.st as 1.0.3 and architecture preview at ts-dev.kst.st as 1.1.2, both
  Supabase. Exact deployed commit source matches advertised versions. Local
  dirty 1.1.6 is not deployed; migration admission 1.0.3 matches production.
- Both aliases use one Vercel project. Its production cleanup cron is enabled;
  deployed action/browser/mobile guards reference the gate, while the cron
  route references maintenance without a direct gate reference. This is source
  evidence, not live refusal or complete writer shutdown proof.
- One sensitive Supabase URL entry covers production/preview without a branch
  override; value/deployment-bound database identity remains unverified. Native
  app/release, same-release parity, enrollment and stop/drain controls remain
  open. No runtime/protocol/configuration/deployment mutation occurred.
  Evidence: `migrations/docs/archive/C00_VERCEL_DEPLOYMENT_INVENTORY.md`.
- 2026-10-04 read-only provider follow-up: Vercel CLI 59.23.2 confirms the one
  production cleanup cron and no configured project firewall. Its authenticated
  API exposes bodyless project pause/unpause POST endpoints for `timesheet`;
  neither was executed. The cron CLI has no disable command, so a non-production
  rehearsal must prove project pause blocks scheduled/manual cron and old
  deployment URLs before it is accepted as the complete ingress control. Because
  production and development aliases share the same Vercel project, rehearsal
  must use a separate disposable project; the production id is only an exclusion
  check until C09 authorization.
- Vercel marks the production/preview Supabase URL as sensitive. Official Vercel
  docs state sensitive values are non-readable once created; authenticated GET
  returned no value and `vercel env pull` returned only a Vercel reference. A
  repo-root `env run` source match was discarded because the CLI reported that it
  could not pull the production secrets and loaded local `.env.local`. A clean-room
  `env run` with explicit project selection had no Supabase URL at all. Temporary
  probe artifacts were removed without printing values. Production app-to-source
  binding therefore requires deployment-bound runtime evidence or operator
  confirmation.
- 2026-10-04 operator confirmation supplies that evidence for the current
  production deployment: `ts.kst.st` is intended to use Supabase source project
  `bcsdqkjzobllocejfcdz`. This closes only the current application-to-source
  identity blocker; it does not imply recovery of the Vercel sensitive value or
  close provider-wide writer/session/freeze controls.
- Supabase CLI 2.117.0 exposes no project/Auth freeze subcommand, while current
  Supabase Management API/MCP permissions include project pause. Manual pause is
  documented as Free-only; current source metadata is ACTIVE_HEALTHY but does
  not expose its plan, so eligibility remains unknown. DB network restrictions
  do not apply to HTTPS PostgREST/Storage/Auth traffic, and signup disable is not
  an existing-session freeze. Provider Auth/admin/API freeze remains open.
- Symbol-level service-role inventory confirms the deployed server itself is a
  privileged writer beyond ordinary RLS: registration/profile cleanup, mobile
  sessions, idempotency/fresh-key storage, scheduled maintenance, admin reset/
  import/restore/audit/rate limits, account create/delete, selected reference
  mutations and bulk timesheet update all reach `getAdminClient`. The freeze
  inventory now treats Vercel/server runtime and any process holding that same
  credential as explicit privileged-writer surfaces.

## 2026-10-03 â€” C00 live readiness evidence

- The operator selected existing timesheet-test for original-provider Supabase
  recovery via MIGRATION_DESTINATION settings; Docker native remains primary.
  Exact project name, source distinction, TLS/database and Auth binding pass.
  Authorized transactional cleanup removed 58 public baseline rows; independent
  verification confirmed 22 tables empty at preparation. A later source-archive
  restore committed, then a fresh consistent snapshot matched all 57 selected
  tables / 2,238 rows, 25 function definitions/owners/grants, sequence counters
  and Auth API identity membership. Managed schemas/provider history remain;
  application history matches 71 rows. Four private function bodies recovered
  from captured history matched source bodies. App-owned Auth hook suppression
  preserved the managed trigger; enabled triggers were verified before commit.
  New-project provisioning is superseded; password login, full platform recovery
  and off-host retention remain unverified. No live source/native write or
  runtime protocol change occurred. Sequence rollback limits are recorded in
  `migrations/docs/archive/C00_SUPABASE_SOURCE_RESTORE.md`.
  See `migrations/docs/archive/C00_TIMESHEET_TEST_RECOVERY.md`.

- Native baseline logical backup/decryption/restore matched every public table
  and inspected schema metadata; the supported upgrade path passed 1/1 in a
  unique fixture. The destination stayed unchanged and fixture cleanup passed.
  A DPAPI-protected baseline archive was retained. A later explicitly approved
  hosted source capture includes public/Auth/storage/history schemas and data,
  owners/ACLs, and separate password-hash-free role metadata. Protected readback
  digests and inventory pass; later scoped logical recovery passes, while full
  platform/account recovery and durable/off-host retention remain unproven. Provider
  backup metadata currently lists no physical backups and PITR disabled.
  Evidence: `migrations/docs/archive/C00_BACKUP_AND_UPGRADE_READINESS.md`.

- Hosted source aggregate inventory and a fresh native Docker destination are
  recorded in `migrations/docs/archive/C00_LIVE_INVENTORY_2026_10_03.md`. The new database
  applied the existing 37-migration baseline through the canonical runner;
  checksums and read-only CLI inspection passed. No migration protocol changed.
- Three source hierarchy differences, unexpired sessions/tickets, and seeded
  reference overlaps need explicit lifecycle/merge handling. Source data was
  unchanged. The source organization is confirmed and CLI access restored;
  the originally proposed recovery provisioning was limited to Free only and
  awaited Dashboard confirmation. That creation path is now superseded by the
  existing timesheet-test selection above; no payment or plan upgrade ran.
  Direct Credential Manager extraction for a read-only API plan check was
  rejected by automatic approval review and did not execute.
  C00/C06B/C07 gates and C08 prerequisites remain open.
- Existing native fence integration suites passed 11 tests, with one hosted leg
  skipped, against a unique disposable database. Fixture cleanup was verified and
  the C00 destination's gate, ledger and table counts were unchanged. The writer
  inventory now includes configured scheduled cleanup and authentication/session
  writers outside ordinary actor data guards; deployment controls remain unknown.

## 2026-10-03 â€” Windows chooser body and resize repair

- Installed 1.1.5 Computer Use found WIN-01: date controls remained in the
  accessibility tree but the scroll viewport collapsed. Explicit `flexGrow: 0`
  overrides `flex: 1` in Yoga; `DateChooserModal` now sets Windows growth to 1.
- The Windows chooser derives bounds and compact actions from its full-app
  backdrop's layout measurement, falling back to window dimensions until the
  first positive measurement. Resizing retains the draft date. Android/iOS
  behavior and the overlay ownership/focus/cancellation protocol are unchanged.
- Regression reproduced before repair; 15 focused tests pass. Standard and
  Windows suites each pass 55 suites / 389 tests; types and lint pass (45
  existing warnings). Version 1.1.6 is synchronized across manifests; Windows
  bundle and unsigned x64 Release package pass (13 build warnings).
- The user subsequently installed 1.1.6; native Duplicate checks verified body
  rendering, resizing/scrolling, invalid-date refusal and cancellation. Further
  Computer Use work is now completed by user confirmation; the acceptance ledger
  preserves partial checks and the unresolved WIN-02 observation. Evidence and decision:
  `docs/plans/archive/WINDOWS_DEVICE_ACCEPTANCE.md` and
  `docs/ai-context/WINDOWS_DATE_BODY_REPAIR_PACKET.md`.

## 2026-10-03 â€” Migration checkpoint status reconciled

- The C06A contract, implementation-plan table, and execution ledger now agree:
  the adopted mapping/manual-review policy and fresh-ticket implementation pass
  at repository scope. New reference-free creates require an updated mobile
  client; legacy queue entries are not assigned new provenance on retry.
- C00 and provider-wide C06B evidence remain blocked, C07 remains in
  progress/blocked, and C08 is not ready. Existing Supabase project
  `timesheet-test` is the selected original-provider recovery target and its
  scoped logical restore/reconciliation passed; full account/platform recovery,
  durable retention, and rehearsal preparation remain open. No runtime protocol
  changed and no production cutover or retirement occurred.
- Current focused rerun: 35 server tests and 18 mobile queue tests passed.
  Historical live evidence is retained separately in
  `migrations/docs/SUPABASE_NATIVE_MIGRATION_NOTES.md`.

## 2026-10-03 â€” Windows date chooser uses an application overlay

- `ThemedAppShell` hosts Windows date dialogs above the full application content.
  `DateChooserModal` uses `WindowsModalHost` on Windows, avoiding RNW's separate
  overlapped window and flexible wrapper. Android/iOS retain native `Modal`.
- The backdrop covers the shell; the dialog has a bounded viewport with a
  scrolling body and actions that stack according to its available width.
  Owner-scoped registration/cleanup prevents a closed or unmounted chooser from
  dismissing another one. Background pointer input and accessibility are blocked,
  background focus redirects into the overlay, and Escape follows cancellation
  except during loading. Other modal flows and public/data contracts are unchanged.
- Decision and verification evidence:
  `docs/plans/archive/WINDOWS_DUPLICATE_DIALOG_REPAIR.md`.

## 2026-10-01 â€” Bulk-ID reads isolate malformed PostgreSQL UUID input

- Against baseline `cecf635`, native and Supabase timesheet `getByIds` normalize PostgreSQL-compatible UUID spellings with shared pure `lib/db/postgres-uuid.ts` and omit invalid values before querying or creating clients. All-invalid inputs return no rows; mixed bulk edits reach existing per-row `not found` handling rather than a UUID-cast batch failure.
- Native indexed `ANY($1::uuid[])`, actor parameter scope and Supabase/RLS client selection remain unchanged. Domain/public identifiers remain opaque strings; canonical-only/version-restricted validation is not introduced. Returned-row IDs and existing domain alias matching remain unchanged. No writes, schema or migrations changed.
- Verification: 108 focused parser/native/Supabase/domain-boundary tests, root typecheck and scoped lint passed; PostgreSQL 16 input grammar and decision evidence are in `docs/plans/archive/MALFORMED_BULK_ID_BUG_AUDIT.md`. Settled closure passed; live database integration remains unverified.

## 2026-10-01 â€” Bulk-edit eligibility and projected totals precede persistence

- Against baseline `cecf635`, `lib/domain/timesheets.ts` validates schema, existence, ownership and original/replacement backfill eligibility before deriving aggregate-query dates. Only the first eligible occurrence of each ID is scheduled; later eligible duplicates receive per-row errors. Invalid occurrences do not suppress later eligible edits, and rejected edits retain their stored hours in daily projections.
- Daily-cap admission preserves input priority and recomputes surviving replacements after rejected originals are restored until stable. Domain swap projections remain possible; persistence constraints, actual stored totals and concurrency remain authoritative. Existing advisory-lock daily-hours triggers and UPDATE/RPC boundaries are unchanged; no live database integration was performed.
- Aggregate `bulkUpdate` errors now return the established domain STORAGE_ERROR instead of false zero-update success, using existing API/action error mapping and batch-budget refunds. Successful partial results retain row errors/counts and one charge. Verification: 110 focused domain/browser/actions tests, typecheck and scoped lint pass; packet `docs/plans/archive/BULK_EDIT_VALIDATION_BUG_AUDIT.md`. Independent closure approved; final 1,642 root tests, coverage gates, lint, types and both backend builds passed.

## 2026-10-01 â€” Committed batch duplicates survive optional read-back failure

- Against baseline `cecf635`, `batchDuplicateTimesheetsWork` isolates only the
  post-create row lookup. When creation returns an ID, thrown read-back now uses
  the established null-read fallback, preserving success/count and the batch
  write charge. Source lookup, authorization, missing-ID and create failures keep
  their existing handling. Running daily totals include the committed copy.
- Six exported-domain regressions and independent closure passed; final root
  coverage, lint, types and both builds passed. Decision packet:
  `docs/plans/archive/BATCH_DUPLICATE_READBACK_BUG_AUDIT.md`. No schema/adapter change.

## 2026-10-01 â€” Mobile authentication transitions fence pending session work

- Against baseline `cecf635`, memoized and temporary connection controllers share an explicit `SessionLifecycle`. Identity intents advance its generation; storage reads/writes/clears and workspace persistence use one ordered queue. Obsolete responses, failures, cleanup, and refresh finalizers cannot repersist logged-out credentials or overwrite successor state. Provider publication and unmount/client ownership checks use the same fence; boot readiness preserves startup reads.
- Accepted access tokens and latest token are scoped to one generation. Transport and report-export retries retain original request ownership, reject stale/unknown tokens before credential access, and reuse the latest token for delayed same-generation failures. Shared callback snapshots and optional failed-token contracts are recorded in the adjacent transport delta. Logout deliberately resolves after local cleanup while best-effort remote revocation continues, preventing stalled network revocation from retaining local access.
- Focused auth/API/export regression coverage passed 63 tests; full mobile verification passed 49 suites / 322 tests, TypeScript and lint (warnings only). No server authentication, schema, backend, or token format changes. Consolidated decision and closure evidence: `docs/plans/archive/SESSION_LIFECYCLE_BUG_AUDIT.md`.

## 2026-10-01 â€” Shared 401 retries carry failed authentication ownership

- Against baseline `cecf635`, the shared `RefreshAuth` callback now accepts an optional failed access token while preserving its existing synchronous/asynchronous return union and no-argument callback compatibility. Each transport request snapshots its callback before auth resolution/fetch and passes the exact token used by the failed initial attempt. Mid-flight callback replacement or registration cannot redirect that request into another owner's handler.
- Mobile session lifecycle code owns generation/accepted-token authorization and rejects stale ownership by throwing; shared transport preserves original-401 fallback and existing null-return behavior. Cookie callers, status/code envelopes, one-retry limits and the settled full-operation timeout remain unchanged. Decision and tests: `docs/plans/archive/CONTINUOUS_BUG_AUDIT.md` M1b section; consolidated mobile integration verification remains pending.

## 2026-10-01 â€” Shared JSON transport deadlines cover response bodies

- Against baseline `cecf635`, `packages/client/src/api-client.ts` now races the complete fetch/JSON operation against one existing deadline per transport attempt. Body stalls reject with the established `TimeoutError` even when platform abort is ignored; timer cleanup covers completion and failure, and late body rejection remains handled.
- Browser cookie and mobile bearer callers inherit the fix through the shared transport. Default/per-call timeout values, invalid JSON mapping, status/code envelopes, refresh behavior and caller contracts are preserved. No schema, persistence, backend selection or deployment changes are involved.
- Focused verification passed: transport/browser facade 48 tests, mobile API 18 tests, scoped ESLint and diff whitespace checks. Decision packet and lifecycle evidence: `docs/plans/archive/CONTINUOUS_BUG_AUDIT.md`. Independent closure review and the coordinator's settled full verification remain pending.

## 2026-09-30 â€” Windows window and modal sizing

- Native startup now centers a window using 90% of the launch monitor's work area and explicitly loads the branded executable icon (`mobile/windows/VsisTimesheetMobile/VsisTimesheetMobile.cpp`, `.rc`, `.ico`).
- Shared `mobile/src/utils/modal-layout.ts` bounds Windows native modal roots; picker lists and administration forms scroll within that viewport. Android/iOS retain their existing root presentation. Shared pressable content now inherits caller row/gap alignment; duplicate actions and date controls adapt to narrow windows.
- No authentication, persistence, backend selection, or API contracts changed. Evidence and acceptance checks: `docs/plans/archive/WINDOWS_UI_REPAIR.md`.

## 2026-09-28 â€” OpenShift CRC TEST deployment topology added and verified

- `deploy/openshift/` now owns a filtered OpenShift binary-build path, a CRC-only persistent PostgreSQL Deployment, reusable application/Route/CronJob/NetworkPolicy manifests, a separately controlled bootstrap seed Job, and secret-safe persistence smoke Jobs. Runtime application code and public HTTP contracts are unchanged.
- The TEST topology is native-only: project-local `vsis-timesheet:crc`, one app replica, one `Recreate` PostgreSQL replica with a CRC hostpath PVC, edge-TLS Route `timesheet-test.apps-crc.testing`, `TRUSTED_PROXY_HOPS=1`, restricted SCC/arbitrary UID operation, and separate runtime/bootstrap Secrets. The bootstrap password is not injected into the long-running application Deployment.
- Build `vsis-timesheet-4` published digest `sha256:565f041977eb6a318247ccf9af42c81e391265e531606d8f111d2c266a27ac1b` from the dirty `arch/architecture-simplification` worktree at HEAD `d9f8b80aaafac1ffdc343d1b1d480544dd588cb9`; this is TEST provenance rather than release provenance. The filtered source context excludes environment/credential-like files and includes the migration workspace required by `npm ci`.
- Live CRC verification passed: PostgreSQL and app Ready; app pod `restricted-v2` with arbitrary UID `1000650000`; 37/37 migration ledger rows have checksums; seed completed; HTTPS liveness/readiness and HSTS passed with HTTP redirect; authenticated create/read survived an app restart and a separate PostgreSQL pod replacement and was cleaned up; the protected cleanup CronJob completed as a one-off Job.
- CRC disk pressure during image builds evicted the hostpath CSI DaemonSet as well as PostgreSQL. Recovery preserved the PVC: after pressure cleared, the failed CSI pod was recreated to 4/4 Ready, PostgreSQL remounted the retained volume, and persistence verification passed. This reinforces that CRC storage/build resources are TEST-only; production still requires approved HA/managed PostgreSQL, backups plus restore verification, trusted TLS, rotated Secrets, immutable release provenance, capacity planning, and an explicit cutover/rollback plan.

## 2026-09-27 â€” Phase 4 retirement evidence capture added without retirement authority

- The private migration package adds `retirement-inventory`, an operator-only command combining a strict deployment/client/capability declaration with aggregate evidence from one repeatable-read database snapshot. Connections remain explicit `MIGRATION_*` variables; no application runtime import or fallback exists.
- Required migration relations/columns and complete row visibility are verified before capture. Output is canonical, digest-bound, exclusive and aggregate-only: no run IDs, source namespaces, record/ticket/actor/resource IDs, payload fingerprints, endpoints, credentials or record bodies are emitted. Unknown/stale declarations produce a completed blocked artifact; missing/incompatible/unreadable database evidence or identity mismatch produces no artifact.
- Retained fresh-key rows are reported by operation and expiry/generation bucket only. They do not prove pending work, consumption, offline queues or future issuance. The artifact fixes its purpose to `evidence-only` and its gate assessment to `not-performed`; it cannot satisfy or authorize R1â€“R3, C08â€“C10, cutover, cleanup, teardown or provider retirement.
- `migrations/docs/SUPABASE_RETIREMENT_PLAN.md` records the declaration template, command, artifact semantics, per-deployment checklist and still-open gate ledger. No live deployment inventory has been performed.
- Verification passed: the focused retirement-inventory suite (5 tests), the complete migration package suite (333 tests passed, 26 environment-gated tests skipped), migration coverage gates (80.44% statements, 70.01% branches, 81.27% functions and 81.91% lines), migration lint and TypeScript, and application boundary enforcement (13 tests). Live deployment capture was not run because no direct target database URL was supplied; Docker was unavailable for this evidence-only slice.

## 2026-09-26 â€” Phase 3 browser transport consolidation completed in source

- All production browser data/authentication calls, dashboard Server Action consumers and raw application fetches now flow through `lib/auth/client.ts` or `lib/data/client.ts` to `/api/v1`. New browser resources cover web layouts/capabilities, branding, superadmin reset/user/whitelist/title/activity lifecycle, CSV import, backup export/restore and per-user timesheet deletion. Cookie-specific adapters acknowledge action-style writes without imposing bearer/mobile read-backs.
- `lib/import-timesheets.ts` now owns CSV reference resolution, row validation, 24-hour cap enforcement and the daily-import reservation for both the rollback action and v1 route. Rejected/failed/exceptional attempts release the reservation; successful provider imports retain the charge. `lib/audit.ts` similarly preserves transport-owned best-effort audits for rollback actions and superadmin HTTP coordinators.
- Browser activity deletion remains superadmin-only despite the shared mobile/admin domain policy. Branding preserves root-layout invalidation and explicit current-page refresh. Backup export remains an admin read during write fences; restore remains bounded and atomic. Existing bearer DTOs, mobile idempotency/retry behavior, provider auth/recovery and migration compatibility are unchanged.
- Boundary enforcement now rejects browser imports of Server Actions and legacy `/api/data/*` or `/api/auth/*` URLs, and rejects v1/shared browser endpoints that depend on legacy route or action modules. CSRF origin validation now lives in neutral `lib/http/origin.ts`; the branding-logo preview resolves auth directly through the auth facade. Source caller-zero is proven; legacy server aliases remain deployable solely for rollback until deployment observation confirms no old consumers. This is not authorization to remove provider auth, write fences, portable retry/tickets, migration tools/state or applied migrations.
- Closure verification passed: 141 application test files and 1,601 tests passed, with 13 environment-gated files/60 tests skipped. Coverage passed at 72.17% statements, 63.59% branches, 79.09% functions and 75.72% lines. Lint, TypeScript, focused retirement-boundary regressions, and CI-equivalent Supabase/native production builds passed. Live database/provider-auth, Docker and Playwright checks were not rerun for this transport-only closure; earlier Phase 1/2 database evidence remains unchanged.

## 2026-09-26 â€” Browser own-profile editing moved to the versioned profile resource

- `MyProfilePanel` now uses `lib/data/client.ts` to submit department/title changes to strict cookie-enabled `PATCH /api/v1/profile`. The route calls the same `updateOwnProfileDomain` operation as the rollback Server Action, preserving trim/clear behavior, title-to-hierarchy validation and authenticated self-only persistence. The response acknowledges the write without a read-back; separate submissions are neither coalesced nor automatically retried.
- Profile read/write policy remains intentionally asymmetric: `GET /api/v1/profile` permits a signed-in inactive account to read its profile, while PATCH requires an active actor, same origin and an open write fence. Explicit bearer credentials do not fall back to cookies. Mobile `/api/v1/auth/me` retains its partial-input and actor-DTO response contract, and title reads remain in the later reference/activity-title slice.
- Verification: eight focused suites passed (99 tests); the settled application coverage run passed 135 files and 1,535 tests, with 13 environment-gated files/60 tests skipped. Coverage gates passed (71.33% statements, 63.10% branches, 78.17% functions, 74.89% lines), along with lint, TypeScript and native/Supabase production builds. Tests cover active/inactive separation, anonymous/origin/bearer/fence refusal, strict input, self scope, trimming/clears, hierarchy-title mismatch, provider errors, no read-back/coalescing and mobile regressions. Supabase compilation used CI-equivalent placeholders with its live Auth-config gate skipped. Live database/provider-auth, Docker and Playwright checks were not rerun for this transport-only slice.
- Next open Phase 3 row: activity-type mutations. Other administrative/settings/import-export slices and explicit legacy retirement remain open in the transport matrix. The prior architecture checkpoint is committed as `d9f8b80`; this own-profile slice remains reviewable and uncommitted.

## 2026-09-26 â€” Browser user administration moved to versioned resources

- Add-user, whitelist/user-panel and hierarchy-editor callers now use `lib/data/client.ts` for creation, status toggles, role/name/department/manager and hierarchy changes. Existing `/api/v1/admin/users` route files explicitly admit cookies under the shared active/origin/fail-closed-fence guard; permission-role admin is required independently of legacy/hierarchy roles. Explicit bearer credentials never fall back to cookies, and cookie access remains independent of the mobile feature switch.
- `packages/contracts/src/browser-users.ts` defines strict cookie create and discriminated mutation contracts. `lib/api/v1/services/browser-users.ts` delegates to the same narrow people-domain operations as the old actions, preserving current-server-state toggles, unconditional self-role/reporting-line guards, title-derived hierarchy, cycle rules, clear values, credential wording and operation-specific best-effort audits. Browser writes acknowledge completion without adding a read-back; mobile defaults, generic atomic updater and user DTO responses are unchanged. Separate browser writes are not coalesced or automatically retried.
- The seven user-administration actions remain rollback. Their components still use legacy title reads and user-timesheet deletion, owned by later settings/import-export slices; those transports are not retired. No provider, schema, budget, concurrency protocol, commit or deployment changed.
- Verification: seven focused suites passed (120 tests); the settled application coverage run passed 134 files and 1,516 tests, with 13 environment-gated files/60 tests skipped. Coverage gates passed (71.29% statements, 63.04% branches, 78.18% functions, 74.86% lines), along with lint, TypeScript, both native/Supabase production builds and CRLF-aware diff whitespace checking. Tests cover all operations, field mapping, no read-back, audits, title/cycle/self rules, origin-before-identity, closed/unreadable fences and bearer/mobile regression. Supabase compilation used CI-equivalent placeholders with its live Auth-config gate skipped. Live database/provisioning/provider-auth, Docker and Playwright checks were not rerun for these new transports.
- Next open Phase 3 row: own-profile editing. Other administrative/settings/import-export slices and explicit legacy retirement remain open in the transport matrix.

## 2026-09-26 â€” Browser project administration moved to versioned resources

- `ProjectManager` now uses `lib/data/client.ts` for add, rename, S.O. number, Telegram number and delete instead of importing Server Actions. The two existing `/api/v1/admin/projects` route files explicitly admit browser cookies; domain policy still requires an active admin/PM permission role independently of hierarchy/legacy roles. Origin-before-identity, bearer non-fallback and fail-closed write fencing remain in the shared guard.
- Browser create preserves the action's name-only domain call. `updateProjectFields` shares the original ordered field writes while allowing browser PATCH to acknowledge completion without a post-write read-back. Mobile/bearer PATCH still reads back and returns its project DTO. The existing manager refresh callback, normalization/clear values, positive-integer Telegram validation, duplicate-name/dependency failures and action rollback paths remain unchanged; direct submissions are neither coalesced nor automatically retried. Cookie patch structure rejects malformed optional-field types rather than silently clearing them.
- Verification: six focused suites passed (124 tests); the settled application coverage run passed 133 files and 1,482 tests, with 13 environment-gated files/60 tests skipped. Coverage gates passed (71.06% statements, 62.78% branches, 77.98% functions, 74.64% lines), alongside lint, TypeScript and native/Supabase production builds. Supabase compilation used CI-equivalent placeholders with the live Auth-config check skipped. No live database/provider-auth/Docker/Playwright checks were rerun for this slice; no schema, provider adapter, commit or deployment changed.
- Phase 3 remains partial: user/profile, activity types, global reminders, settings/branding/superadmin and import/export action slices, plus explicit legacy retirement, remain open in the transport matrix.

## 2026-09-26 â€” Browser timesheet actions moved to versioned resources

- Time-entry/backfill forms and the entries table now use `lib/data/client.ts` for create, yesterday, update, delete, duplicate and undo-last operations. Dedicated `/api/v1/timesheets/yesterday` and `/last` routes resolve the date/latest target on the server and preserve the existing domain/persistence path. Validation retains field errors and the browser adapter preserves action-facing resource messages.
- The bulk-edit modal now calls `POST /api/v1/timesheets/batch-update`, using the canonical 1â€“500-row contract in `packages/contracts`. Transport bounds are checked before budget reservation; row-value validation remains in the existing domain. Mixed results preserve `updated/errors`; all-failed results retain row details and the browser's `All edits failed.` message. The domain charges once and releases when no rows update or storage throws.
- Cookie writes retain origin-before-identity, active-account and fail-closed write-fence gates. Explicit bearer credentials never fall back to cookies. Browser submissions remain separate, direct writes: no single-flight coalescing, invented idempotency keys or automatic delayed retries. Existing mobile keyed-write behavior and the old Server Actions remain unchanged for rollback.
- Settled verification: 132 application test files passed, 13 environment-gated files skipped; 1,445 tests passed, 60 skipped. Coverage gates passed (70.87% statements, 62.36% branches, 77.85% functions, 74.50% lines), as did lint, TypeScript, native and Supabase production builds, and CRLF-aware diff whitespace checking. Focused tests include one-charge/refund, mixed/all-failed outcomes, batch bounds, ownership, origin/inactive/explicit-bearer refusal, and closed/unreadable write fences. Supabase compilation used CI-equivalent placeholder settings with its live Auth-config gate skipped. Live database, provider-auth, Docker and Playwright checks were not rerun for this transport-only slice; earlier evidence does not constitute verification of these new transports.
- Phase 3 is still partial: project/user/settings/superadmin/import-export action migrations and explicit legacy retirement remain open in `PHASE3_TRANSPORT_CONTRACT_MATRIX.md`. No schema, backend retirement, commit or deployment was performed.

## 2026-09-26 â€” Browser authentication moved behind versioned transports

- Native browser login, logout, session, signup, domain-check, forgot/reset-password and password-change callers now use explicit `/api/v1/auth/browser/*` routes. The legacy `/api/auth/*` endpoints remain available during the rollback window, but both route families export the same neutral browser handlers so their cookie, origin, rate-limit, signed-in-only and recovery contracts cannot drift independently.
- Existing mobile bearer endpoints under `/api/v1/auth/*` retain their token/session semantics and mobile feature flag. Browser login/registration is explicitly independent of that flag. Supabase provider login/logout/recovery/password operations remain direct SDK calls because their provider callback/session semantics are intentionally retained; only the application-owned two-phase mobile-session revocation moved to `/api/v1/auth/browser/revoke-mobile-sessions`.
- Focused verification passed across 14 auth/registration/recovery/mobile suites (137 tests) plus project TypeScript checking. Legacy/v1 browser aliases are also asserted structurally during the rollback window.

## 2026-09-26 â€” Migration tooling and portable-retry isolation

- Operator migration source and its test suite moved from application-owned paths into the private `@vsis/migration-tool` workspace (`migrations/tool/src/`, `migrations/tool/tests/`). `npm run migration` remains the root operator entry point, while dedicated package lint, type, unit/integration, and coverage gates now run in their own CI job.
- Request-time imported-history resolution, local-history precedence, replay authorization, namespace refusal, payload classification/translation, and fresh-key admission moved into `lib/idempotency/portable-retry.ts`. Ordinary local ledger/effect handling remains in `lib/idempotency.ts` and is supplied through explicit callbacks, preserving the application/operator dependency direction.
- Boundary tests forbid application imports of `@vsis/migration-tool` or `migrations/tool`; root application coverage continues to own runtime retry compatibility. No schema, public API, migration behavior, or retirement decision changed. Operator tooling remains gated by R2; runtime retry state/readers remain gated by R1 and the relevant R2/R3 obligations.

## 2026-09-26 â€” Broad repository facade retired

- Shared actor, result, input, and report contracts now live in `lib/db/types.ts`. The aggregate `Repository` interface and `lib/db/{index,native,supabase}.ts` facades were removed.
- `lib/rate-limit.ts` lazy-loads `lib/db/rate-limits.ts`, which selects the active provider's existing operations adapter for reserve/release. Both provider implementations and the limiter's fallback/refusal policy remain unchanged.
- Former facade tests now call their owning provider adapters directly, including registration's whitelist lookup. Authorization assertions remain in place, and a repo-wide boundary test prevents the removed facade imports from returning.
- The architecture context pack, contributor guidance, and current architecture references now describe narrow domain ports and composition modules as the persistence boundary.
- Verification passed: project typecheck and lint; the complete coverage run (141 files passed, 18 environment-gated files skipped; 1,714 tests passed, 86 skipped; 73.78% statements, 64.58% branches, 78.47% functions, 76.76% lines); the remote Supabase retry-history integration suite (3 tests, cleanup verified); the live Supabase Auth configuration gate; and both Supabase and native production builds. The Supabase checks used the external test-project settings from `C:/dev/timesheet-dual-backend-modular/.env.test`. A disposable local PostgreSQL 16 Docker container passed the native database suites (10 files, 48 tests), migration export (7 tests), C06B write-fence (3 tests), native provider-fence (8 tests; its Supabase leg skipped), and deployed-schema upgrade path (1 test). The container and all test data were removed afterward. Playwright and Supabase-specific live database/migration legs were not run because they require a seeded browser server or a local Supabase stack/direct Supabase database URL, not plain PostgreSQL alone.

## 2026-09-26 â€” Native destination decision recorded

- `docs/ai-context/ADR_NATIVE_DESTINATION.md` and the C00 ledger record Supabase â†’ native as the first production direction, with native surviving. This closes only the direction question; C00 operational inputs, original-provider recovery, C06B/C07/C08, and C09/C10 gates remain open. No runtime or deployment behavior changed.
## 2026-10-02 â€” Optimistic web mutations and chosen-date duplication

- Delta against `8507daa`: `duplicateEntry(entryId, targetDate?)` in `app/actions/timesheets.ts` adds a backward-compatible optional ISO date, validated after the mutating-actor gate and forwarded to the existing domain function. Source ownership, backfill policy, and target-day 24h checks still run through the same backend-neutral domain/repository boundary.
- Dashboard mutations use parent-owned pending overlays and row locks (`lib/optimistic-timesheets.ts`, `app/dashboard/page.tsx`) so guards survive table remounts. Commit-aware idempotent settlement and waiting out single-flight pre-write GETs protect overlapping refreshes; rejected writes don't invalidate another mutation's read. Rejections retain edit drafts or restore row ordering without requiring refresh. Local timestamp/counter temporary IDs are non-actionable and work outside secure contexts. Chosen-date copy eligibility is ownership-based; source edit/delete and destination write-window rules remain distinct.
- Bulk duplicates remain sequential: the Supabase daily-cap trigger lacks the native advisory lock, and the installed Next.js client dispatcher serializes Server Actions. No schema, repository, HTTP, auth, or mobile implementation changes. Fixture browser tests validate UX and transport recovery, not live database transactions; the detailed decision packet and limitations are in `docs/plans/archive/duplicate-ux-and-mutation-latency.md`.

## 2026-10-01 â€” Themeable web UI and report visualizations

- UI delta against source revision `6aaa2fd`: `app/components/ui.tsx` centralizes loading, alerts, icon buttons, and report table frames; the shortcuts modal now reuses `Dialog`. Dashboard panels use semantic neutral tokens rather than independent light/dark slate palettes.
- `app/layout.tsx` reads the presentation-only `theme` cookie. Shared, server-safe constants in `app/components/theme.ts` drive a pre-paint script; `theme-provider.tsx` follows OS changes or persists explicit light/dark preferences. `app/globals.css` supplies theme-switched surfaces, text, shadows, and chart colors. The workspace primary palette is unchanged.
- Final UI polish in `app/components/ui.tsx` exposes System/Light/Dark choices, contains segmented-tab scrolling, and keeps header controls usable at 320px. `e2e/ui-polish.spec.ts` uses browser-only auth/data fixtures to check mobile layout, chart accessibility, custom-range persistence, and shortcuts focus restoration independently of hosted account credentials; it does not validate backend authentication.
- Recharts is a lazy-loaded web-only dependency (`package.json`, `app/components/charts.tsx`, `app/reports/page.tsx`). Charts consume existing report results, preserve table/CSV access, label paginated totals as incomplete, and key async display results to their filters so stale values are not relabeled as a different period. `date-range.tsx` provides shared presets and custom-range controls. `app/reports/view.ts` keeps personal rows/charts/exports scoped to the viewer even after a group-report user selection.
- No Server Action, HTTP, auth, repository, database schema, or mobile contract changed. The existing semantic graph was not refreshed; consult current source for these UI/dependency additions.

## 2026-09-26 â€” Local Supabase logical backup

- `scripts/backup-supabase.mjs` / `npm run db:backup` provide an operator-only, read-only export using the installed CLI, pinned to the live Supabase project `bcsdqkjzobllocejfcdz` with no local/native/source-selection fallback. Run folders default to `C:\dev\db-backup`, are private before export, and are published only after all SQL files and checksums succeed; failed/interrupted runs remain `.partial`.
- Roles, application schema/data, migration history and an Auth/Storage schema reference are captured separately. This is not an application JSON backup, provider fence, data transfer, shared-snapshot export, or verified recovery rehearsal; platform secrets/configuration and Storage object files remain out of scope.

## 2026-09-23 â€” Fresh queued-work admission after migration

- Reference-free mobile creates from a remapped actor use a destination-local, server-minted idempotency key bound to actor, operation, 97-day expiry, and the current durable fence generation (`lib/idempotency-fresh-key.ts`, paired `0037`/`20261005000000` migrations). The mobile queue persists a key only on a newly enqueued item; existing keys and manual-review records are never retrofitted.
- Imported/local retry history is checked first. A reference-free create proceeds through the ordinary atomic idempotency claim only when its key matches the current admitted generation; legacy, expired, forged, or wrong-actor keys still require review (`lib/idempotency.ts`). An updated mobile client is required; the live C07 matrix and deferred C08 rehearsal remain open.

Maintain this file as a small rolling ledger of architecture-affecting changes. Do not copy ordinary implementation churn here.

## 2026-09-22 â€” Migration write-admission hardening remains partial

- Apply fails closed on a missing write-gate table or row before identity/data mutation and rechecks the fenced row under transaction lock. Completed receipts replay read-only while validating durable evidence and reporting row drift; data-committed promotion still needs a fence (`migrations/tool/src/gate.ts`, `migrations/tool/src/import.ts`).
- Server Actions now separate active/role/super-admin read checks from explicit fail-closed mutating wrappers (`app/actions/_shared.ts` and action transports).
- The provider fence records a versioned digest-bound inventory artifact and verifies SQL/REST denial more strictly, but remains a **partial DML privilege primitive**. It does not stop Supabase Auth/admin, jobs, integrations, ingress, or existing connections; C00/C07/C08 retain those gates.

## 2026-09-21 â€” Migration provenance identity and recovery hardening

- Supabase durable database namespaces now always use the verified project reference when available; `pg_control_system()` remains the native/no-project-reference fallback. Direct and restricted/pooler roles therefore cannot split one Supabase database's receipts and mappings into different provenance namespaces (`migrations/tool/src/providers/session.ts`).
- The adopted C06A rule now classifies never-committed queued payloads from server-owned mappings: fully source-era payloads are translated, destination-era payloads proceed unchanged, and mixed/ambiguous payloads require review. This supersedes the unresolved statement in the 2026-09-20 entry.
- The development recovery harness now injects dropped Auth responses, lost SQL commit responses, unreadable post-commit receipts, failed identity-journal writes, source Auth/profile inconsistencies, and unrelated destination drift after provisioning. The identity cases capture real Supabase Auth/profile facts through the migration read boundary and guard against any destination Auth/write mutation. Gate snapshot/fencing is row-locked and teardown restores the exact pre-test state only while the row is still suite-owned; a concurrent operator transition is preserved and fails the suite. The current revision passed all seven cases against the loopback Docker/Supabase stack, closing the C02/C04/C05 evidence gate without making a production claim (`migrations/tool/tests/migration-recovery.int.test.ts`, migration execution notes).
- Free-form migration diagnostics redact connection strings, bearer credentials, JWTs, inline secret fields and Supabase key formats before CLI output or journaling (`migrations/tool/src/journal.ts`).

## 2026-09-20 â€” Migration receipts, dispositions and portable retry evidence

- Migration bundles now carry digest-bound `retry-history.json` facts for the eight queued mobile mutations. Apply stores them in protected `migration_retry_history` tables in both backend tracks, alongside complete durable record dispositions.
- Runtime idempotency lookup evaluates destination-local and imported histories together and replays only one exact committed fingerprint. Conflicts, uncertain results and equal matches across namespaces return 409; requests containing a known remapped source id also fail closed.
- Never-committed queued work still lacks authenticated source namespace/timestamp context, so safe forward ID translation is unresolved. C03/C06A remain blocked rather than claiming the portable strategy complete.
- Apply persists `verified` only after rows, mappings, dispositions and retry history reconcile. Publication intent now requires `verified`.

## 2026-09-19 â€” C04 identity review

- The migration bundle gained a digest-bound, optional `identities.json` (`migrations/tool/src/format.ts`, `export.ts`, `validation.ts`): the source's sign-in providers and second-factor counts (plus native credential presence) are captured under the export snapshot and bound into a reviewed plan's `snapshot.sourceIdentities`. The plan's existing `snapshot.identities` remain destination facts used for matching and drift.
- `migrations/tool/src/identities.ts` reads only the source inventory, fails closed (`E_IDENTITY_INVENTORY_MISSING`) when a provisioned account has no captured facts, and blocks a referenced profile that the merged result does not contain (`E_HISTORICAL_UNRESOLVED`) instead of failing later as an FK orphan.
- `migrations/tool/src/import.ts` reports the journaled provisioning outcomes and removes only run-created accounts when a provisioning pass fails; `deploymentSnapshotDigest` now binds destination provider identities and MFA factors; `providers/read.ts` probes `auth.mfa_factors` with `to_regclass` so the compatibility fallback cannot abort the planning transaction.
- At that review point C04's PASS was suspended pending a live rerun. That historical suspension was resolved by the seven-case loopback Supabase recovery run on 2026-09-21; current evidence and remaining gates are recorded in `migrations/docs/SUPABASE_NATIVE_MIGRATION_NOTES.md`.

## 2026-09-19 â€” C03 exporter review

- `migrations/tool/src/export.ts` now reads schema metadata, entity rows, and committed-receipt-backed provenance in one repeatable-read source transaction. Provenance uses keyset batches and incremental file hashing/size checks rather than loading the full mapping table into memory; the manifest remains the final artifact.
- `migrations/tool/src/providers/session.ts` preserves the transaction callback failure when a dropped connection also prevents rollback, keeping interrupted exports classifiable. The exporter keeps a file-stream error listener while awaiting database batches and reports source values violating known shared destination checks without changing them.
- The C03 PASS claim is suspended pending a disposable live rerun after these fixes and the C06A contract required by the implementation plan. C00 still needs deployment and operator inputs.

## 2026-09-19 â€” Migration provenance and recovery review

- `migrations/tool/src/matching.ts`, `providers/read.ts`, and `resolutions.ts` treat bundle aliases as review evidence and trust only destination-local mappings joined to committed run receipts, including `publication-intent`.
- `migrations/tool/src/cli.ts` reads the complete planning destination snapshot in a repeatable-read transaction. `migrations/tool/src/schema.ts` binds compatibility to provider-specific schema fingerprints and the paired receipt migrations.
- `migrations/tool/src/merge-plan.ts` rejects duplicate user/date timesheets before apply, matching the database unique index.
- `migrations/tool/src/identity.ts` and `providers/supabase.ts` mark newly created Auth users with the run id, require that marker to reconcile a lost creation response, and recheck it before cleanup. `migrations/tool/src/import.ts` checks a durable receipt after an uncertain SQL commit before any Auth deletion, reads provenance for the planned source namespace during drift checks, and never treats a failed receipt as a completed no-op.
- The current review evidence and remaining disposable live gates are recorded in `migrations/docs/SUPABASE_NATIVE_MIGRATION_NOTES.md`; C00 still needs deployment and operator inputs.
- C06B still owns destination-wide fencing/locking: a receipt check alone cannot make Auth cleanup safe against a concurrent apply.

## 2026-09-17 â€” Maintainability navigation correction

- Corrected the compact context pack to reflect the already-implemented
  `@vsis/client -> @vsis/contracts -> @vsis/core` dependency direction,
  timesheet domain port/composition, native/Supabase adapter pair, and current
  browser `/api/v1/timesheets` read path.
- Added `docs/guides/SAFE_CHANGES.md` with two source-backed navigation drills,
  ownership routing, and focused checks.
- This is documentation and discoverability work against source revision
  `c319473ba02070cc213e6e1a67550ce5811bcf69`; no runtime boundary or public
  contract changed.

## 2026-09-15 â€” AI retrieval/context infrastructure

- Added the compact `docs/ai-context/` retrieval pack.
- Added Serena project metadata (`.serena/project.yml`) and validated TypeScript symbol/reference lookup.
- Added Atlas orientation tooling and RTK CLI-compaction guidance at the Codex user/tooling layer.
- Kept the existing Understand Anything graph as the semantic/dependency layer.
- No application source or public runtime contract was changed by this setup.

## 2026-09-15 â€” Registration and live-gate remediation

- Public server-side Supabase registration now uses a fresh anonymous Auth client per operation, fails closed when the provider unexpectedly returns a session, and removes the just-created identity before reporting the configuration failure.
- CI's explicit Supabase live gate now executes both authenticated RLS/restore and registration-confirmation suites with mandatory prerequisites.
- Supabase fixture seeding now whitelists every configured fixture domain before Auth creation; the forward restore migration owns the latest `restore_backup_tx` definition and preserves service-role-only execution.
- The local-only migration-chain repairs are documented as a pre-apply fresh-stack baseline exception; no public route or released response shape changed.

## 2026-09-17 â€” Security, CI, and release verification hardening

- Added production security-header/CSP coverage and tightened the CI/E2E verification path across `next.config.ts`, `.github/workflows/ci.yml`, `scripts/verify-e2e-fixtures.mjs`, `supabase/config.toml`, and their tests.
- Added the signing-key export/fixture boundary used by deterministic verification; secret material remains environment/configuration scoped rather than part of application DTOs.
- These changes affect deployment and verification boundaries but do not change the stable web, mobile, or repository response contracts.

## 2026-09-17 â€” Team-scope RPC contract correction

- `lib/db/supabase/timesheets.ts` now calls `public.team_ids(target)` with the function's actual argument name, preserving leader self-plus-subordinates scoping.
- `supabase/demo_seed.sql` uses the same `target uuid` signature and `tests/supabase-repository-authz.test.ts` covers the success and RPC-error paths.
- This is an authorization-scoped persistence correction: native/Supabase parity and the repository contract remain unchanged.

## 2026-09-23 â€” Migration publication/fence generation binding

- `migrations/tool/src/publish.ts` now requires the locked destination gate to be fenced for the receipt's run and namespace before verification, intent, or admission; a stale receipt cannot admit a later run.
- `migrations/tool/src/gate.ts` retains a UUID per fenced window, refuses a new generation for a run with a durable receipt, and permits explicit recovery opening only for the matching locked run before publication intent. Normal admission stays atomic in `publish --phase admit` (`migrations/tool/src/cli.ts`).
- Provider grant inventory and revocation now share the gate-row lock in one transaction (`migrations/tool/src/cli.ts`, `migrations/tool/src/providers/fence.ts`). Both migration ledgers require the gate-generation migrations (`migrations/tool/src/schema.ts`). This hardens the migration control plane but does not replace deployment-wide writer shutdown or live C06B/C08 proof.

## Current evidence status

The context pack in the working tree is current through `c319473ba02070cc213e6e1a67550ce5811bcf69`. Understand Anything's existing graph remains preserved and structurally valid, but its metadata baseline is `55545e77b7b655b0f72e0b5d889ee61ada6d87e7`; refresh it incrementally before using graph relationships for files changed after that baseline.

## Current architecture baseline

The baseline remains the dual-backend architecture described in `docs/architecture/AI_ARCHITECTURE_CONTEXT.md` and enforced by `AGENTS.md`: a backend-neutral auth facade, narrow provider-selected persistence ports and composition modules, web + versioned mobile HTTP surfaces, two role axes, paired migration tracks, and native/Supabase authorization parity.

## 2026-09-30 â€” Mobile dashboard/reference loading

- `mobile/src/auth/session-read-cache.ts` adds provider/session-owned, memory-only
  30-second read reuse and shared pending requests. `SessionProvider.tsx` clears
  caches on workspace/account/session changes and unmount; superseded responses
  cannot replace fresh data or repopulate the cache after logout.
- Dashboard/reference loaders accept an optional force flag. Manual dashboard
  refresh, domain mutation callbacks, and successful offline-queue sync force a
  fresh read. Server authentication, APIs, persistence, and startup restoration
  remain unchanged. `SettingsAdminScreen.tsx` no longer reloads settings/users
  when reference data or picker selections change.
- Decision and lifecycle checks: `docs/plans/archive/MOBILE_LOADING_IMPROVEMENTS.md`;
  regression coverage: `mobile/__tests__/mobile-loading.test.tsx` and
  `mobile/__tests__/session-read-cache.test.ts`.

## 2026-10-01 â€” Export guard and Android staging repair

- `migrations/tool/src/export.ts` selects its legacy-profile data guard from
  inspected `profiles.full_name` column presence instead of an undefined schema
  fingerprint. The strict CLI source-schema allowlist remains unchanged; this
  repair does not admit legacy catalogs as supported migration sources.
- `mobile/android/app/build.gradle` uses Android Gradle Plugin staging defaults
  unless `cmakeStagingDir` is explicitly configured, removing the shared absolute
  Windows path. Operator guidance and repair evidence are in `mobile/README.md`
  and `docs/plans/archive/EXPORT_ANDROID_REPAIR.md`.

## 2026-10-01 â€” Mutation input validation parity

- Personal reminder state updates now require an explicit boolean `done` at the
  shared leave/reminder domain boundary. Both versioned and compatibility HTTP
  transports reject malformed or missing state instead of coercing it; the
  compatibility route returns the established HTTP 400 validation response.
- Bearer/mobile admin-user mutations validate supplied `isActive` and `managerId`
  before identity or profile work. `isActive` accepts only booleans and
  `managerId` accepts only strings or null; omission/default semantics and the
  existing typed mobile/browser contracts are unchanged. This prevents malformed
  JSON from changing account status or clearing reporting relationships through
  transport coercion.
- Decision and verification evidence is tracked in
  `docs/plans/archive/CONTINUOUS_BUG_AUDIT.md` (settled batches B05-B06).

## 2026-10-01 â€” Reference mutation validation parity

- Bearer/mobile activity-type PATCH validates every supplied field before domain
  mutation: `name` must be a string, `isActive` must be boolean, and `telegramNo`
  must be null or a positive integer (`app/api/v1/admin/activity-types/[id]/route.ts`,
  `lib/domain/reference.ts`). The domain preflights the entire aggregate patch
  before its first write, preventing a valid early field from committing when a
  later supplied field is invalid.
- Bearer/mobile title reclassification accepts `syncUsers` only as a boolean and
  preserves the existing omitted-value default of false
  (`app/api/v1/admin/titles/route.ts`, `lib/domain/reference.ts`). This keeps
  malformed JSON from triggering profile hierarchy-role synchronization through
  JavaScript truthiness.
- Public success shapes and valid omission/null semantics are unchanged. Decision
  and verification evidence is tracked in
  `docs/plans/archive/CONTINUOUS_BUG_AUDIT.md` (settled sixth batch).

## 2026-10-03 â€” Windows package signer selection

- `mobile/scripts/package-windows.js` uses `mobile/scripts/windows-signing.js`
  to inspect PFX metadata without importing certificates, select exactly one
  non-CA Code Signing certificate matching the manifest publisher, and pass
  its thumbprint to MSBuild. This resolves APPX1204 ambiguity when an internal
  CA chain is included in the PFX. `WINDOWS_CERT_THUMBPRINT` optionally narrows
  multiple eligible leaves; zero or multiple matches stop packaging.
- The inspection process uses built-in Windows PowerShell module paths,
  receives passwords through its environment, and sanitizes failure diagnostics.
  Unsigned packaging bypasses inspection. No certificate trust stores change.
- `mobile/__tests__/windows-signing.test.js` covers selection, ambiguous and
  invalid inputs, secret-safe errors, MSBuild forwarding, unsigned bypass, and
  real PowerShell filtering with synthetic certificate metadata. Decision scope
  is recorded in `WINDOWS_SIGNER_SELECTION_PACKET.md`; a signed package retry
  with the operator's PFX remains required.
- A reported selection failure now emits a closed set of stage codes and integer
  filter counts instead of discarding all diagnostic context. Raw exceptions and
  unrecognized output remain suppressed. A temporary real test PFX containing a
  leaf and CA chain passes selection; a wrong test password reports PFX_READ_FAILED.
  The operator-specific failure remains unknown pending the safe retry output.

## 2026-10-03 â€” legacy Supabase source compatibility and column retirement

- migrations/tool/src/schema.ts admits the exact inspected legacy Supabase
  source catalog and its post-full_name-retirement shape as source-only
  fingerprints. Actual fingerprints, canonical required values and strict
  destination admission are preserved; unrelated catalog drift still fails.
- migrations/tool/src/cli.ts selects source admission for live/bundle source
  checks in export, preflight and plan. Default destination admission is unchanged.
- The user approved skipping profiles.full_name and planning retirement.
  Canonical profile projection and the existing snapshot-bound legacy equality
  guard remain unchanged. No new row format, application API or live DDL.
- Decision: C00_SOURCE_SCHEMA_DRIFT_PACKET.md. Execution prerequisites are in
  ../plans/PROFILE_FULL_NAME_RETIREMENT_PLAN.md; source compatibility evidence
  is in ../plans/evidence/c00-source-compatibility-2026-10-03.json. Migration
  package unit, coverage, type and lint gates pass; live read-only checks pass.

## 2026-10-04 â€” actual-data operator merge and metadata persistence

- `migrations/tool/src/import.ts` derives existing-row mutations from reviewed
  expected state, including map decisions; only changed nullable Telegram slots
  are released inside the existing fenced transaction before final writes.
  Compound creates use canonical primary keys rather than an assumed `id`.
- `persisted-key.ts` encodes compound/reserved-prefix metadata keys reversibly
  at PostgreSQL text boundaries. Import verification, provider provenance and
  reverse export decode them; canonical artifacts and ordinary UUID mappings
  stay unchanged. No applied migration or application runtime contract changed.
- `merge-plan.ts` keeps imported row identity stable through dependency rewriting
  and derives compound destination mappings from final rows before validation
  and digest generation. Regression coverage includes remapped parents and
  overlapping tuples, immediate unique slots, rollback and reverse provenance.
- Decision packets: `C08_REFERENCE_MERGE_REPAIR_PACKET.md` and
  `C08_PERSISTED_KEY_REPAIR_PACKET.md`. Settled migration coverage matrix:
  401 passed, 26 missing-prerequisite skips; 15 live PostgreSQL regressions pass;
  lint/typecheck pass. Independent bounded migration review closed R1.
- Actual-data disposable import/verify/no-op, restore/abort, fence and local
  application smoke passed. Re-resolved actual-data mappings and all reviewed
  digests are unchanged by the closure patch. Production cutover and complete
  freeze-window timing remain open; see
  `../plans/evidence/c08-actual-data-rehearsal-2026-10-04.md`.

## C08 local OpenShift qualification â€” 2026-10-05

The pinned native 1.1.6 image passed fresh Supabase 1.0.3 disposable migration
on CRC with TLS/SCRAM Docker PostgreSQL, final HTTPS route and local mail capture.
The unchanged clock measured 8m 52.476s; 23m 52.476s includes the 15-minute reserve.
Canonical migration/import/verify/admission boundaries remain unchanged.
Operational guards verify effective Pod database/role, credential overrides,
complete pre-intent merged digests and admission-bound terminal smoke evidence.
No production control, primary import/admission or post-intent restore occurred.
See `../plans/evidence/c08-openshift-timing-2026-10-05.json` and preparation notes.

## External native reset validation â€” 2026-10-05

The pinned native 1.1.6 OpenShift application sent one actual Resend SMTP reset
message to the authorized test address on a disposable fixture. Provider delivery,
fragment-token consumption/reuse rejection and fresh login passed. Existing SMTP
support required no app/image change. Temporary credential delivery used stdin
and a new cluster Secret, deleted after stopped-binding restoration. Teardown
preserves all 24 clone tables, 28 owners and explicit privilege manifests; primary
and original rehearsal data/privileges remain unchanged. See
`../plans/evidence/c08-external-password-reset-2026-10-05.json`.
Production cutover remains deferred; Vercel-only source writer inventory confirmed.

## Update rule

Add an entry when a change alters a major boundary, public contract, persistence/auth model, deployment topology, cross-package compatibility surface, or invariant in `CONSTRAINTS.md`. Include the source paths and any ADR/reference that explains the decision.

## 2026-10-05 â€” Operator migration files centralized

The private operator workspace moved to `migrations/tool/`, preserving repository-relative imports and npm package identity. Migration runbooks/decision packets and sanitized evidence moved to `migrations/docs/` and `migrations/evidence/`; active links, CI, source packaging, lint/types and workspace lock references follow the new paths. Schema runners keep `db/migrations/` and `supabase/migrations/`. Captured rehearsal helpers are reference material under `migrations/rehearsal/scripts/`; raw reports, journals and performance logs were preserved in ignored local folders. Application import guards cover the new path. No database, provider or cluster changes occurred. See [implementation guide](../guide/MIGRATION_IMPLEMENTATION.md) and [decision packet](../../migrations/docs/decisions/MIGRATION_ORGANIZATION_PACKET.md).

## 2026-10-05 — Independent review closes stale snapshot mutation risk

The independent review found that failed bulk reconciliation retained rows usable
by a later full-field edit. EntriesTable now permits snapshot actions only for
the current ready read context; loading/error transitions invalidate reusable
selection, drafts, confirmations and pending history while preserving submitted
batch locks. Public API and persistence contracts are unchanged. Both backend
builds, application coverage and 18 distinct mocked browser scenarios passed;
the reviewer closed P2. See [review evidence](../../migrations/evidence/independent-review-2026-10-05.md).
