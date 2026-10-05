> Historical reference archived 2026-10-04. The complete previous document body follows;
> dated headings, checkpoint statuses and operational requirements below describe the old process.
> Current execution follows the [four-stage plan](../SUPABASE_NATIVE_MIGRATION_IMPLEMENTATION_PLAN.md).
> This snapshot is evidence, not production authorization or a current checklist.

# C00 production freeze/drain runbook — preparation only

**Status:** DRAFT / REHEARSAL-ONLY. This document prepares C06B/C07/C08 evidence.
It does not authorize C09, change production, or declare the source ready to
freeze. The current production release is 1.0.3 on Supabase; its deployed cron
route does not contain the architecture branch's migration-gate hardening.

The first production direction is hosted Supabase source
`bcsdqkjzobllocejfcdz` to the Docker-native destination. Existing Supabase
project `timesheet-test` is the reserved original-provider recovery target.
Connection strings and provider secrets are referenced only by environment
variable name and must never be copied into this runbook or command output.

## Admission prerequisites

Do not begin a final source snapshot until all of these are recorded for the
exact deployment under test:

1. The production application is proven to bind to source project
   `bcsdqkjzobllocejfcdz`. For the current `ts.kst.st` deployment this is satisfied
   by explicit operator confirmation dated 2026-10-04; record a fresh confirmation
   or deployment-bound proof if the project/domain/environment changes. Shared
   Vercel environment-variable scope alone is not enough.
2. The exact application release and commit used for the rehearsal are recorded.
   If that release does not contain the scheduled-maintenance gate check, the
   platform-level cron deny below is mandatory before the database freeze.
3. The native target application/build is bound to the Docker native database
   and the source/target release policy passes.
4. The protected source backup and `timesheet-test` recovery procedure remain
   readable and their reconciliation checks pass.
5. The C07 real client/session matrix is complete, including remapped-actor
   replay, stale keys beyond the horizon, and old-token rejection.
6. A run id, operator identifier, reason, protected fence-artifact location and
   rollback owner are recorded. The artifact path must be unused and private.
7. Every privileged writer has a named owner and a stop/deny procedure: Vercel
   cron/manual invocation, Supabase Auth/admin, `service_role`, PostgreSQL/admin
   SQL, external automation/integrations, and any old deployment URL.
8. A drain observation criterion is declared as `drain_observation_seconds`.
   Do not infer this value from current traffic.

## Freeze order

The order is deliberate: control the application first, bind the database fence
to the run, remove ordinary provider DML, then remove remaining platform ingress
and privileged writers and prove the system is quiet.

### 1. Read the durable source gate

```powershell
npm run migration -- gate --target supabase --target-env MIGRATION_SOURCE_DB --json
```

Record the current state, run id and fence generation. Abort if the database
identity is not the approved source or the gate/migration ledger is unexpected.

### 2. Fence application writers for the run

```powershell
npm run migration -- gate --target supabase --target-env MIGRATION_SOURCE_DB --state fenced --run-id <run-id> --reason "final migration freeze" --actor <operator> --json
```

Immediately verify authenticated browser/mobile business mutations are refused
while reads remain available. On a build containing the cron hardening, an
authenticated manual GET and POST to `/api/v1/cron/cleanup` must return
`503 WRITERS_FENCED` without cleanup. Production 1.0.3 does not provide that
route-level proof, so its cron must be denied by the platform control in step 4.

### 3. Activate and verify the Supabase table-DML fence

The migration CLI defaults the Supabase provider fence to `anon` and
`authenticated`. It records exact grants before revocation and binds the
artifact to this durable fence generation.

```powershell
npm run migration -- fence --target supabase --target-env MIGRATION_SOURCE_DB --action activate --run-id <run-id> --reason "final migration freeze" --actor <operator> --out <protected-fence-artifact> --json
npm run migration -- fence --target supabase --target-env MIGRATION_SOURCE_DB --action verify --json
```

Keep the fence artifact. This control removes table DML from the ordinary
Supabase roles but does not stop Supabase Auth/admin, `service_role`, PostgreSQL
owners, external jobs, or already-running privileged code.

### 4. Deny HTTP writers and scheduled/manual cron invocation

2026-10-04 read-only CLI discovery identifies Vercel project pause/unpause as the
current ingress-freeze candidate. The linked project is `timesheet`
(`prj_WxsrNA1HHB3gDNuYsTi87uuW9hWl`). Generate-only inspection confirms these are
bodyless POST endpoints; neither was executed:

```powershell
# Rehearsal only: use a separately verified disposable Vercel project.
vercel api /v1/projects/<verified-rehearsal-project-id>/pause --scope <rehearsal-scope> -X POST

# Rehearsal rollback/resume.
vercel api /v1/projects/<verified-rehearsal-project-id>/unpause --scope <rehearsal-scope> -X POST
```

Before either rehearsal command, resolve the candidate project id and abort if it
equals production project `prj_WxsrNA1HHB3gDNuYsTi87uuW9hWl`. Because both known
aliases share that production project, there is no safe in-place "preview-only"
pause rehearsal on the current project. Use a separate disposable Vercel project
or leave this control BLOCKED. The production project id is recorded only as an
exclusion/identity check until C09 receives explicit production authorization.

Vercel currently reports no configured project firewall. Its cron CLI confirms
the production cleanup schedule but exposes add/list/run rather than disable.
Therefore project pause is not accepted as the complete cron control until a
non-production rehearsal proves scheduled and manual cron requests cannot reach
the function while paused and proves every old deployment URL is denied.

Use the rehearsed Vercel ingress control for the production hostname and every
still-routable production deployment URL. Record the provider control id/scope,
activation time and exact rollback action. At minimum it must deny:

- `/api/v1/cron/cleanup` for scheduled and manual requests;
- unauthenticated session/identity mutators such as login, signup and refresh;
- authenticated mutation routes and Server Action mutation entry points;
- any older deployment URL that can still reach the source with write-capable
  credentials.

The two known aliases share one Vercel project. Project pause is intentionally
project-wide, so the rehearsal must establish its effect on both aliases, old
deployment URLs and cron execution. Keep the durable app gate and Supabase DML
fence as independent controls; Vercel pause is an ingress control, not the data
authority itself.

### 5. Stop provider-privileged identity and database writers

The table-DML fence cannot stop Supabase Auth/admin or privileged service roles.
Before the final snapshot, record and execute the rehearsed controls for:

- Supabase Auth/admin identity creation, password/recovery changes and session
  administration;
- the deployed application's `service_role` paths, including registration/profile
  creation/cleanup, mobile-session and idempotency persistence, admin reset/import/
  restore/account operations, and scheduled maintenance;
- every `service_role` or PostgreSQL/admin client capable of application-table
  writes;
- external scripts, integrations and operator tools using those credentials.

The stop record must name the owner/credential identifier without including the
secret itself. Supabase's Auth configuration can disable new signups, but that
does not stop existing-user sign-in or already-issued session refresh, and the
installed CLI exposes no project/Auth freeze subcommand. Supabase's Management
API/MCP does expose project pause, but current Supabase documentation limits
manual project pause to Free projects; the selected source's plan eligibility is
not exposed by the current CLI metadata. Rehearse pause/resume only on a
disposable Free project. Do not transfer or downgrade the production source just
to obtain pause capability. Database network restrictions are also insufficient
for this purpose because Supabase documents that they do not apply to HTTPS APIs
such as PostgREST, Storage, or Auth. Do not treat signup disable or DB network
restrictions as the migration Auth/API freeze. If any privileged writer cannot
be disabled or independently proved idle, the freeze is BLOCKED.

### 6. Stop external jobs and drain existing work

Stop every recorded external scheduler/integration, then wait for the declared
`drain_observation_seconds`. During that interval verify there are no known
active/in-flight application writers, no write transaction attributable to the
listed writer identities, and no new durable mutations. Capture two bounded
observations around the interval; retain counts/identifiers, not query bodies or
credentials.

### 7. Run denial probes before the final snapshot

The evidence packet must cover each applicable surface: browser mutation,
Server Action mutation, mobile mutation, mobile login/signup/refresh, provider
Auth/admin mutation, cron GET and POST/manual invocation, direct PostgREST as
ordinary roles, privileged/service-role writer, direct SQL writer, production
custom hostname and old deployment URLs. Each probe records timestamp, expected
denial, actual status/error class and whether any durable state changed.

Do not take the final migration snapshot unless every identified writer has a
passing denial/idle proof and the drain criterion passes.

## Evidence record

For each rehearsal/final freeze record: release/version, commit, source project
reference, run id, fence generation, provider-fence artifact digest/path, Vercel
control/rule ids, writer-owner identifiers, start/end timestamps, drain interval,
active-connection/write-transaction summaries, denial-probe results and the
final no-writer decision. Never record tokens, passwords, connection strings or
environment-variable values.

## Release and recovery ordering

Normal publication keeps the source fenced. On the destination, complete apply
and verification, persist publication intent, then use `publish --phase admit`
to atomically record the writable receipt and open that run's durable gate.
Provider-fence release must use its recorded artifact and only the CLI's normal
publication-success authorization. Restore destination ingress/identity writers
only after it is the sole writable authority.

For a pre-publication abort, keep both sides fenced until the exact pre-merge
baseline is restored and verified. Only then use the explicit recovery path for
the matching gate generation and provider-fence artifact. Do not use ordinary
`gate --state open`; normal admission is intentionally rejected outside publish.

After publication intent or any possible retained destination write, do not
simply reopen the old source. Freeze the current merged authority and use the
rehearsed full reverse migration into `timesheet-test`, preserving destination-
original data and later changes.

## Remaining blockers before C08 can claim the lifecycle proof

The runbook is structurally complete, but these deployment facts remain open:
non-production proof that Vercel project pause denies both ingress and
scheduled/manual cron execution (including
old deployment URLs) using a separate disposable Vercel project; Supabase source
plan eligibility and Auth/admin freeze mechanism; complete
`service_role`/PostgreSQL writer ownership; external integration inventory; the
declared drain observation interval; and the real client/session matrix. C08
also still requires the operator ceilings for `window_minutes`, `peak_rss_mb`,
`peak_disk_gb`, and `max_row_bytes`.

Provider references used for these constraints:

- Vercel sensitive variables are non-readable once created:
  https://vercel.com/docs/environment-variables/sensitive-environment-variables
- Supabase manual project pause is currently limited to Free projects:
  https://supabase.com/docs/guides/platform/free-project-pausing
- Supabase DB network restrictions do not cover HTTPS APIs such as PostgREST,
  Storage, or Auth:
  https://supabase.com/docs/guides/platform/network-restrictions
