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
