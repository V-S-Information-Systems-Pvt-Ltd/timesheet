# Phase 3 transport contract matrix

Status: Phase 3 implementation is complete in the working tree. Browser data/authentication, all dashboard action consumers, raw application fetches, administration, import/export and backup callers use `/api/v1` through the browser facades. Static boundary coverage rejects new browser imports of Server Actions or legacy `/api/data` and `/api/auth` URLs, and prevents v1/shared browser endpoints from depending on legacy route or action modules. Legacy server aliases and Server Actions remain callable only as rollout rollback paths; deleting them requires post-deployment consumer evidence rather than a source-only assumption.

## Policy codes

- `SI`: signed-in session; inactive accounts are allowed only where stated.
- `A`: active actor.
- `ADM`: active administrator.
- `PM`: active admin or project manager.
- `SA`: configured superadmin.
- `OC`: same-origin validation for unsafe cookie requests.
- `WG`: fail-closed deployment write fence.
- `B`: bearer mobile session.

## Browser data transports

| Operation | Caller | Current contract | Policy | Proposed v1 replacement | Acceptance check |
| --- | --- | --- | --- | --- | --- |
| Projects read ✅ | `lib/data/client.ts:getProjects` | `GET /api/data/projects`; `{data}` | A cookie | `GET /api/v1/reference` plus DTO adapter | Active success; inactive/anonymous rejection; fields match. |
| People read ✅ | `getAllUsers` | `GET /api/data/profiles`; `{data}` | A cookie | `GET /api/v1/people` plus actor-to-user adapter | `isActive`, permission role, hierarchy role, manager, department, layouts and creation time map on both backends. |
| Own profile read ✅ | `getProfile` | `GET /api/data/profile`; `{data}` | SI cookie; inactive allowed | `GET /api/v1/profile` | Inactive signed-in user succeeds; anonymous user is rejected. |
| Backfill read ✅ | `getBackfillWindow` | `GET /api/data/backfill-window` | A cookie | `GET /api/v1/settings/backfill` | Ordinary active user can read; admin-only write remains protected. |
| Activity types ✅ | `getActivityTypes`, `getAllActivityTypes` | `GET /api/data/activity-types`, optional `all=1` | A cookie | v1 reference read with explicit active/all mode | Active-only and all variants remain distinct. |
| Leaves read/write/delete ✅ | `getLeaves`, `insertLeaves`, `deleteLeave` | `/api/data/leaves`; filters `userId/from/to`; writes return legacy field errors | A; writes OC+WG | `/api/v1/leaves` and `/api/v1/leaves/:id` | Filters and browser response mapping preserved; v1 validation retains field errors; cookie writes use origin + fence gates; focused route/domain/client/auth tests pass. |
| Reminders CRUD ✅ | `getReminders`, `insertReminder`, `updateReminder`, `deleteReminder` | `/api/data/reminders`; POST validates message/date | A; writes OC+WG | `/api/v1/reminders` and `/api/v1/reminders/:id` | Actor scoping is unchanged, browser writes use origin + fence gates, v1 validation retains field errors, and focused route/domain/client/auth tests pass. |
| Global reminders ✅ | `getDueGlobalReminders`, `getGlobalReminders` | `/api/data/global-reminders`; default due-only, `all=1` all | A cookie | `/api/v1/reminders/global` | Default due-visible and `all=1` modes are preserved through the same domain/persistence authorization paths; focused route/client/auth tests pass. |
| Report totals ✅ | `getReportTotals`, raw report fetch | `GET /api/data/reports`; project/date/group filters; grouped totals | A cookie | `GET /api/v1/reports` plus adapter | Cookie/browser requests preserve legacy `groupBy=user` default while bearer/mobile keeps `project`; explicit filters, date validation, totals and structured-error handling are covered by focused tests. |
| Report exports ✅ | Five raw report export links | `GET /api/data/reports/export`; streamed CSV | A cookie | Shared client → `/api/v1/reports/export` | Cookie/browser exports preserve legacy streamed-download semantics, including empty CSV responses and headers; bearer/mobile keeps preflight + `204`; focused export/auth tests pass. |
| Backup restore ✅ | `backup-panel.tsx` raw fetch | `POST /api/data/backup/restore`; 20 MB limit; atomic restore | ADM+OC+WG | `POST /api/v1/admin/backup/restore` | Browser response shape, 20 MB bounds, admin policy and audit reporting are preserved; the same atomic restore domain path is used and cookie origin/fence checks come from the shared v1 guard. |
| Legacy timesheet read ✅ retired | Browser already uses v1; k6 caller repointed | `GET /api/data/timesheets` | A cookie | Removed after zero-caller and v1 regression checks | v1 regression coverage now explicitly includes `from/to/limit/userId/dateFrom/dateTo`; legacy route/test removed. |

## Browser authentication and recovery

| Operation | Caller | Current contract | Rate-limit/lifecycle contract | Proposed replacement | Acceptance check |
| --- | --- | --- | --- | --- | --- |
| Native login ✅ | `authClient.signIn` | `POST /api/auth/login`; sets session cookie | Failed credentials consume daily login; server faults refund; 429 has `Retry-After` | `/api/v1/auth/browser/login` | Shared legacy/v1 handler preserves cookie creation, failure/refund semantics and `Retry-After`; browser login stays available when mobile bearer auth is disabled. |
| Native logout ✅ | `authClient.signOut` | `POST /api/auth/logout`; clears cookie | Cookie lifecycle only | `/api/v1/auth/browser/logout` | Shared legacy/v1 handler clears the cookie; foreign-origin writes are rejected. |
| Native session ✅ | `nativeGetSession` | `GET /api/auth/me`; signed-in result may be inactive | Session cookie | `/api/v1/auth/browser/me` | Shared legacy/v1 handler keeps signed-in-only semantics, including readable inactive sessions and null anonymous/revoked sessions. |
| Signup ✅ | `serverSignUp` | `POST /api/auth/signup`; `{success,isActive,message}` | Every attempt consumes per-IP signup budget; domain/account/config outcomes map to 400/403/404/409/503 | `/api/v1/auth/browser/signup` | Both browser backends use the server registration port; error mappings, origin gate and rate budget are preserved independently of the mobile feature flag. |
| Domain check ✅ | Signup flow | `GET /api/auth/domain-check`; unauthenticated | Every probe counts under domain-check budget; 429 + `Retry-After` | `/api/v1/auth/browser/domain-check` | Valid, invalid, denied and rate-limited probes use the shared legacy/v1 handler. |
| Forgot password ✅ | Native recovery | `POST /api/auth/forgot-password`; intentionally non-enumerating | Every request counts by email fingerprint+IP; limited response remains generic 200 | `/api/v1/auth/browser/forgot-password` | Shared handler preserves no-store, minimum response timing, generic unknown/limited responses and token non-disclosure. |
| Reset password ✅ | Native recovery | `POST /api/auth/reset-password`; clears cookie on success | Invalid token consumes; weak password refunds; success releases | `/api/v1/auth/browser/reset-password` | Shared handler preserves token/password validation, cookie clearing and completion-budget behavior. |
| Change password ✅ | Native client | `POST /api/auth/change-password`; native-only | Failed current password consumes; success releases and rotates session version | `/api/v1/auth/browser/change-password` | Shared handler preserves signed-in-only access, old-password validation, revoked-session handling, session-cookie rotation and budget semantics. |
| Mobile-session revocation ✅ | Supabase password flows | `POST /api/auth/revoke-mobile-sessions`; begin/complete phases | Completion is explicit and no-store | `/api/v1/auth/browser/revoke-mobile-sessions` | Shared handler preserves same-origin/signed-in gates and the begin/complete guarded revocation flow; Supabase browser callers now use v1. |
| Supabase provider auth/recovery ✅ retained | Supabase auth client | Direct SDK login/logout/recovery/password operations | Provider session and recovery event/sessionStorage state | Retain provider operations; move only application-owned revocation transport to v1 | Direct provider callback/session semantics remain unchanged; login, logout, recovery readiness, password reset/change and v1 revocation regression tests pass. |

## Server Actions

All mutation replacements require same-origin validation and the write fence. Existing action result shapes remain compatibility requirements until callers move.

| Action group | Live callers | Current policy | Proposed v1 replacement | Acceptance check |
| --- | --- | --- | --- | --- |
| `logEntry`, `logYesterday`, `updateTimesheet`, `deleteTimesheet`, `deleteLastEntry`, `duplicateEntry` ✅ | Time entry form, entries table, backfill form now call `dataClient` | A + OC + WG; resource/date/backfill checks | Versioned create/update/delete/duplicate plus `/yesterday` and `/last` | Field errors, ownership/date-window/budget and empty cases covered. Yesterday/date and latest target resolve server-side. Separate browser submissions are not coalesced or given invented retry keys; existing mobile idempotency remains unchanged. |
| `bulkUpdateTimesheets` ✅ | Bulk edit modal now calls `dataClient` | A + OC + WG; 1–500 rows; one budget charge; per-row outcomes | `POST /api/v1/timesheets/batch-update` | Focused route/domain/client/guard tests cover mixed success, all-fail wording/details, max size, one charge, refund, and independent submissions; old action remains rollback. |
| Project mutations ✅ | Project manager now calls `dataClient` | PM + OC + WG | Cookie-enabled `/api/v1/admin/projects` and `/:id` | Admin/PM and independent role axes, active/origin/fence gates, name-only create, normalized rename/S.O./Telegram clears, validation/duplicate/dependency errors, encoded IDs, separate writes and no post-write read-back covered. Existing refresh callback and bearer DTO behavior remain; old actions stay rollback. |
| User mutations ✅ | Add-user form, whitelist/user panel and hierarchy editor now call `dataClient` | ADM + OC + WG; role axes remain independent | Cookie-enabled admin user routes; explicit narrow-operation PATCH | Canonical create/operation schemas preserve the original domain calls, status toggle/server state, role and self-edit guards, hierarchy/title/cycle rules, clear values, audit events and no read-back. Active/admin/origin/fence/bearer non-fallback and mobile DTO regressions pass. Title reads and delete-user-timesheets remain in their separate later slices; old user actions stay rollback. |
| `updateMyProfile` ✅ | My-profile panel now calls `dataClient` | A + WG; self-only fields | Cookie-enabled `PATCH /api/v1/profile` | Strict department/title input preserves trimming, clears and hierarchy-title validation. GET still permits signed-in inactive reads while PATCH requires an active actor, origin and an open fence. Writes acknowledge without read-back/coalescing/retry; mobile `/api/v1/auth/me` and the old action remain unchanged. |
| Activity type mutations ✅ | Activity types panel now calls `dataClient` | ADM + WG; destructive delete SA | Cookie-enabled admin activity-type routes | Strict create/discriminated mutation inputs use narrow writes without read-back. Delete keeps bearer ADM behavior but requires SA for cookie/browser calls and retains `activity_type.delete` audit. |
| Global reminder mutations ✅ | Global reminder panel now calls `dataClient` | Create/delete ADM; dismiss A; writes WG | Cookie-enabled admin/global-dismiss routes | Browser create acknowledges without depending on a returned row; delete and repeat dismiss preserve resource behavior; role/origin/fence tests pass. |
| Backfill/layout settings ✅ | Settings panel and dashboard now call `dataClient` | ADM or A + WG depending operation | `/api/v1/admin/settings/backfill`, `/api/v1/layout/web`, `/api/v1/capabilities` | Ordinary-user default/backfill reads, admin/superadmin writes, separate dashboard/admin layout ownership and no-read-back writes are covered. |
| Branding ✅ | Super-admin panel now calls `dataClient` | Read A; write SA + WG; layout revalidation | Cookie-enabled admin branding route plus `router.refresh()` | Active users can read branding, only SA can write/reset, route invalidates the root layout, and the current dashboard refreshes after change. |
| Superadmin lifecycle ✅ | Superadmin panel now calls `dataClient` | SA + WG | Reset, permanent-user-delete, whitelist, title and activity-delete resources | Strict modes/inputs, self-delete guard, superadmin-only browser activity deletion, dependency/provider errors and legacy best-effort audit events are preserved. |
| Import/export/restore ✅ | Import, backup and user panels now call `dataClient` | Import ADM+WG with reservation/refund; export ADM read; restore/delete ADM+WG | `/api/v1/admin/timesheets/import`, `/api/v1/admin/backup{,/restore}`, `/api/v1/admin/users/:id/timesheets` | Max 2000, CSV mapping, 24h cap, partial results, exception/failure reservation release, unfenced export read, atomic restore and separate user-timesheet deletion are covered. |

## Confirmed dead candidates

- `restoreBackup` Server Action: no live caller; live restore uses `/api/v1/admin/backup/restore`. It remains only in the rollback facade pending rollout evidence.
- `getTitleRecords`, `getTitleImpact`, `reclassifyTitle`: route/client ownership is explicit; no current UI invokes impact/reclassification, while the contracts remain available for administration and rollback compatibility.
- `/api/data/timesheets`: retired after the remaining k6 caller moved to v1 and full read-filter coverage was added to the v1 route tests.
- All remaining `app/api/data/*`, `app/api/auth/*`, and `app/actions*` units have zero production browser callers in the repository. They are retained as server-side rollout aliases until deployed-consumer inventory confirms removal is safe.

## Cross-cutting acceptance invariants

1. An explicit `Authorization` header always selects bearer processing; invalid bearer credentials never fall back to a cookie.
2. Cookie admission is opt-in and independent of the mobile bearer feature flag.
3. Unsafe cookie writes validate origin before resolving actor or touching data.
4. Signed-in-only, active-account, role and resource checks remain distinct.
5. Fence reads fail closed and preserve the existing retry response.
6. Batch budgets, reservation refunds, idempotency, uncertain commits and partial-result shapes are contract requirements.
7. Old routes/actions remain until replacement tests pass and live callers are zero.
8. Source caller-zero does not prove deployed caller-zero; rollback aliases are removed only after deployment observation/authorization.

## Closure evidence

- Full application coverage: 141 files and 1,601 tests passed; 13 environment-gated files/60 tests skipped.
- Coverage gates passed: 72.17% statements, 63.59% branches, 79.09% functions and 75.72% lines.
- Lint, TypeScript, the explicit cookie-route inventory, retirement-boundary regressions, and CI-equivalent Supabase/native production builds passed.
- Live database/provider-auth, Docker and Playwright checks were not rerun for the final transport-only closure; the completed Phase 1/2 database evidence is unaffected.
