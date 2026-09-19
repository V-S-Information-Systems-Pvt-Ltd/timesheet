# Master Architecture Remediation Plan

Validated 2026-09-06 against `910806a` and the current working tree.

**Status:** consolidated implementation roadmap; no remediation implemented by this document. This is the plan of record for future execution. [ARCHITECTURE_REMEDIATION_PLAN.md](ARCHITECTURE_REMEDIATION_PLAN.md) and [TWO_AGENT_PLAN_VALIDATION.md](TWO_AGENT_PLAN_VALIDATION.md) remain historical inputs. Where they disagree with this document, use this document.

## Outcome and scope

Make authentication revocation and rollout controls effective; bind mobile bearer requests to a real Supabase RLS principal; correct report/import completeness; make restore atomic; preserve offline work through restart and retry; then consolidate duplicated business rules and repository structure behind proven parity tests. Preserve web action signatures, v1 DTOs, two-axis authorization, and both backend modes.

Retain task IDs T17.1–T22.1 for traceability. Add T17.0 for Supabase bearer-to-RLS binding, T18.0 for incremental parity coverage, T19.2 for replay protection, and CP23 for optional structural/operational follow-up. Checkpoints are release gates, not an instruction to run every task serially. A master roadmap has multiple independently reviewable slices; it is not one implementation PR.

No model benchmark, cost ranking, token allocation, or fixed agent count is adopted: these are not established by the codebase and are unnecessary to execute the work. Assign an implementer and reviewer per slice when execution begins. Branches use `codex/<task-description>`; commits follow Conventional Commits. This plan does not authorize commits, migrations against a live service, or releases.

## Comparison and validated decisions

The architecture plan supplies the core twelve tasks and useful acceptance criteria. The validation document supplies parity coverage, repository decomposition, observability, and replay protection. However, its Part 6 lists four additions plus idempotency, whereas Part 9 substitutes already-covered revocation and IP issues. Adopt the Part 6 scope as corrected below; do not create duplicate revocation/IP tasks. Code validation also found the T17.0 Supabase mobile-principal gap, which neither source plan makes an executable task.

| Area | Source evidence at this baseline | Master decision |
|---|---|---|
| Proxy fallback | `lib/ip.ts:50–103` uses configured hops or returns `direct-client`; `docker-compose.yml:services.app.ports` exposes port 3000 with no reverse proxy. | Retain the fail-closed resolver. Reject unsafe production configuration. **Do not blindly set hops=1 in direct-exposure Compose.** Header trust also requires preventing direct app access. |
| Native password revocation | `lib/auth/native.ts:105–125` changes only the hash; `:22–27` checks web session versions. `lib/db/password-recovery.ts:93–116` provides a transaction precedent. | Atomic password/version/revocation operation. Renew the web caller cookie; separately preserve the authenticated mobile session. |
| Mobile caller identity | `app/api/v1/_http.ts:40–115` authenticates bearer claims against `mobile_sessions`, returning `sessionId`. It does not authenticate using a web cookie. | Both source documents incorrectly prescribe cookie renewal on both routes. The mobile route must retain its current session or exchange bearer credentials; this plan retains that session to preserve its `{ success: true }` response. |
| Supabase mobile RLS identity | `app/api/v1/_http.ts:40–115` verifies a custom `MOBILE_AUTH_SECRET` token, while `lib/db/supabase.ts:49–54` obtains a cookie-scoped client from `lib/supabase/server.ts`. Mobile requests carry no browser cookie. | This is a confirmed release blocker, not a test-only uncertainty. Add T17.0: make the existing short-lived mobile access token Data API-compatible and bind it to an explicit request-scoped Supabase client. Never route ordinary mobile data access through `service_role`. |
| Supabase password change | `app/api/v1/auth/change-password/route.ts:59–64` uses admin password update without checking the supplied current password or revoking custom mobile sessions. The web client already reauthenticates at `lib/auth/client.ts:171–185`, but does not revoke other application sessions. | Include all four transport/backend permutations in T17.2; a native-only or mobile-only fix is incomplete. Provider auth and application sessions are separate systems. |
| Bearer rollout gate | `app/api/v1/config/route.ts:8–9,29–33` advertises bearer auth only for explicit `true` plus a secret, with a fail-closed comment. `_http.ts` does not enforce it. | Use explicit opt-in, preserving the documented bootstrap policy. Source plans' recommended unset=enabled changes that policy. After T17.0, readiness means the backend-specific signer/verifier is valid, not merely that one string is nonempty. Preserve the actual `capabilities.bearerAuth` field, not an invented `enabled` field. |
| Import totals | `app/actions/import-backup.ts:36,122` is admin-gated but calls global totals. Both adapters expose `sumHoursForUserDates`. | Reuse the contract, with safeguards below. Global service-role aggregation is an unnecessary privileged read; the existing admin gate means this alone is not proof of an ordinary-user data leak. |
| Scoped totals limitations | `lib/db/native.ts:1421–1450` joins supplied pairs without deduplicating them. `lib/db/supabase.ts:1408–1437` reads the user/date cross-product without paging, then filters exact keys in memory. | Neither source's “exact pair matching already exists in both adapters” is fully accurate. Deduplicate inputs and guarantee complete Supabase results before switching the import. Otherwise repeated pairs overcount in native, or API row limits undercount in Supabase. |
| Reports | `app/reports/page.tsx:145,160,175` has initial/retry/load-more calls without dates; `:201–215` filters locally. Load-more already exists. `lib/data/client.ts:111–112,320–321` supports server dates. | Correct all three paths and stale-request handling; retain explicit paging. Do not describe the current page as permanently capped or invent a broad report query framework. |
| Branding | `next.config.ts:58` blocks external images; `app/components/ui.tsx:563–575` renders the remote URL and falls back on error. `app/layout.tsx:24,40,58` has three getter calls. | Same-origin delivery with SSRF controls, plus shared request memoization. Three source calls are verified; actual query reduction must be measured, not assumed for every backend/render mode. |
| Restore | `lib/db/supabase.ts:1187–1390` already batches timesheets/leaves/reminders, but uses independent writes and returns zero counts on later errors. Native commits/rolls back at `lib/db/native.ts:1398–1402`. | Atomic restore is the completion criterion. Honest partial reporting is only an interim mitigation, never an equivalent completion of atomicity. Native behavior is a reference to characterize, not proof that every limit/deduplication rule is correct. |
| Mobile storage | `mobile/src/storage/offline-queue.ts:94–196` uses Map/localStorage and swallows errors. `theme-store.ts:32,57,99` uses browser/Node fallbacks. Workspace storage already calls native workspace methods. | Retain T20.1 and T21.1 as one releasable vertical slice. Do not activate JS callers before native methods exist. No workspace persistence rewrite. |
| Native KV | Workspace methods exist in Kotlin, Swift/Obj-C bridge, and Windows C++; generic item methods do not. Windows uses `ReactPromise<std::string>` and represents absence as empty string. | Prove storage capacity and round-trip behavior on all three platforms before selecting a production backing store. Preserve the existing credential/workspace contracts. |
| Offline replay | `mobile/src/sync/sync-engine.ts:55–82,108–148` sends no mutation ID, dequeues after a response, and discards all 4xx except 429, including 401/403. Searches of `app`, `lib`, `db`, and migrations found no idempotency handling. | Add server atomic deduplication and client key propagation before durable-queue release; preserve work on auth failures and retain explicit user-visible conflicts. |
| Admin creates | `app/api/v1/admin/projects/route.ts:47–64` creates, lists, finds by name, applies optional setters, then lists again. Project names are unique in native `0001_initial_schema.sql:37` and Supabase `20260810160000_initial_schema.sql:38`. | Return the inserted row and include optional fields atomically. The sources' “two successful same-name creates return each other's IDs” example is contradicted by the schema. Test one success/one duplicate rejection, plus rename/delete interleaving. |
| Shared domain rules | `app/actions/timesheets.ts` and `lib/api/v1/services/timesheets.ts` separately implement write rules. | Extract timesheets only after characterizing differences. Shared `changePassword` itself is not evidence of duplicated timesheet rules. |
| Parity and observability | `tests/mobile-contract-parity.test.ts` exercises DTO mapping; `tests/supabase-repository-authz.test.ts` has mocked adapter coverage. `lib/logger.ts` and `mobile/src/telemetry/telemetry.ts` already exist. | Extend existing tests/logging. Mocked checks are not real SQL/RLS parity; do not build replacement frameworks. |
| Already shipped | `idx_timesheets_user_date` exists in both performance-index migrations. Workspace native persistence exists on three platforms. | Drop duplicate index, restore batching, workspace persistence, and speculative Jest-repair tasks. |

## Sequence, ownership, and release boundaries

| Gate / slice | Depends on | Deliverable / main ownership boundary |
|---|---|---|
| T18.0 parity tracer | Baseline only | One real-backend timesheet allow/deny slice, then incremental fixtures immediately before each correction. |
| T17.0 Supabase mobile principal | T18.0 tracer | Data API-compatible mobile token and explicit request-scoped RLS client; must precede Supabase v1 acceptance claims. |
| CP17: T17.1, T17.2, T17.3 | T17.0 where Supabase v1 auth is exercised; relevant parity cases | Deployment/authentication correctness. Serialize overlapping auth-route edits. |
| CP18: T18.1–T18.4 | CP17 for release; T18.0 coverage | Import, reports, branding proxy and request cache. |
| CP19: T19.1 | T18.1 adapter changes; relevant T18.0 fixtures | Atomic restore. |
| T19.2 replay protection | CP17; T18.0; serialize adapter changes with T19.1 | Backend deduplication plus client key propagation and sync error handling. Release server support first. |
| CP20 / CP21 storage: T20.1 + T21.1 | Interface agreement; T19.2 before release | One complete JS/native storage slice; mocks alone cannot close CP20 or release queue migration. |
| T21.2 create-returning | T18.1, T19.1/T19.2 adapter edits integrated | Atomic reference-data creates; may proceed independently of native device work. |
| CP22: T22.1 | Correctness changes above and T18.0 parity tests | Timesheet domain extraction. |
| CP23: T23.1 / T23.2 | T22.1 and complete relevant parity coverage | Repository decomposition / focused operational diagnostics; deferred from core release. |

The old “all branches within a checkpoint are disjoint” claim is not a guarantee. T17.0 and the auth tasks overlap in v1 authentication; branding tasks must agree on the shared getter; restore, totals, idempotency, and create-returning share adapters/contracts/migrations. Use one writer per shared file at a time, rebase after predecessors, and re-run affected checks. T17.0 gates Supabase v1 correctness, and T19.2 is a hard prerequisite for durable replay release regardless of checkpoint numbering. Do not reuse historical CP0–CP16 tags.

Existing staged documentation archiving and package/native version edits are user changes. Do not discard or sweep them into implementation commits. Work from an explicitly selected baseline or isolated checkout when execution begins; record relevant uncommitted inputs. They do not block producing this plan.

## Executable slices

### T18.0 — Incremental contract and authorization characterization

**Files:** existing `tests/mobile-contract-parity.test.ts`, `tests/supabase-repository-authz.test.ts`, `tests/native-repository.test.ts`, role/action tests; new shared repository fixtures and real-backend integration tests under `tests/`.

- Derive expected capabilities from `lib/roles.ts`, native predicates, and applied RLS migrations. Cover permission_role × hierarchy_role, active/inactive, own/subordinate/unrelated rows, and superadmin-only operations separately. A legacy `role` column is not the matrix.
- Start with one complete timesheet create/read/denied-write tracer against both adapters; do not front-load a replacement test framework. Add totals, restore, replay, and reference-create fixtures immediately before their corresponding slices. Cover zero rows, missing IDs, duplicates, cap violations, rollback, and errors. Assert persisted state, not merely mock call shape.
- Run Supabase tests with actual authenticated principals and RLS; a service-role-only test does not establish parity. Exercise the mobile bearer route with **no web cookies** and require T17.0's principal binding before calling that route supported.
- Record intentional transport differences. Unexpected authorization differences are failing regressions to fix before extraction, not expectations to normalize silently.

**Done:** the initial timesheet tracer is green before CP17, and each later slice adds its own relevant real-backend fixture before behavior changes. Unauthorized operations are denied and authorized state transitions match unless an intentional transport difference is recorded. Missing integration credentials are reported as not run, never green. Repository decomposition remains blocked until every moved method has coverage.

### T17.0 — Bind mobile bearer identity to Supabase RLS

**Files:** `lib/auth/mobile-tokens.ts`, `app/api/v1/_http.ts`, v1 route wrappers, a new server-only Supabase bearer client/context, `lib/db/supabase.ts` client selection, environment/deployment documentation, and real Supabase route tests.

- Keep one public mobile access token. In Supabase mode, mint it with an imported project signing key so the Data API accepts the same short-lived JWT. Include the standard `sub`, `role: authenticated`, and `exp` claims plus the existing session/family/version claims; keep the native-backend signer independent. Current Supabase documentation confirms externally minted JWTs from an imported signing key and the `createClient(..., { accessToken })` client option: [JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys) and [custom JWTs](https://supabase.com/docs/guides/auth/jwts#using-custom-or-third-party-jwts). Account for the stricter Data API JWT validation recorded in the [2025-09-17 changelog](https://supabase.com/changelog/38771-changes-to-custom-jwt-and-signing-keys-issue-resolution).
- Validate the token twice for different purposes: cryptographic/session validation in `requireMobileActor`, then Data API validation under RLS. `sub` must equal the authenticated `mobile_sessions.user_id`; `role` is server-authored and fixed to `authenticated`. Never copy authorization roles from user-editable metadata into JWT claims.
- Introduce an explicit v1 request wrapper that runs the authenticated handler with a request-scoped Supabase client created with the publishable/anon API key plus the `accessToken` callback. Keep the cookie-scoped client for web traffic. Do not infer a bearer from arbitrary headers inside the generic web client, and do not use `service_role` for ordinary v1 reads/writes.
- Prove one v1 timesheet create/read/denied-cross-user tracer first, then migrate every authenticated v1 route that reaches `repo` before declaring Supabase mobile support. The route response/DTO stays unchanged. Inventory routes using both `requireMobileActor` and `requireMobileSession`.
- Roll out the imported signing key and verifier before issuing new tokens. Existing custom refresh tokens remain valid and issue the new access-token form; the mobile client's existing single-flight 401 refresh path provides migration. Old access tokens expire after the existing 15-minute TTL and must never be accepted as an RLS identity. During a bounded transition, the verifier may recognize an old token only to return an upgrade-required 401 that triggers refresh; it must not enter the repository context. Document key rollback and never expose signing material to the mobile client.

**Done:** with no browser cookies, a real Supabase-backed v1 request can read/write its own allowed row, cannot read/write another user's row, and a revoked/rotated custom session is rejected before any Data API call. Web cookie requests behave unchanged; logs and tests prove no service-role client handled the ordinary mobile operation. If the target Supabase project cannot import and safely retain a signing key, stop this slice and choose an explicit provider-token exchange design before changing DTOs or storing provider refresh tokens.

### T17.1 — Safe production proxy configuration

**Files:** new server-only configuration validator and root `instrumentation.ts` (reuse one if present), `docker-compose.yml`, `.env.example`, `deploy/README.md`, `deploy/configmap.yaml`, `tests/ip.test.ts`, new startup tests.

- Validate exact positive-integer `TRUSTED_PROXY_HOPS` at startup for every self-hosted Node production deployment outside the trusted Vercel environment, regardless of database backend. Reject malformed/negative/zero/unset values unless explicit `ALLOW_UNTRUSTED_CLIENT_IP=true` acknowledges shared fallback buckets; warn once on that escape hatch. Zero is not a source of a trustworthy direct client IP.
- Keep `getClientIp` resolution order. The installed Next guide `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md` specifies `register()` runs before server readiness. Keep validation server-only and distinguish build evaluation from runtime startup.
- For the existing directly exposed local Compose topology, use the explicit warning opt-out with local-use documentation. For production, document/prove a sanitizing trusted proxy and an app port inaccessible to clients before setting its actual hop count. K8s's configured `1` alone does not prove network isolation.
- Test spoofed forwarding headers, trusted chains, malformed configuration, runtime start/standalone start, and shared IP-only bucket behavior. Do not replace the fallback with an attacker-controlled identity.

**Done:** unsupported production topology refuses startup; deliberate local fallback warns; trusted production traffic resolves independently without trusting injected headers. Release notes describe the boot behavior change and migration configuration.

### T17.2 — Password change and session continuity

**Files:** `lib/auth/native.ts`, `lib/db/password-recovery.ts` or a focused new DB helper, `lib/auth/mobile-session-store.ts`, both change-password routes, `app/api/auth/revoke-mobile-sessions/route.ts`, `lib/auth/client.ts`, relevant auth tests.

- Native core: verify current password and serialize password replacement using a locked row or compare-and-swap guard. In one DB transaction update hash, increment `session_version`, and revoke affected mobile sessions. Do not invoke a helper that opens a separate transaction for revocation. Preserve dummy-hash timing behavior and existing rate-limit release rules.
- Native web caller: revoke every mobile session and issue a new web cookie using the returned version; all older web cookies must fail.
- Native mobile caller: derive the exception only from authenticated `auth.sessionId`, never request JSON. Preserve that exact live session and revoke all other sessions while incrementing the web version. Handle refresh rotation races under the same transaction/locking discipline: either the live caller is preserved or return a recoverable conflict before changing the password.
- Supabase web caller: keep current-password verification, update through the user-scoped client, revoke application mobile sessions, and use provider `signOut({ scope: 'others' })` so the current browser stays signed in. The declared `@supabase/supabase-js` version supports `current_password`; use it in the password update rather than relying only on a preceding login. Select a bounded policy: other provider sessions lose refresh immediately, while already-issued access JWTs may work only until the configured provider expiry, which must be 15 minutes or less for this release.
- Supabase mobile caller: authenticate the supplied current password using an ephemeral non-persisting provider client, derive the custom-session exception from `auth.sessionId`, revoke all other custom mobile sessions, update the provider password with `current_password`, and terminate the ephemeral/other provider sessions. Provider password writes and custom-session SQL are not one transaction: revoke custom sessions before the provider write so a failed revoke cannot be followed by an unprotected password change; report provider failure truthfully even if other devices were signed out.
- Provider and application session invalidation are separate. Verify the current Supabase session policy and access-token TTL in integration tests; the official [sign-out scopes](https://supabase.com/docs/guides/auth/signout#sign-out-and-scopes) retain the current session with `others`, while revoked access JWTs remain valid until expiry.
- Preserve v1 `{ data: { success: true }, error: null }`. If provider behavior cannot meet the session policy without an API/client change, document the required compatibility rollout before executing that portion.

**Done:** wrong password cannot mutate credentials in either backend; other custom mobile sessions fail after success; the caller's next request works; native revocation failure rolls back the hash; concurrent change/refresh tests prove no revoked custom session is resurrected. Other native web sessions fail immediately. Other Supabase provider sessions cannot refresh and lose Data API access no later than the verified 15-minute maximum. Supabase failure ordering and all four transport/backend permutations have integration evidence.

**Tests:** `tests/native-auth-session.test.ts`, `tests/auth-change-password-timing.test.ts`, `tests/auth-routes.test.ts`, `tests/mobile-change-password-route.test.ts`, `tests/mobile-request-auth.test.ts`, `tests/mobile-refresh-route.test.ts`; new transaction/continuity cases. The sources' `tests/auth-native.test.ts` is not an existing file.

### T17.3 — Enforce the advertised bearer switch

**Files:** `app/api/v1/_http.ts`, `app/api/v1/config/route.ts`, login/refresh/signup routes, shared server predicate, mobile config/request-auth/auth-route tests, deployment docs.

Use one predicate: flag exactly `true` and a valid backend-specific token configuration (native `MOBILE_AUTH_SECRET`; Supabase imported signing key plus verification/client inputs from T17.0). Validate structure, algorithm, key identifier and minimum secret requirements at startup rather than applying `Boolean(...)` to raw strings. Enforce the predicate before token verification or issuance; return the existing v1 error envelope with a consistent `MOBILE_API_DISABLED` code/status 503. Keep config reachable and preserve its actual capability schema. Inventory all v1 routes, including `requireMobileSession`, so no issuing or protected path bypasses the gate. Document which public metadata routes remain reachable.

**Done:** false, unset, and incomplete/invalid backend token configuration deny protected calls without credential-dependent responses; explicit true with valid configuration preserves intended behavior. Add explicit production flag and backend-specific key configuration before rollout. Include disabled-during-sync coverage in T19.2 so queue data is retained.

### T18.1 — Complete, scoped import totals

**Files:** `app/actions/import-backup.ts`, both adapters, `lib/db/repository.ts`, Supabase migration/types if required, existing action/repository/migration tests and relevant documentation.

- Deduplicate `(userId, logDate)` pairs before calling `sumHoursForUserDates`; also harden the primitive against repeated input for other callers.
- Fix Supabase completeness first: page with stable ordering and bounded pair batches under the existing contract, or use a scoped RLS-respecting aggregate if measured volume warrants it. The existing cross-product read is not exact-pair SQL. Test more than the configured API row limit and sparse user/date pairs. Do not introduce a global service-role aggregate.
- Swap the admin import call to the returned Map. Preserve pre-existing-hours plus incoming-hours cap validation and messages. Confirm DB concurrency enforcement remains authoritative.
- Search all references before removing the obsolete interface member/adapters/mocks and update generated RPC types/docs. Drop the old RPC via a new migration **after** all deployed callers have moved; retain it during rollback compatibility, then contract the schema.

**Done:** repeated pairs are counted once, missing pairs produce zero, large Supabase datasets are complete, unauthorized actors remain scoped, and both adapters reject imports exceeding 24 hours consistently. Existing composite indexes are reused.

### T18.2 — Date-scoped report paging

**Files:** `app/reports/page.tsx`; new page interaction tests plus existing report/export tests.

Pass `dateFrom` and `dateTo` through initial load, retry, and load-more. Compute stable date boundaries before callback use; reset rows/count/errors/paging on range change; guard every response with a request generation or cancellation so stale load-more cannot append into the new range. Preserve project/user selectors and existing table accessibility.

Keep bounded paging with clear “loaded N of M” state and label computed totals as loaded-row totals until complete. Do not claim page subtotals equal the full export while more rows remain. Once all pages are loaded, table results must agree with existing server-filtered CSV for equivalent filters. Comparison ranges must each use their own complete/paged range; inspect all `selectRows` consumers before calling the one-file change done.

**Done:** >1000 total rows with a small target range returns that range immediately; >1000 rows inside the range can be loaded completely; rapid range changes, retry, and old load-more responses cannot mix results. One request for each requested page, not the sources' incompatible “one request per range” promise.

### T18.3 — Same-origin branding image

**Files:** new `app/api/branding/logo/route.ts`, `app/components/ui.tsx`, small server-only fetch helper, `tests/branding-logo-proxy.test.ts` (new), existing branding tests.

Resolve the stored branding URL server-side; do not accept an arbitrary URL query parameter. Require HTTPS with no credentials; reject private/loopback/link-local/other non-public IPv4 and IPv6 addresses. Pin the validated address to the actual connection while retaining TLS hostname verification, or use an equivalent network egress restriction: DNS prechecking followed by an independent resolving fetch leaves a rebinding gap. Manually revalidate redirects; set a redirect cap, timeout, response-byte cap, and explicit image MIME allowlist.

First prove the chosen transport supports safe address binding with installed dependencies. Keep SVG support only with a restricted response CSP and verified safe handling; otherwise explicitly reject it and document the limitation. Add `nosniff`, avoid forwarding cookies/authorization, and return generic failures. Cache by branding revision/URL with a bounded lifetime so changing logos does not retain an unrelated old image. Preserve preview behavior and bundled fallback; an unsaved URL must not silently masquerade as the saved logo.

**Done:** supported remote logos render under unchanged application CSP; private destinations, redirect/rebinding attempts, credentialed URLs, oversized/slow/non-image responses fail safely. Test production rendering and fallback, not just mocked fetch success.

### T18.4 — Shared request-scoped branding getter

**Files:** `app/layout.tsx`, one server-only getter shared with T18.3 as appropriate, new render tests.

Use one React `cache()`-wrapped getter for metadata, viewport, and layout. Preserve both thrown-error and returned-error/default behavior, palette output, and no-branding behavior. The installed `generate-metadata.md` explicitly supports React cache for non-fetch data access. Do not introduce cross-user/process caching as a substitute.

**Done:** rendered configured/default/error states match; an actual server render verifies request-level deduplication and separate requests can observe updated branding. A unit test that invokes a getter outside React's render cache is not proof of this property.

### T19.1 — Atomic restore with truthful outcomes

**Files:** `lib/db/supabase.ts`, new Supabase restore migration, generated database types, restore action/route audit paths, `tests/supabase-restore.test.ts`, `tests/backup-restore-route.test.ts`, real-backend restore fixtures.

Characterize all payload categories, missing references, duplicate signatures, skipped counts, caps and concurrent writes from both adapters. Move Supabase restore into one database transaction/RPC, including every inserted category. Preserve bounded lookup/processing behavior without reproducing fixed-size pre-read truncation. Do not retain client-side `.range()` merely to satisfy old wording when the SQL function replaces those reads.

Specify the caller/grant model before SQL: prefer an authenticated invoker with the necessary existing permissions. Current restore is explicitly admin-gated and service-role-backed; an invoker under service_role does not magically apply user RLS. If a privileged function/path is necessary, make the grant surface, actor verification, owner and search_path explicit, deny public/anon execution, and test it against real principals. Never add a broad bypass for convenience.

Failure must roll back all data and return zero committed counts. Success returns actual created/skipped counts; audit records reflect only committed results. If audit delivery remains outside the transaction, distinguish a committed restore with failed audit from a failed restore, and provide an actionable retry/record path. Replaying the same payload after a lost response must not duplicate categories that are intended to be deduplicated; test reminders/global reminders as well as timesheets.

**Done:** induced failures after early and late categories leave the pre-restore state intact; native/Supabase success and conflict fixtures agree. Interim truthful partial counts may ship separately if needed, but CP19 remains open until atomicity is proven.

### T19.2 — Safe offline replay across both backends

**Files:** `mobile/src/sync/sync-engine.ts`, `mobile/src/api/client.ts`, queue callers as needed; v1 mutation routes/services; repository contract/adapters or focused DB helpers; new migrations in both backends; existing queue/sync/API tests and new idempotency integration tests.

- Cover all eight queued operations: create/update/delete timesheet, create/delete leave, create/update/delete reminder. Begin with create-timesheet as a complete server/client tracer slice, then extend the same invariant to every queued operation before durable replay release.
- Send the existing queued mutation ID as `Idempotency-Key` on every retry. Include authenticated actor and operation/resource in the server uniqueness scope; clients are already partitioned by server URL and actor. Never let request JSON choose another actor's deduplication namespace.
- Atomically claim the key, perform the write, and persist its result in the same DB transaction. A “check then insert” route wrapper, or a separate ledger commit after the mutation, is insufficient. Bind a canonical payload fingerprint; replay of the same request returns the stored compatible response, while key reuse with a different payload returns a documented conflict. Reauthenticate and authorize before returning stored data.
- Test concurrent same-key requests, timeout after commit, restart before dequeue, rollback before commit, changed payload, changed actor, and deleted resource. Replays must not duplicate rows/audit effects or charge the write budget twice. Keep unkeyed requests working for shipped clients; advertise support before enabling durable replay against a server.
- Bound automatic replay to 90 days, matching the existing absolute mobile refresh-session lifetime. At 90 days, move an item to a user-visible manual-review state rather than deleting or replaying it as new. Retain deduplication records for at least that window plus a seven-day grace; change both values together if product requirements later extend offline lifetime. Test both boundaries.
- Fix blanket 4xx dequeue: pause and retain on 401/403, disabled API, rate limit, and transient failures. Preserve validation/conflict failures in a user-visible failed state with explicit discard/retry, rather than silently losing work. Do not replay against another account/workspace.

**Done:** each queued operation has exactly one committed effect for repeated/concurrent delivery in both backends; no automatic data loss after session expiry; old clients and servers have a documented compatibility path. This is a backend and client slice, not a JS storage-only task.

### T20.1 + T21.1 — Durable queue and native storage together

**Files:** new `mobile/src/platform/kv-store/` seam; `mobile/src/storage/offline-queue.ts`, `theme-store.ts`; Kotlin `VsisSecureStorageModule.kt`, Swift `VsisSecureStorage.swift`, Obj-C `VsisSecureStorageBridge.m`, Windows `VsisSecureStorage.h`; platform adapter declarations and mobile tests.

- Define injectable async get/set/remove methods and typed unavailable/corrupt/read/write/delete errors. Normalize null and Windows empty-string absence. Namespace app data away from token/workspace entries; validate keys and string values at the native boundary.
- Prove one native write/read/restart/remove cycle and representative queue payload sizes before committing to vault-backed generic KV. Credential stores are not automatically appropriate for arbitrarily large queues. If existing stores fail capacity/atomicity requirements, use a dedicated platform-backed store with an explicit size policy and rationale; never truncate or silently fall back to memory. Preserve token protection and existing credential methods.
- Implement all three native platforms including bridge registration. Ship JS consumers only in a package containing compatible native methods. An unused seam may land earlier, but mock-only activation cannot be released.
- Serialize queue read-modify-write operations per workspace/actor; update memory only after durable acknowledgement. Crash-safe writes, failed dequeue, corrupted reads, simultaneous enqueue/retry/dequeue, process restart and logout/workspace switching must preserve isolation and acknowledged items. Audit queue callers to ensure a storage error is shown rather than reporting “saved offline.”
- Theme may fall back to its default; queue errors must surface. Tests use explicitly injected memory storage. Remove implicit browser/fs fallbacks from these two stores. Leave workspace-store behavior intact, including disconnected sentinel/default URL handling.
- Inspect supported non-native contexts before claiming no migration: normal RN has no browser localStorage, but tests/alternate runtimes may. Document whether any supported persisted format needs one-time import. Keep old storage readable until successful migration.

**Done:** Android/iOS/Windows build and real device/emulator evidence proves process-death recovery, absence conventions, deletion, and failure visibility. T19.2 is deployed and capability-checked. A missing platform SDK/device leaves that platform's release gate open; Jest cannot close it.

### T21.2 — Atomic creates return their row

**Files:** repository types/adapters, `app/api/v1/admin/projects/route.ts`, activity-types/titles create routes where matching behavior exists, existing mobile admin reference tests. Inspect users separately because Supabase Auth creation has different transactional semantics.

Introduce a distinct create-result type while preserving `DbWrite` for other writes and public action signatures. Use native RETURNING / Supabase insert-select under the established authorization context. Include optional SO/telegram fields in the same insert and remove list/find/follow-up setters. Do not weaken existing name uniqueness. Apply the bounded change only to confirmed matching creates; do not promise a one-SQL-statement Supabase Auth user create.

**Done:** returned DTO is the inserted row even with intervening rename/delete; optional-field failure leaves no partial row; simultaneous same-name requests yield one creation and one existing duplicate error; allowed/denied roles agree across backends. Use `tests/mobile-admin-reference-routes.test.ts`, not the nonexistent `tests/api-v1-admin-projects.test.ts`.

### T22.1 — Shared timesheet rules

**Files:** new `lib/domain/timesheets.ts`, `app/actions/timesheets.ts`, `lib/api/v1/services/timesheets.ts`, action/v1/domain tests.

Build a rule matrix before extraction: ownership, active state, role restrictions, dates/backfill, hours, sanitization, daily-cap interaction, batch atomicity and rate budget. Preserve intentional transport-specific messages/DTO/status mappings at wrappers around typed domain outcomes; zero behavior change does not require byte-identical messages across two already-different transports.

The domain accepts Actor and explicit dependencies, never cookies/Request/Next headers/HTTP statuses. Keep action authentication gates and v1 bearer gates at their boundaries, with rate accounting once per batch. Migrate one operation end-to-end first, then one transport at a time with characterization tests unchanged in expected behavior. Maintain T19.2 transaction/idempotency ownership; extracting a domain service must not split its atomic write unit.

**Done:** shared timesheet business rules have one owner, both transport contracts and both backend semantics remain characterized and green, coverage meets CI. Projects/users/settings domain extractions are outside this slice.

### CP23 — Deferred follow-up, not core-release blockers

**T23.1 Repository decomposition:** split contracts/adapters by domain only after parity fixtures cover each moved method. Retain `lib/db/repository.ts` as a compatible composition/re-export and `lib/db/index.ts` dispatch. Move one domain first, preserve behavior/import contracts, and stop expanding once the explicitly chosen domains are done. File size alone does not justify new abstraction layers or dependencies.

**T23.2 Operational diagnostics:** extend `lib/logger.ts`, v1 request IDs, and `mobile/src/telemetry/telemetry.ts` for restore outcome, import size/duration, persistence failures, replay retries/conflicts and disabled API. Use bounded operation/backend/result dimensions. Do not log passwords/tokens/backup bodies or put user IDs, workspace URLs, or mutation IDs into metric labels. Add redaction tests and one failure-to-diagnostic verification. Reuse existing tooling; a new telemetry platform is not required.

## Verification and rollout

### Validation performed for this document

- Read both input documents, relevant auth/routes/adapters/store/native implementation hunks, schema constraints, test surfaces, CI and installed Next documentation. The review verified that custom v1 bearer authentication is not propagated to the cookie-scoped Supabase repository client and added T17.0. Current official Supabase signing-key, custom-JWT, sign-out and changelog documentation was checked before selecting that approach.
- Executed in `mobile/`: `node node_modules/jest/bin/jest.js __tests__/offline-queue.test.ts __tests__/sync-engine.test.ts __tests__/home-screen.test.tsx --runInBand --silent` — **3 suites, 6 tests passed**. These baseline tests do not cover the proposed durability/idempotency regressions.
- Root Vitest was not run: local `node_modules/.bin/vitest.cmd` and `node_modules/vitest/vitest.mjs` are absent. No dependency install or package change was made for this documentation task.
- Full root suite, builds, real DB/RLS integrations and device checks were not run. Earlier “Jest unavailable” notes are stale for the three exercised suites; the entire mobile suite has not been claimed green.

### Implementation gates

For each slice run its named existing suites plus newly added meaningful regressions, then the required integration gate. Use actual paths; do not rely on shell expansion of invented test filenames.

Root checks after dependency installation using the selected lockfile:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:coverage
$env:NEXT_PUBLIC_BACKEND = 'supabase'
npm run build
$env:NEXT_PUBLIC_BACKEND = 'native'
npm run build
```

Restore the prior environment value afterwards. Match `.github/workflows/ci.yml` environment requirements. Both builds are required; a single output directory contains only the last build, so rebuild the intended mode before runtime testing.

- DB changes: run migrated disposable Postgres with `TEST_DATABASE_URL` and the actual integration suites (including `tests/daily-hours-concurrency.int.test.ts` where affected). Run Supabase integration under genuine RLS principals, plus `tests/supabase-migrations.test.ts`. Report executed/skipped counts.
- UI: production build first, then `npm run e2e` / `npm run a11y` with seeded `E2E_EMAIL`/`E2E_PASSWORD`. Validate report paging/export and branding CSP in production mode.
- Mobile: in `mobile/`, `npm run lint`, `npx tsc --noEmit`, `npm test`. `.github/workflows/ci.yml` already contains these mobile gates. Native changes also require platform build/device evidence; Linux Jest CI is insufficient.
- Schema additions use new migrations, mirrored where both backends need the change. Read current Supabase docs/CLI help before implementation and use the project migration workflow; do not edit applied migrations or push to a live target merely because this plan exists.

Roll out additive schema/server support first, then callers/clients, then remove obsolete RPCs after compatibility verification. Reverting app code must leave additive tables/functions available to older clients still replaying work. Never roll back revocation by decrementing session_version or clearing revoked_at. Disable affected functionality or forward-fix if a secure downgrade is unavailable. Do not delete pending queues on rollback; preserve their schema and recovery path. Failed restore migrations leave the old app available until the new atomic path is proven, without calling the old behavior fixed.

## Assumptions and invalidation criteria

| Assumption | Status at planning time | Invalidation / response |
|---|---|---|
| The target Supabase project can accept externally minted user JWTs from an imported signing key. | Supported by current official Supabase documentation; target-project key state was not inspected. | If the project cannot safely import/retain a key, stop T17.0 and design an explicit provider-token exchange. Do not use `service_role` or store provider refresh tokens as an improvised fallback. |
| The declared Supabase client supports `accessToken`, `current_password`, and `signOut({ scope: 'others' })`. | `package-lock.json` pins `@supabase/supabase-js` 2.110.8; current docs describe all three. Root dependencies are not installed locally. | Confirm types after `npm ci`. If the locked API differs, stop the affected auth slice and update the plan before changing public contracts. |
| The target Supabase Auth access-token expiry can be set to 15 minutes or less. | Supported by Supabase Auth, but the target project's current value was not inspected. | T17.2 must verify/configure the value before claiming bounded revocation. If policy forbids that TTL, stop and design explicit session-row enforcement instead of claiming immediate invalidation. |
| Production proxy topology sanitizes forwarded headers and blocks direct app access. | Unverified; Compose currently exposes the app directly, while deployment manifests declare one hop. | T17.1 must refuse or require the explicit unsafe fallback until network-path evidence exists. Never infer trust from the hop count alone. |
| A supported native storage primitive can hold representative queue payloads atomically. | Unverified on Android, iOS, and Windows; current credential/workspace stores are not capacity evidence. | T20.1/T21.1 begins with the capacity/restart tracer. If it fails, select a dedicated platform store before activating JS consumers. |
| Real Supabase, disposable Postgres, and all three native build/device surfaces will be available for release evidence. | Unverified in this planning run. | Missing credentials or a platform runner leaves only that slice's release gate open; skipped tests are never counted as green. |
| Automatic replay older than the mobile session's 90-day absolute lifetime is not required. | Chosen bounded policy, derived from `REFRESH_ABSOLUTE_SECONDS`; old items are preserved for manual review. | If product requirements require a longer offline window, extend queue and deduplication retention together before T19.2 ships. |

## Handoff, stop conditions, and completion

On implementation, maintain `docs/plans/MASTER_ARCHITECTURE_REMEDIATION_NOTES.md` with per-task status, commit/baseline, commands and raw-output locations, deployed schema/client versions, and `## Deviations` entries (planned behavior, code constraint, decision). No evidence file is created here with invented implementation results.

Stop only the affected slice and record the blocking evidence if: runtime backend identity cannot satisfy RLS; the selected native store fails supported payload/crash requirements; a credential/provider policy cannot preserve the chosen caller semantics; installed APIs contradict the proposed hook; a live target cannot be distinguished from a disposable test target; or the baseline/unique constraints differ. Continue independent work. Do not silently weaken auth, transactionality, or durability to mark a checkpoint green.

Core completion requires T17.0, CP17–CP22, T18.0, and T19.2 acceptance evidence, passing required checks in both backends, and named native platform release results. CP23 is explicitly deferred and does not block that release. Planning completion means this comparison, corrections, slice dependencies, verification limits and release gates are recorded; it does not mean the remediation is complete.

### Plan review notes — 2026-09-06

| Dimension | Combined inputs | Master | Remaining evidence |
|---|---:|---:|---|
| Completeness | 3/5 | 5/5 | Failure paths, compatibility and finish lines now explicit. |
| Feasibility | 3/5 | 5/5 | Hard surfaces have a supported approach, mandatory tracer, fallback boundary and stop condition. |
| Scope | 3/5 | 5/5 | Twelve original tasks retained/corrected; five validation additions plus T17.0 accounted for; CP23 deferred. |
| Testability | 3/5 | 5/5 | Actual suites, adversarial cases, real-backend/device gates and skipped-test policy named. |
| Risk | 3/5 | 5/5 | RLS identity, service-role prohibition, proxy trust, caller continuity, replay loss, migration compatibility and rollback addressed. |
| Assumptions | 2/5 | 5/5 | Every external/runtime assumption is labeled, paired with an invalidation criterion, and assigned to a release gate. |
