# C00 writer-control inventory — 2026-10-03

> Archived 2026-10-04 as supporting reference. Recorded evidence, contracts and
> unverified limitations retain their scope; this move marks no pending check complete.
> Current work follows the [active plans](../../README.md#active).

## Scope and current evidence

Source: hosted Supabase `bcsdqkjzobllocejfcdz`. Destination: native database
`vsis_migration_destination_20261003` in local Docker. Neither deployment was
fenced by this inventory. Runtime owners, service identities, external endpoint
names, shutdown commands and drain completion remain **UNKNOWN** unless recorded
below. Repository configuration is evidence of a possible writer, not proof that
the corresponding job or service is deployed.

Later Vercel inventory verifies production main at ts.kst.st (1.0.3) and the
architecture branch at ts-dev.kst.st (1.1.2), both Supabase and in one Vercel
project. Exact commit/source version checks pass; the native app remains unknown.
Production cron is enabled with one cleanup definition. Shared Supabase URL
scope is observed, but its sensitive value and deployed database binding remain
unverified. A 2026-10-04 read-only follow-up confirmed why: Vercel marks the
production/preview entry sensitive, and Vercel documents that sensitive values
are non-readable once created. The project-env read endpoint returned no value,
and `vercel env pull` returned only a short Vercel reference token; both probes
were compared in memory and temporary files were removed without printing any
environment value. A repo-root `vercel env run` result that matched the source was
rejected as deployment evidence because Vercel said the secret values could not
be pulled and loaded local `.env.local`. Repeating `env run` from an empty probe
directory with the project explicitly selected left the sensitive binding absent,
confirming that this CLI path cannot reveal it. Exact production binding therefore
requires deployment-bound runtime evidence or operator confirmation rather than
another config-value read.
On 2026-10-04 the operator explicitly confirmed that production `ts.kst.st` is
intended to use source project `bcsdqkjzobllocejfcdz`, closing the application-to-
source identity item for the current deployment. This confirmation does not close
writer stop/drain, Auth/admin, session, old-deployment, or privileged-credential
controls.
These results supersede the scheduler/deployment UNKNOWNs below only
for the facts named here; stop/drain controls remain open. See
[deployment inventory](C00_VERCEL_DEPLOYMENT_INVENTORY.md).

Later local C07 evidence resolves the native-app identity/binding leg: a 1.0.3
compatibility harness reports backend native and connects to
vsis_migration_destination_20261003. An authenticated browser session was denied
with 503 WRITERS_FENCED while reads remained available, and an unconfigured local
cron endpoint failed closed with 503. The harness requires a one-line
route-export compatibility edit, so it is not a byte-for-byte pristine
production-commit artifact. This evidence does not stop or drain production
cron, Auth/admin, direct SQL/PostgREST, integrations, ingress or established
sessions. See
[C07 native binding evidence](../evidence/c07-native-app-binding-2026-10-03.json).

The concrete freeze/drain ordering, denial-probe matrix and recovery release
rules are now recorded in
[the production freeze/drain runbook](../C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md).
It is preparation/rehearsal material only; its unresolved provider controls are
explicit blockers and no production control was applied while drafting it.

The current architecture branch now closes the repository-level scheduled-cleanup
gap: after `CRON_SECRET` authentication the cron route performs a fresh privileged
read of `migration_write_gate`. Native reads use the native pool; Supabase reads
use the server-only service-role client instead of request cookies/bearer state.
Fenced, missing, or unreadable gate state returns 503 before session, rate-limit,
or idempotency cleanup can run. Focused cron/write-gate verification passes 14/14
tests across two files, with root typecheck, targeted lint and the native
production build also passing. This code is not deployed to production 1.0.3,
so it does not close provider stop/deny or in-flight drain proof.

2026-10-04 read-only provider discovery narrows the Vercel controls. Installed
Vercel CLI 59.23.2 confirms the single production cron at
`/api/v1/cron/cleanup` (`0 0 * * *`) and reports no configured project firewall.
Its authenticated API catalog exposes reversible project pause/unpause endpoints
for project `timesheet` (`prj_WxsrNA1HHB3gDNuYsTi87uuW9hWl`), and generate-only
inspection confirms both are bodyless POSTs. No pause/unpause request was
executed. The cron CLI exposes add/list/run, but no disable command, so rehearsal
must still prove that project pause prevents scheduled and manual cron execution
before treating it as the complete ingress/cron control. Because both known
aliases share the same production project, that proof must use a separate
disposable Vercel project; pausing the current project for rehearsal would affect
production. The installed Supabase CLI 2.117.0 exposes project
list/create/api-keys/delete, not a project or Auth freeze subcommand. Current
Supabase platform documentation and Management API permissions do expose a
project-pause control, but manual pause is limited to Free projects. The source
project is ACTIVE_HEALTHY; current CLI organization/project metadata does not
expose its billing plan, so pause eligibility remains UNKNOWN. Provider Auth
configuration can disable new signups, but that does not stop existing-user
sign-in or already-issued session refresh. Database network restrictions apply
to Postgres/pooler connections and explicitly do not cover HTTPS PostgREST,
Storage or Auth traffic. The exact Supabase Auth/admin/API freeze mechanism
therefore remains open unless an eligible full-project pause is separately
rehearsed and admitted.

The operator selected existing timesheet-test for original-provider recovery in
`V S Information Systems (Pvt) Ltd` (`wyemdhldxckcpshqehgu`), superseding the
proposed new project's provisioning/billing gate. Exact identity/access checks,
authorized cleanup and scoped logical source restore pass; Docker native remains
primary. No new project, payment or upgrade ran. This recovery test does not prove
deployment fencing or account/platform recovery. See
[restore result and remaining gates](C00_SUPABASE_SOURCE_RESTORE.md).

## Surface map and required proof

| Surface | Verified source evidence | Control and proof still required |
| --- | --- | --- |
| Browser REST writes | `app/api/_http.ts:requireActive` checks the durable gate for unsafe methods after active-actor validation. | Select the deployed app/ingress owners; block new mutating traffic, drain in-flight writes, and prove write refusal through each deployed route family. Reads remaining available does not prove background writers stopped. |
| Server Actions | `app/actions/_shared.ts` provides `requireMutatingActiveActor`, `requireMutatingActor`, and `requireMutatingSuperAdmin`. | Verify deployed release and action coverage, including administrative import/restore/reset operations; deny or drain queued invocations. Local guard tests are not hosted deployment proof. |
| Mobile data API | `app/api/v1/_http.ts:applyFence` checks unsafe methods and fails closed if the gate cannot be read. | Prove bearer/cookie write paths and stale queued retries against the deployed release; record the supported client versions. General Windows UI acceptance does not close the migration session/remapping matrix. |
| Browser authentication | `app/api/_native-browser-auth.ts:nativeBrowserLogin` reserves/releases rate-limit storage and signs in; it does not use `requireActive`. Legacy and versioned browser login routes re-export it. | Stop or deny auth ingress independently of ordinary data guards; enumerate signup, password recovery/change, logout and revocation paths and prove their persistent state is quiescent. |
| Mobile authentication | `app/api/v1/auth/login/route.ts:POST` uses credential verification, rate-limit storage and `loginMobileIdentity` session creation; ordinary active-actor data fencing is not its entry guard. | Select controls for login, refresh, password change, logout/revocation and provider calls; prove both new requests and established sessions cannot mutate during freeze. |
| Hosted Supabase Auth/admin | Hosted source has 23 Auth users. SQL DML revocation for ordinary roles does not disable provider Auth/admin access. Supabase Auth's signup-disable setting blocks new registrations only; it does not quiesce existing-user sign-in or existing sessions. Management API/MCP exposes project pause, but current docs limit manual pause to Free projects and the source plan is still unknown. | Name the dashboard/admin/service credentials and owners; determine source pause eligibility read-only. If eligible, rehearse full project pause/resume on a separate disposable Free project before considering it. If not eligible, select another provider-specific Auth/session/admin quiesce procedure. Signup disable and DB network restrictions alone are insufficient. |
| Application `service_role` writers | `lib/supabase/admin.ts:getAdminClient` is referenced by Supabase registration/profile creation and cleanup, mobile-session persistence, idempotency/fresh-key persistence, scheduled maintenance, admin reset/import/backup/restore/audit/rate-limit operations, account create/delete, selected reference-data mutations and bulk timesheet update. These paths intentionally bypass ordinary RLS when their surrounding domain/API authorization admits the operation. | Treat the Vercel/server runtime itself as a privileged writer. Anon/authenticated grant revocation does not stop these calls. Prove ingress/cron denial and drain before the final snapshot, and separately account for any operator or external process holding the same service-role credential. |
| PostgREST and SQL | Live source has DML grants for anon/authenticated on 12 public tables and service_role/postgres on 23. RLS is enabled on listed public tables; 13 public functions are SECURITY DEFINER. | Inventory role memberships, effective privileges, function writers and service identities; prove refusal for every identified writer, not only direct table grants. Include SQL clients and established connections. |
| Scheduled cleanup | Vercel CLI confirms production cleanup cron enabled, path `/api/v1/cron/cleanup`, schedule `0 0 * * *`. Both deployed commits still lack a direct migration-gate check. The current architecture branch adds a fresh privileged cross-backend gate read after cron-secret authentication and refuses fenced/missing/unreadable state before cleanup; focused verification passes 14/14. Vercel CLI 59.23.2 has no cron-disable subcommand; project pause/unpause is the ingress-freeze candidate. | Deploy and verify the hardened route, and rehearse project pause/unpause only on a separately verified disposable Vercel project. Abort the rehearsal if the resolved project id equals production `prj_WxsrNA1HHB3gDNuYsTi87uuW9hWl`. Until that proof exists, keep a separate production cron deny/drain step. Branch source evidence does not replace provider shutdown/drain proof. |
| External jobs/integrations | Source snapshot listed no pg_cron extension or deployed Edge Functions. Repository scheduled cleanup remains a distinct potential writer. | Operator inventory of external schedulers, integrations, direct SQL scripts, operator tooling and automation; absence of database jobs is not proof of no external writers. |
| Operator/admin tooling | `db/migrate.ts` and `db/seed.mjs` write through `DATABASE_URL`; `scripts/seed-supabase-matrix.mjs` can use `SUPABASE_SERVICE_ROLE_KEY`; `tools/migration/` opens explicitly named migration connections; backup/restore/import surfaces exist in the app and operator workspace. CI references local/disposable database and Supabase credentials, which is workflow evidence rather than production deployment proof. | Record who can run each production-capable tool and from where. During freeze, either disable/withhold the production-capable environment bindings or prove the owning process/operator is idle. Keep migration-tool connections explicit; do not let application `DATABASE_URL` or service-role credentials become an implicit operator fallback. |
| Native app process | Existing Compose definition starts an app with a native database connection. The selected destination is currently a database-only target; a deployed destination app identity has not been recorded. | Name actual app workers, startup migration processes, admin clients and pool identities; select ingress shutdown and pool draining. Do not infer deployment identity from the repository Compose example. |
| Existing sessions/tickets | Source snapshot has 54 unexpired/unrevoked mobile sessions and 220 unexpired fresh tickets. | Record real client/queue counts, revocation/drain decisions and replay handling. Counts do not prove active device usage or client-local pending writes. |

## Local native mechanism verification

The existing provider-fence and V6 suites ran serially against a unique,
previously absent loopback database and test role. **11 tests passed; one hosted
Supabase live test was intentionally skipped**. The native SQL probe discriminated
write admission from denial and verified grant restoration. V6 exercised real
gate/receipt storage, REST and action guards, publication and crash boundaries;
it mocks authentication, so this is not a real login/session matrix.

The C00 destination's exact public-table counts, complete migration ledger and
gate row matched their pre-test snapshot. V6 intentionally leaves its disposable
database until its process has exited. After that exit, only the new fixture was
removed; no test role or database remained. Evidence:
[native mechanism results](../evidence/c06b-native-mechanism-2026-10-03.json) and
[verification packet](../../ai-context/C06B_LOCAL_FENCE_VERIFICATION_PACKET.md).
Test runtime is not a representative migration or recovery measurement.

## Gate closure requirements

For each deployed writer, record its owner, credential/role identifier (no
secrets), endpoint/process, exact stop/deny command, in-flight drain criterion,
denial probe, release ordering and recovery procedure. Tie the evidence to the
selected deployment, release, run ID and fence generation. Resolve ingress,
Auth/admin, jobs, integrations, privileged SQL and established connections
together before a source snapshot or apply. Neither this matrix nor the local
test pass closes C06B. C07 and measured C08 rehearsal remain dependent on those
deployment controls and recovery readiness. Use
[C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md](../C00_PRODUCTION_FREEZE_DRAIN_RUNBOOK.md)
as the operator checklist once each UNKNOWN control is replaced with a rehearsed
provider-specific command and owner.
