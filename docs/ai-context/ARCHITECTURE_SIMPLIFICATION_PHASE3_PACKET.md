# Architecture decision packet: Phase 3 browser transport boundary

## Decision required

How should `/api/v1` admit browser cookies and share HTTP guard primitives while preserving bearer behavior, browser session/recovery lifecycles, authorization distinctions, write fencing and rollback?

## Why this is needed

The application currently has `/api/auth`, `/api/data`, Server Actions and `/api/v1`. The versioned helper already supports opt-in cookie admission, while the compatibility helper separately owns origin checks, response helpers and fence refusal. Caller migration before the contract inventory is complete risks credential fallback, CSRF regression, inactive-account policy drift and response-shape changes.

Non-goals for this first slice: migrating callers, deleting old routes/actions, changing rate limits, changing DTOs, or changing mobile bearer contracts.

## Current architecture

- `app/api/_http.ts` owns compatibility JSON/error helpers, same-origin checks, signed-in/active actor helpers and fail-closed fence refusal.
- `app/api/v1/_http.ts` owns v1 envelopes, request IDs, bearer/cookie actor wrappers and its own safe-method/fence orchestration.
- Cookie admission is route opt-in. An explicit `Authorization` header is processed as bearer and must not fall back to a cookie.
- Cookie unsafe requests run origin validation before actor resolution. Inactive actors are allowed only when a route explicitly requests it.
- Native password changes rotate the session version/cookie. Supabase password changes and recovery use provider operations wrapped by mobile-session revocation begin/complete phases.

## Constraints

- Preserve bearer public contracts and explicit bearer-first credential selection.
- Preserve origin checks before cookie-authenticated unsafe work.
- Keep browser availability independent of the mobile bearer feature flag.
- Preserve signed-in versus active-account and role/resource authorization policies.
- Keep the write fence fail-closed; unreadable fence state must refuse writes.
- Preserve native session rotation and Supabase recovery sequencing.
- Keep old transports as rollback paths until each matrix row is accepted.

## Evidence

- `app/api/_http.ts:originCheck` is method-aware and rejects missing or foreign origin/referer headers in production.
- `app/api/_http.ts:writeGateRefusalResponse` returns a fail-closed 503 with `Retry-After: 60` when the fence cannot be read.
- `app/api/v1/_http.ts:requireCookieActor` runs origin validation before `getActor` and has explicit inactive admission.
- `app/api/v1/_http.ts:applyFence` preserves v1 error envelopes and refuses unsafe requests when the fence is closed or unreadable.
- `lib/auth/client.ts` keeps native and Supabase browser lifecycles behind one facade but uses provider-specific recovery behavior.
- `PHASE3_TRANSPORT_CONTRACT_MATRIX.md` records every identified browser data/auth/action operation, callers, policies, replacements and acceptance checks.

### Evidence labels

- `FACT`: the two HTTP modules duplicate safe-method classification and basic response/fence orchestration, while their server-error envelopes differ.
- `FACT`: v1 cookie admission is opt-in and does not require the mobile bearer feature flag.
- `FACT`: self-profile/session reads allow signed-in inactive accounts, unlike most data operations.
- `INFERENCE`: shared neutral primitives with transport-specific orchestration minimize semantic drift and preserve incremental rollback.
- `UNKNOWN`: the complete production inventory of development/test mobile clients is still a later deployment-inventory item; this slice must not alter bearer behavior.

## Recommended option

Extract only neutral primitives such as safe-method classification, origin-check support and fence-state/refusal data. Keep legacy response shaping in `app/api/_http.ts`; keep v1 envelopes, request IDs, logging and actor wrappers in `app/api/v1/_http.ts`. Keep cookie admission explicit per route and preserve bearer-first selection.

This leaves two thin orchestration layers temporarily, but avoids coupling incompatible public envelopes and supports bounded caller migration with a rollback path.

## Rejected alternatives

### Universal wrapper

Replacing both modules with one universal wrapper would couple legacy and v1 response contracts, enlarge the review surface and make rollback harder.

### Automatic bearer-to-cookie fallback

This is rejected because an expired or malformed explicit bearer could silently authorize through an unrelated browser cookie. It violates the existing credential-selection invariant and obscures client failures.

## Lifecycle and concurrency checks

- Activation: a route opts into cookie admission; bearer-only routes remain unchanged.
- Cookie request: origin check for unsafe methods → actor resolution → route policy → fence → handler.
- Bearer request: explicit header → bearer validation/policy → fence → handler; cookie is ignored.
- Invalid bearer plus valid cookie: request fails as bearer; cookie is never attempted.
- Revoked/stale cookie: no actor and no fallback to another credential source.
- Concurrent writes during a fence read failure: all unsafe requests refuse closed, never open.
- Native password change: successful provider operation rotates the session version/cookie.
- Supabase password/recovery: preserve begin → provider write → complete revocation sequencing.
- Rollback: old endpoints/actions remain until replacement acceptance and zero-caller checks complete.

## Unresolved questions

- Browser auth now uses `/api/v1/auth/browser/*`, with shared legacy/v1 forwarding handlers; token-returning mobile endpoints are not overloaded.
- Complete the deployment/client inventory before changing or retiring any bearer contract.

## Requested review

Evaluate whether the recommended shared-neutral-primitives approach preserves the stated auth, CSRF, authorization, fence and rollback invariants for the first Phase 3 slice. Identify any missing acceptance case before implementation; do not redesign unrelated routes or domain services.

## Continuation decision: browser timesheet mutations

- Question: move individual and bulk-edit browser callers to versioned resources without changing their domain behavior or retry lifecycle.
- FACT: `app/actions/timesheets.ts:bulkUpdateTimesheets` bounds batches at 1–500 rows before charging; `lib/domain/timesheets.ts:bulkUpdateTimesheetsDomain` charges once, refunds when no rows update, and returns per-row errors. The modal consumes `updated`, `errors`, and the special `All edits failed.` message.
- Decision: add a bounded `/api/v1/timesheets/batch-update` contract and service over the existing domain operation. Validate transport structure and batch bounds before the domain call; leave row-value validation and partial results in the domain. Retain the old action as rollback.
- Activation/completion: unsafe cookie guard validates origin, active actor and write fence; the browser sends one direct request and adapts the versioned response to the modal's existing shape.
- Retries/concurrency: browser mutations have no durable queue or stable delivery key, so do not invent idempotency keys or coalesce concurrent submissions. Existing mobile keyed operations are unchanged. Yesterday is calculated server-side, and last-entry deletion resolves its target server-side; neither operation offers delayed replay semantics.
- Failure/recovery: malformed/empty/oversized batches fail before a budget charge; domain failures retain existing messages; mixed results remain visible; all-failed batches retain row details and refund semantics. Network uncertainty is surfaced, not automatically retried.
- Acceptance: shape and bounds, mixed/all-failed results, one budget charge/refund, active/origin/fence checks, explicit bearer non-fallback, flag-independent cookies, client mapping, no single-flight writes, both backend builds. Live database/E2E evidence is separate from unit/build checks.

## Continuation decision: browser project administration

- Question: move `ProjectManager`'s create/rename/S.O./Telegram/delete writes onto existing `/api/v1/admin/projects` resources without changing admin/PM policy or success/refresh semantics.
- FACT: `app/actions/projects.ts` calls reference-domain writes and acknowledges completion without a read-back. `lib/domain/reference.ts:updateProject` uses the same field operations but then lists projects to return the mobile DTO. `app/dashboard/page.tsx` supplies `fetchProjects` as the manager's existing `onChanged` refresh callback.
- Decision: keep bearer responses unchanged; opt the two project route files into cookies and use small browser acknowledgement adapters over the same reference domain. Extract the field-write portion of `updateProject` into a shared guarded operation; mobile retains its subsequent read-back and DTO. Browser create retains the action's name-only call; rename/S.O./Telegram return a write acknowledgement without adding a post-write query. Delete keeps the existing domain path.
- Alternatives: using mobile read-back for browser edits adds a new failure after a successful write; duplicating domain validation in HTTP routes risks drift; adding parallel browser-only URLs increases transport surface. Reject these in favor of explicit credential-specific response adapters on the existing resources.
- Activation/completion: cookie origin → active actor → fail-closed fence → domain admin/PM policy → provider write → acknowledgement → existing `onChanged` refresh. Permission role remains independent of hierarchy/legacy roles. Only the named project routes gain cookie admission.
- Failure/retries/concurrency: preserve trim/blank-to-null, positive integer Telegram validation, duplicate-name and referenced-project errors. Do not add budgets, transactions, coalescing or automatic retries. Each browser field edit is independent; multi-field bearer edits keep their existing ordered, potentially partial completion semantics. Refresh failure does not alter write acknowledgement. Stale/revoked sessions and closed/unreadable fences fail before writes. Old actions remain rollback.
- UNKNOWN: live provider/browser behavior is not proven by mocks/builds; report database/E2E skips separately. Production client inventory remains open and bearer retirement is out of scope.
- Acceptance: admin/PM success and ordinary/inactive denial; role-axis independence; all five browser client payloads and encoded IDs; normalization/clears and validation/resource errors; no post-write read-back; origin-before-identity, explicit bearer non-fallback, flag-independent cookie access, fence refusal; mobile DTO regressions; focused/full tests, lint/types and both builds.

## Continuation decision: browser user administration

- Question: migrate add-user, status toggle, role/name/department/manager and hierarchy callers while preserving the exact narrow-domain action semantics.
- FACT: `app/actions/users.ts` calls separate people operations. `updatePersonDomain` (mobile PATCH) additionally checks target/title/manager state, allows unchanged self-role patches, returns a read-back DTO, and uses different audit orchestration. `togglePersonStatusDomain` resolves the current server value rather than accepting the UI's stale status. A generic patch substitution would change behavior.
- Decision: opt existing `/api/v1/admin/users` route files into cookies. Cookie POST uses a strict shared create contract and the original create operation without mobile read-back. Cookie PATCH uses a strict discriminated `operation` contract (toggle-status, roles, name, department, manager, hierarchy), dispatching to the same narrow domain operations as the old actions. Bearer request parsing, defaults, atomic generic update and DTOs stay unchanged. Browser services reject inactive/non-admin actors as defense in depth; route guards preserve origin/fence/credential checks.
- Alternatives rejected: infer toggle status from the client; route browser edits through the generic mobile updater; duplicate action validation/audit rules in HTTP; introduce separate legacy-like URLs for each action. Shared contracts plus thin acknowledgement adapters keep behavior owned by the existing domains.
- Lifecycle: unsafe origin check → active actor → fence → strict operation parse → domain authorization/validation → existing provider write and best-effort audit → acknowledgement → existing form reset/onChanged refresh. Preserve role axes, title-derived hierarchy, manager-cycle/self guards, blank department/null manager, credential validation and missing-credential wording. No new post-write read-back.
- Retries/recovery/concurrency: separate submissions remain separate direct writes; do not coalesce or automatically retry status toggles or creates. Retain existing concurrency/provider behavior and best-effort audit failure handling. Stale actors and unreadable fences refuse before provisioning/profile writes; old actions remain rollback. Live database/provisioning/browser verification is separate from mocks/builds.
- Scope: migrate only the seven user-administration actions. The same components' title reads and delete-user-timesheets operation remain with their later settings/import-export slices; do not mark those transports retired. Own-profile editing is the next independent row.
- Acceptance: all operations/payloads, defaults/clear values, role-axis independence, self edits/cycles/title mismatch, audit success/failure, missing target/credentials, no read-back, admin-only active/origin/fence/bearer non-fallback, disabled-bearer cookie availability, mobile regressions, lint/types/full coverage and both builds. No schema/provider change or production mutation is authorized by this slice.

## Continuation decision: own-profile editing

- Question: move `MyProfilePanel`'s department/title write to the existing `/api/v1/profile` resource while preserving the distinction between signed-in profile reads and active-account writes.
- FACT: profile GET intentionally uses `{ allowCookie: true, allowInactive: true }`; the old action uses `requireMutatingActiveActor`. `updateOwnProfileDomain` trims both fields, rejects titles belonging to another hierarchy role, and writes only the authenticated actor's profile. Mobile `/api/v1/auth/me` PATCH already uses the same domain but has its own partial-input and actor-DTO contract.
- Decision: add a strict `{ department, title }` PATCH contract to `/api/v1/profile`, guarded with `{ allowCookie: true }` and no inactive opt-in. Return the standard write acknowledgement consumed by `dataClient`; retain GET's inactive semantics and retain `/api/v1/auth/me` unchanged for mobile. `MyProfilePanel` keeps its existing `onSaved` refresh and title-read path.
- Alternatives rejected: repoint the browser to `/api/v1/auth/me` (couples it to mobile actor DTO/partial defaults); permit inactive PATCH because GET allows inactive (collapses authentication and authorization); return a profile read-back after write (adds a new failure point); move title reads in this slice (belongs to the activity/title reference work).
- Lifecycle/recovery: cookie origin → active actor → fail-closed fence → strict parse → self-only domain write → acknowledgement → existing refresh. Explicit bearer requests do not fall back to cookies. Separate submissions are direct and uncoalesced; no automatic retries or new idempotency. Domain validation/storage messages remain visible; refresh failure cannot retroactively fail the write. Old action remains rollback.
- Acceptance: active success, inactive/anonymous/foreign-origin/invalid-bearer/fence refusal before persistence; strict body and encoded self scope; trimming/clears; same-role title success and cross-role rejection; storage error; GET inactive behavior and mobile auth/me regression; client payload/no coalescing; lint/types/full coverage/both builds. Live DB/E2E remain separately reported.

## Continuation decision: activity-type mutations

- Question: move the activity-type panel's create, rename, active-state and Telegram-number writes to the existing v1 admin resources without adopting the bearer route's combined-patch read-back lifecycle.
- FACT: the four actions require an active permission-role admin and call separate narrow domain operations. Create supplies only `name`; each edit performs one write and the panel reloads separately. The bearer POST supplies a nullable Telegram option, while bearer PATCH uses `updateActivityType`, applies multiple fields in order and reads the row back. A successful deactivation can therefore disappear from that active-only read-back.
- Decision: opt POST/PATCH into cookie admission, add strict browser create and discriminated single-operation PATCH contracts, and dispatch cookie writes to browser adapters that call the same narrow domain operations as the actions. Preserve bearer payloads/read-back and keep DELETE bearer-only until the superadmin activity-deletion slice. Browser responses acknowledge completion and the panel retains its reload/toast behavior.
- Lifecycle/recovery: origin → active admin actor → fail-closed fence → strict operation parse → one domain/provider write → acknowledgement → explicit panel reload. Empty names, duplicate failures, nullable Telegram clearing and positive-integer validation retain domain wording. Separate submissions remain uncoalesced and are not automatically retried; old actions remain rollback.
- Acceptance: create/rename/activate/deactivate/Telegram set+clear, exact field mapping and no browser read-back; ordinary/PM/inactive/anonymous/origin/bearer/fence refusal; malformed/extra/multi-operation payloads; duplicate/provider errors; cookie availability with mobile bearer disabled; unchanged bearer DTO behavior; focused client/route/domain tests plus lint/types/full coverage/both builds.

## Continuation decision: global-reminder mutations

- Question: replace the panel's create/delete/dismiss actions while preserving the distinct admin and active-user policies and the action's acknowledgement lifecycle.
- FACT: create/delete require an active permission-role admin; dismissal requires only the active actor and is self-scoped by persistence. Creation validates, trims and normalizes the reminder date in the domain. The bearer create route requires an inserted row, while the action succeeds after a committed write even when no row is returned. These operations do not consume the personal-reminder write budget.
- Decision: admit cookies on admin create/delete and global dismiss, use strict browser create input, and return browser acknowledgements without requiring an inserted-row read-back. Preserve the bearer create DTO and existing admin PATCH behavior. The panel keeps due/all reload and toast behavior.
- Lifecycle/recovery: origin → active actor → role check where required → fail-closed fence → strict create parse/domain validation → one provider write → acknowledgement → panel reload. Dismissal remains actor-scoped and repeat behavior remains provider/domain-owned. No new budget, retry, idempotency or coalescing behavior is introduced; old actions remain rollback.
- Acceptance: trimmed message/ISO date, missing/invalid/extra input, admin create/delete denial, ordinary active dismissal, repeat/provider failures, no browser read-back, due/all refresh, origin/session/bearer/fence behavior, disabled-bearer cookie access and unchanged bearer DTOs.

## Continuation decision: backfill, web layouts and capability discovery

- Question: replace settings/layout/capability actions without treating the existing mobile-layout routes as equivalent web contracts.
- FACT: web dashboard, admin-panel and global-default layouts use separate domains and persistence fields from mobile layout. Personal dashboard writes require an active actor; personal admin layout requires permission-role admin and filters the super-admin tile for ordinary admins; default reads allow any active actor and default writes require the configured superadmin. The bearer backfill PUT reads back after writing, unlike the action. `amISuperAdmin` is display discovery, not authorization.
- Decision: add explicit cookie-enabled `/api/v1/layout/web` GET/PATCH/PUT capabilities for default reads, personal dashboard/admin writes and superadmin defaults. Add read-only `/api/v1/capabilities` for the display hint. Admit browser cookies on backfill PUT and acknowledge the committed write before bearer-only read-back. Preserve existing mobile layout routes and mobile defaults.
- Lifecycle/recovery: reads remain available while fenced. Writes use origin → active actor → domain role/superadmin policy → fail-closed fence → strict layout/backfill parsing → provider write → acknowledgement → existing local UI state update. No retries or coalescing. Unknown/duplicate/missing tiles remain domain validation failures; admin tile filtering remains domain-owned.
- Acceptance: default read, actor-isolated dashboard/admin persistence, ordinary-admin superadmin-tile filtering, superadmin default writes, mobile-default preservation, invalid layouts, capability hint vs authorization, backfill bounds/modes, no browser post-write read-back, session/origin/bearer/fence policy and unchanged mobile route behavior.

## Continuation decision: workspace branding

- Question: replace branding actions while preserving active-user reads, superadmin writes, field-error wording, server invalidation and immediate visible refresh.
- FACT: the existing bearer admin route restricts reads to superadmin and does not invalidate the layout. The actions allow any active user to read, map validation to the first field error, call `revalidatePath('/', 'layout')` after save/reset, and the panel invokes its refresh callback.
- Decision: add cookie admission to the existing branding resource. Cookie GET uses the active-user read domain while bearer GET retains its superadmin contract. Cookie and bearer writes remain superadmin-only; save/reset invalidate the root layout. The panel uses `dataClient`, reloads its form state and calls a parent callback that now performs `router.refresh()` for the already-open shell.
- Lifecycle/recovery: read is fence-independent. Write uses origin → active configured superadmin → fail-closed fence → branding validation/provider write → layout invalidation → response → form reload and router refresh. A committed write is not retried automatically. Logo URL, app name and primary color remain one validated payload; reset uses the existing default branding.
- Acceptance: active read audience, ordinary-write denial, first-field validation, provider failure, save/reset payloads, revalidation, explicit current-page refresh and subsequent navigation; logo URL/color/title behavior and browser caching are included in affected browser verification.

## Continuation decision: superadmin lifecycle

- Question: replace reset, permanent user/activity deletion, whitelist and title actions without broadening ordinary-admin authority or losing best-effort audits.
- FACT: activity deletion is admin-capable in the shared reference domain, but the browser action is superadmin-only. Reset and permanent-user deletion already own audit behavior in their domains; whitelist/title/activity action audits were transport-owned.
- Decision: add narrow superadmin reset/user/whitelist resources, use cookie-specific branches on existing title/activity routes, and centralize browser orchestration in `lib/api/v1/services/superadmin.ts`. Move transport-owned best-effort audit support to `lib/audit.ts`, re-exporting it for rollback actions.
- Lifecycle: origin → active actor → fail-closed fence for writes → strict body parse → explicit superadmin/domain policy → provider operation → best-effort audit where transport-owned → acknowledgement. Reads remain fence-independent. Bearer title/activity contracts remain unchanged.
- Acceptance: ordinary-admin activity deletion refusal, reset modes, self-delete protection, whitelist normalization/CRUD, title add/reclassify/impact/delete, provider errors, all audit names/details, origin/bearer/fence behavior and mobile regressions.

## Continuation decision: import/export and transport retirement

- Question: move the final import/export/delete-user-timesheets callers while preserving import reservation semantics and deciding whether legacy transports can be removed locally.
- FACT: CSV import combines one fail-closed daily reservation, reference resolution, row validation, 24-hour cap checks, provider import and audit. Backup export is an admin read and must remain available while fenced. Repository caller search proves production browser caller-zero for Server Actions and legacy URLs, but cannot prove deployed caller-zero.
- Decision: extract `importTimesheetsForActor` as the shared coordinator used by action and v1 route; it releases the reservation on rejected, failed and exceptional attempts. Add versioned import/export/user-timesheet routes and shared-client methods, and migrate backup/import/user panels plus the final report fetch. Enforce the new browser boundary statically. Retain old server aliases until rollout observation authorizes deletion.
- Lifecycle/recovery: import reserves once, releases before any no-write/error return and on thrown dependency failures, but consumes successful writes; partial validation issues remain visible. Export uses an unfenced admin read. Restore retains its bounded raw-body/atomic coordinator. Direct browser writes are not retried automatically.
- Acceptance: max rows, strict row shape, mapping/cap/partial outcomes, reservation release/consume, export under fence, separate user-timesheet deletion, restore contract, no production browser action/legacy URL references, benchmark v1 path, and both existing rollback and bearer tests.
