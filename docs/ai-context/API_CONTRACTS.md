# API Contracts

## Server Actions

`app/actions.ts` is a compatibility/rollback re-export surface. Implementations live under `app/actions/`; production browser modules no longer import it and boundary tests prevent regression. Preserve existing names/signatures while the rollback window remains. Client-facing failures follow the established `{ error }` shape.

## Web REST

- Browser authentication endpoints: `/api/v1/auth/browser/*`; legacy
  `app/api/auth/` routes forward to the same handlers during rollback.
  Supabase provider session/recovery operations remain direct SDK calls.
- Current browser timesheet reads and individual mutations: `/api/v1/timesheets`
  (including `/yesterday`, `/last`, and `/:id/duplicate`) through
  `lib/data/client.ts` with same-origin cookie credentials.
- Bulk timesheet editing uses `POST /api/v1/timesheets/batch-update` with
  `{ entries }` bounded to 1–500 rows. The domain charges once per batch and
  returns `{ updated, errors? }`; the browser maps zero successful edits with
  row failures to `All edits failed.`. Direct browser writes are not coalesced
  or automatically retried; existing mobile keyed-write behavior is unchanged.
- Project-manager writes use cookie-enabled `/api/v1/admin/projects` and
  `/:id` resources. Cookie create accepts the action's name-only input; cookie
  PATCH acknowledges field writes with `{ success: true }` without a read-back.
  Existing `onChanged` refresh remains separate. Bearer create/PATCH keep their
  project DTOs and existing optional-field/read-back behavior. Both credential
  paths enforce active admin/PM permission roles; ordinary hierarchy/legacy
  roles do not grant project-management access. Blank S.O. and null Telegram
  clear values, with normalization and positive-integer checks in the domain.
- User-administration forms use cookie-enabled `/api/v1/admin/users` and `/:id`.
  Shared schemas in `packages/contracts/src/browser-users.ts` define strict
  cookie create input and discriminated PATCH operations (`toggle-status`,
  `roles`, `name`, `department`, `manager`, `hierarchy`). The browser service
  dispatches to the existing narrow action-domain operations and returns a
  write acknowledgement without adding a read-back. Status toggles resolve
  current server state; role axes, self-edit/cycle/title checks and original
  audit events remain unchanged. Bearer create/PATCH retain their defaults,
  generic atomic updater and user DTO responses. Old user actions remain
  rollback; title reads and user-timesheet deletion are not retired here.
- The browser my-profile form writes strict `{ department, title }` input to
  cookie-enabled `PATCH /api/v1/profile`. It preserves self-only scope,
  trimming/clear values and hierarchy-title validation, then acknowledges the
  write without a read-back. `GET /api/v1/profile` retains signed-in inactive
  read access, while PATCH requires an active actor plus origin and write-fence
  checks. Mobile `/api/v1/auth/me` keeps its partial-input/actor-DTO contract;
  the old `updateMyProfile` action remains a rollback path.
- Superadmin browser operations use versioned reset, permanent-user-delete,
  whitelist, title and activity-type resources. Browser activity deletion is
  superadmin-only even though the existing bearer/mobile operation remains admin-capable;
  the legacy audit actions are preserved.
- CSV import uses `POST /api/v1/admin/timesheets/import`; it owns one daily-import
  reservation, releases it for rejected/failed/exceptional attempts, resolves references,
  enforces the 24-hour cap and returns partial counts/issues. Backup export/restore use
  `/api/v1/admin/backup` and `/api/v1/admin/backup/restore`. User-timesheet deletion is
  separate at `DELETE /api/v1/admin/users/:id/timesheets`.
- Compatibility data endpoints under `app/api/data/` have no production browser callers
  and remain only as deployment rollback aliases pending deployed-consumer evidence.
- Shared guards: `app/api/_http.ts`.

State-changing data cookie requests preserve origin/CSRF checks, active-account
authorization and the write fence. Browser-auth operations preserve their
distinct signed-in/session/recovery policies. Cookie admission and explicit
browser-auth lifecycles remain available independently of the mobile bearer
feature flag; an explicit bearer credential never falls back to cookies.

## Mobile REST

The versioned contract is under `/api/v1`. Routes should remain thin: authenticate/parse, call service/domain logic, map to the established success/error envelope. The server DTO/schema boundary and `mobile/src/api/contracts.ts` must evolve together.

Canonical timesheet schemas, input types, and response DTOs live in
`packages/contracts/src/timesheets.ts` and are exported from its package index.
`lib/api/v1/contracts.ts` maps server-side `Timesheet` rows to the flat
`TimesheetEntry` wire DTO; it does not define a competing contract. The typed
HTTP operations in `packages/client` and browser/mobile consumers must preserve
that released shape.

Protected mobile routes are bearer-authenticated by default. Cookie authentication is an explicit per-route opt-in in `requireMobileActor`/`withMobileActor` behavior.

## Persistence contracts

Narrow ports under `lib/domain/*-port.ts` are application APIs. Shared actor,
input, and result types live in `lib/db/types.ts`. Reads return data or throw
according to established port semantics; writes use `DbWrite`
(`{ error: string | null }`) and related result types. New persistence behavior
belongs in the owning port and both provider adapters rather than in direct
page/route database access.

## Compatibility checklist

When changing a contract, trace callers and consumers with Serena first, then check: browser client, mobile client, native adapter, Supabase adapter, authorization behavior, migrations/RLS, and matching tests.

Evidence: `app/actions.ts`, `app/actions/`, `app/api/_http.ts`, `app/api/v1/_http.ts`, `lib/db/types.ts`, `lib/domain/`, `lib/data/client.ts`, `mobile/src/api/contracts.ts`.
