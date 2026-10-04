# C00 Vercel deployment inventory — 2026-10-03

> Archived 2026-10-04 as supporting reference. Recorded evidence, contracts and
> unverified limitations retain their scope; this move marks no pending check complete.
> Current work follows the [active plans](../../README.md#active).

Status: **DEPLOYMENT/RELEASE INVENTORY VERIFIED; PROVIDER-WIDE FENCE/SESSION CONTROLS OPEN.**

The operator supplied the production and development URLs and confirmed CLI
configuration. Read-only Vercel API calls used that CLI session; credentials,
environment values, raw API responses and fetched page/script bodies were not
printed or retained. No deployment, project setting, scheduler, data or fence
was changed. The Git-ignored .env.local was not edited.

## Observed deployments

| Application | Declared and verified branch | Public release | Backend | Deployed commit |
| --- | --- | --- | --- | --- |
| [Production](https://ts.kst.st/) | main | 1.0.3 | supabase | 0cf125a249c3e00feac55337b43e7d72fbc8e95b |
| [Development](https://ts-dev.kst.st/) | arch/architecture-simplification | 1.1.2 | supabase | 98f8a4f86b20846ffe5bb74cf5a9dc854d0ce1c9 |

Both aliases resolve to READY deployments of the same Vercel project. Production
is marked production; development is not marked production. Each public
/api/v1/config request returned HTTP 200, API version 1 and enabled mobile API,
bearer authentication and durable idempotency capabilities. These are advertised
capabilities, not login, write denial or session-remapping test results.

Git inspection at each exact deployed commit found matching package and
lib/version.ts releases. The development deployment is the current local HEAD,
but local uncommitted files now declare 1.1.6; those changes are not in that
deployment. The migration operator accepts 1.0.3, matching the verified production
source release. Its policy is not automatically wrong because the dirty checkout
has a newer version. The two supplied apps have different releases and both use
Supabase; neither establishes a native destination app or same-release parity.
No portable bundle was exported or release admission broadened.

## Configuration binding and native enrollment limits

Vercel metadata has one shared sensitive NEXT_PUBLIC_SUPABASE_URL entry covering
production and preview, with no architecture-branch override. Its value was
unavailable for identity comparison through the selected variable API. A later
read-only check confirmed this is a platform property rather than a missing API
flag: Vercel documents sensitive environment variables as non-readable once
created. The per-variable GET returned no value, and `vercel env pull` emitted a
short Vercel reference instead of the underlying URL. A repo-root `vercel env run`
probe initially reported a source-project match, but Vercel also reported that
production secret values could not be pulled and that it loaded the repository's
local `.env.local`; that result is therefore local configuration evidence only.
A second `env run` from a new empty directory with project `timesheet` selected
explicitly removed that fallback: Vercel reported the secret values could not be
pulled and `NEXT_PUBLIC_SUPABASE_URL` was absent. The temporary probe artifacts
were removed and no environment value was printed. Eight public scripts per app were also inspected
in memory; neither exposed a usable Supabase project URL. Therefore tooling alone
left the running apps' binding to the selected source database **UNVERIFIED**, and
another config-value read could not close it. Shared configuration scope suggested
a shared binding, but was not proof of the values embedded in earlier deployments;
the operator confirmation below supplies the missing deployment identity evidence.

2026-10-04 operator confirmation closes this specific identity gap: the
production app at `ts.kst.st` is intended to use Supabase project
`bcsdqkjzobllocejfcdz`. Treat this as operator-supplied deployment-binding
evidence, not as a recovered Vercel secret value. The sensitive-variable probes
above remain useful evidence that the value itself is intentionally unavailable
through the tested Vercel config/CLI surfaces.

The selected Vercel project has no DATABASE_URL, SMTP_HOST, SMTP_FROM or APP_BASE_URL
entries scoped to production or this preview branch. That is project metadata,
not proof about another native deployment. Local MIGRATION_SOURCE_APP_URL and
MIGRATION_TARGET_APP_URL remain absent; the operator-provided public URLs are
recorded here rather than silently assigned destination roles or written to .env.
Docker native remains the primary database destination. A native application
deployment against it still needs final release/deployment admission evidence,
with an explicit native connection separate from the hosted recovery
MIGRATION_DESTINATION_DB. Later C07 local evidence now proves a 1.0.3 native
compatibility harness can bind to `vsis_migration_destination_20261003`, report
backend native, serve health/config, deny a fenced authenticated mutation while
reads continue, and reopen cleanly. That closes the local app/database-binding
unknown but does not by itself create or admit the production destination app.

## Writer evidence and control prerequisites

Vercel cron listing confirms **enabled=true** with one configured job:
/api/v1/cron/cleanup, schedule 0 0 * * *. Production deployment metadata and
project definitions agree. Vercel schedules cron invocations for production,
not preview deployments; development's copied cron definition alone does not
prove a separately active Vercel schedule.
[Provider scheduling rules](https://vercel.com/docs/cron-jobs/quickstart).

At both exact deployed commits, the shared action guards and browser/mobile HTTP
guards reference writeGateResponse; requireMutatingActiveActor is declared.
The deployed cron route instead references runScheduledMaintenance without a
direct fence reference. This is source-level mechanism evidence, not complete
coverage or live denial proof. Its route file hashes match between deployments.
Prior source tracing records maintenance writers outside ordinary actor guards.

Record the production cron stop/deny control and active-invocation drain proof
before freezing. Include manual cron requests, production/preview app invocations,
older deployment URLs, Supabase Auth/admin/PostgREST, privileged SQL, external
jobs and established connections. A project-level stop may affect both aliases;
review the shared project boundary before applying any control. No live refusal
probe or stop operation was run in this inventory.

### 2026-10-04 provider-control continuation

Read-only Vercel CLI 59.23.2 inspection confirms the same single cleanup cron
and reports no configured project firewall. The authenticated API catalog exposes
reversible bodyless POST controls for project `timesheet`
(`prj_WxsrNA1HHB3gDNuYsTi87uuW9hWl`):
`/v1/projects/{projectId}/pause` and `/unpause`. Generate-only request inspection
confirmed the endpoint shape; neither control was executed. The cron CLI exposes
add/list/run, not disable. Therefore project pause is the current ingress-freeze
candidate, but C06B/C08 must first prove on a non-production target that it blocks
scheduled and manual cron execution and all still-routable deployment URLs.
Because the development and production aliases share this same project, that
rehearsal must use a separate disposable Vercel project. The production project
id is an exclusion check, not a rehearsal target.

Installed Supabase CLI 2.117.0 exposes project list/create/api-keys/delete and no
project/Auth freeze subcommand. Official Supabase documentation nevertheless
shows project pause in the Management API/MCP permission surface, while manual
pause is currently limited to Free projects. Source project metadata reports
ACTIVE_HEALTHY but does not expose its billing plan, so pause eligibility remains
unknown. Supabase Auth configuration can disable new signups, but that does not
quiesce existing-user sign-in or already-issued session refresh. Database network
restrictions cover Postgres/pooler connections and explicitly exclude HTTPS APIs
such as PostgREST, Storage and Auth. The provider Auth/admin/session freeze
mechanism therefore remains an explicit blocker.

## Next gates

1. Production `ts.kst.st` → `bcsdqkjzobllocejfcdz` is operator-confirmed. If the
   deployed project, domain, or production environment changes, re-establish that
   binding rather than inferring it from branch/hostname or Vercel secret scope.
2. Convert the proven local 1.0.3 native app/database binding into the exact
   admitted destination deployment/release evidence and complete the remaining
   real client/session matrix before portable export/cutover admission.
3. Supply/prove native enrollment and complete writer stop/drain, client/session,
   retention and full account/platform recovery evidence.
4. Run the remaining deployment-specific C07 checks, then measured C08 only
   after its prerequisites pass. Production C09/C10 authorization is unchanged.

- [Safe deployment, configuration and source audit evidence](../evidence/c00-vercel-deployments-2026-10-03.json)
- [Writer-control inventory](C00_WRITER_CONTROL_INVENTORY.md)
- [Scoped recovery test and remaining limits](C00_SUPABASE_SOURCE_RESTORE.md)
- [CLI authenticated read interface](https://vercel.com/docs/cli/api)
- [Cron listing interface](https://vercel.com/docs/cli/crons)
- [Vercel sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
- [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase network-restriction limits](https://supabase.com/docs/guides/platform/network-restrictions)
