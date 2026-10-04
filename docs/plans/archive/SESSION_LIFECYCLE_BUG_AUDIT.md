# Mobile session lifecycle bug audit

## Decision and verified defect

M1: logout must supersede pending authentication work across all controllers sharing a provider's secure token store. A deterministic scout held refresh unresolved, completed logout and verified empty storage, then resolved refresh: the original implementation became signed-in and repersisted credentials. Baseline cecf635; coordinator verified 48 mobile suites / 296 tests before this audit.

FACT: session-controller.ts originally had no generation. performRefresh invoked applyPair, which wrote credentials and published actor state unconditionally. Logout/logout-all cleared storage without invalidating pending work. SessionProvider uses memoized and temporary connection controllers sharing a token store; refresh callbacks and getValidToken published tokens without ownership checks. Read-cache fencing does not protect these side effects.

## Reviewed protocol

The coordinator/reviewer selected a shared SessionLifecycle passed explicitly to memoized and temporary controllers. Constructors never claim ownership. Preserve provider composition; no global WeakMap or connection-architecture replacement.

Identity intents (connect/restore/login/logout/logout-all) synchronously advance the shared generation. Refresh/status capture it. Network/storage continuations check it before publication or cleanup. SessionCancelledError distinguishes supersession from offline/authorization failures. Status snapshots actor/token before await. Refresh flights are generation-specific with identity-safe finalizers.

Serialize credential read/write/clear, checking ownership at queue execution and completion; recover the tail after failure. Underway obsolete writes can finish, followed by current cleanup/write. Skip stale queued operations and stale failure cleanup. Keep network calls outside the queue.

Fence provider config/restore/sign-in/status/logout publication and delayed 401 responses. Active-client identity rejects old workspace refresh callbacks before reading successor credentials. Cleanup revokes pending work on store replacement/unmount. Boot readiness defers initial screen reads until restore activation completes; otherwise cancellation prevented initial screen loading.

Logout captures the old access token and starts best-effort remote revocation, with local cleanup independent of network completion. Deliberate promise semantics change: logout resolves after local secure cleanup without awaiting remote revocation. This follows reviewed protocol and prevents hung logout networking from retaining local signed-in state. A regression covers hung remote revocation. Cleanup failures remain visible.

## Constraints and alternatives

Preserve secure platform storage, active-account distinctions, offline restore, persistence-failure rollback, cleanup errors, refresh single-flight, and server contracts. Scope is controller/provider and direct tests. Controller-only local fencing leaves shared-store races; provider-only fencing leaves persisted credentials; serializing whole remote calls blocks logout. Shared storage ordering plus publication generations addresses both boundaries.

## Lifecycle acceptance and evidence

- Activation: overlapping config completions cannot install an older workspace.
- Normal operation: existing auth and storage-failure tests pass.
- Logout/replacement: deferred refresh versus sign-out/logout-all rejects without resurrection; late refresh failure preserves new login.
- Persistence: obsolete underway writes precede successor cleanup; stale failed-write cleanup cannot clear successor credentials.
- Concurrency: obsolete flight finalizer preserves newer single-flight; storage failure does not poison later operations.
- Provider: delayed 401 cannot sign out newer login; old workspace callbacks reject before sending successor credentials to refresh.
- Pending status failure, store replacement/unmount, and same-workspace delayed refresh callback are closure review targets.

Final production patch passed full mobile 49 suites / 322 tests, TypeScript, and lint. Focused controller/provider/API/export suite passed 63 tests. Async assertion registration warnings were removed afterward with assertion helpers, and affected controller/provider suites passed 40 tests. Earlier startup failures were resolved, not waived. Closure review remains coordinator-owned.

## M1b consolidated and implemented

Shared RefreshAuth now accepts optional failedAccessToken preserving its exact synchronous/asynchronous return union. Transport agent snapshots the callback before fetch and passes the actual resolved token. Mobile adapter forwards this contract. Provider registers generation-bound callbacks. SessionLifecycle tracks every accepted token and latest token within one generation, clearing both on identity transitions. Acceptance occurs after persistence and before getMe. Unknown/superseded tokens reject before storage; delayed same-generation old-token 401 reuses latest without refresh. Legacy no-argument handler calls use the current latest token, rejecting if none is accepted.

Regression integration: delayed account-A reminder mutation 401 after B login produces original 401 with zero store reads, refresh calls, or mutation retries; delayed same-generation 401 after rotation retries with latest token and only one refresh. Token-string reuse across generations is covered by callback snapshots plus generation fencing.

Focused controller/provider/API suite: 59 tests passed. Additional tests cover late restore/login/status failure, unknown tokens, no-argument calls, and latest-token reuse. Await final matrix/closure record from coordinator.

## Final direct caller repair

FACT: the original reports export retry directly invoked refreshAccessToken and published its token without original request ownership. The authorized fix now captures generation before token acquisition, checks after acquisition, and calls refreshForRequest(originalToken, generation) before publishing/retrying. Delayed unauthorized export retains the existing failed outcome without reading successor credentials, refreshing, retrying, or publishing its token. A normal active export still refreshes/retries successfully. Three direct regression tests pass.

Coordinator now authorizes bounded reports-domain ownership. Current production direct refreshAccessToken caller inventory is provider getValidToken (generation/client fenced) and reports export retry (this final repair); controller refreshForRequest is the guarded entry point for transport callbacks. Export captures controller.lifecycle generation before getValidToken, asserts after acquisition, calls refreshForRequest(original token, saved generation), and checks generation before token publication/return to exportWithRetry. Preserve the existing failed/token-unavailable export outcome when refresh callback rejects. Regression requirements: delayed export 401 after B login performs no refresh/store read/retry/token publication; normal active export refresh retries successfully. No further discovery or scope expansion.

FACT (coordinator): workspaceStore.set has asynchronous native persistence before final completion. Provider post-await checks alone cannot prevent an old underway set from persisting after its successor. Route provider workspace set/clear through the same ordered lifecycle.storage queue; newer writes follow underway old writes, and stale queued writes skip. Storage module remains unchanged. Verify final workspace with deferred old set and newer connection.

No Astra delegation: user requests Sol 6.1 for all roles. No commits. Record final accepted protocol in architecture delta after closure.

## M1c closure finding

FACT: checkStatus originally merged its actor response into the access-token/token-pair snapshot taken before getMe. A successful concurrent refresh stays in the same generation, so generation fencing alone allowed status completion to overwrite the refreshed pair. A same-generation refresh persistence failure could similarly be overwritten with the old signed-in snapshot.

Fix: after generation assertion, apply the status actor result to the CURRENT authenticated state's token pair. Return current non-authenticated/error state unchanged instead of resurrecting the snapshot. Regressions defer status, complete refresh successfully then apply an inactive actor while retaining new tokens, and separately fail refresh persistence then complete status while retaining error/empty storage. This is the first concrete closure defect and uses the existing protocol without redesign.

## Settled closure

Sol 6.1 security/closure review approved M1, M1b and M1c with no remaining concrete
findings in the consolidated delta. Final standard and Windows mobile runs each
passed 49 suites / 324 tests; mobile types, lint (0 errors / 45 baseline warnings)
and Windows bundle passed. Root checks and unavailable integration checks are
recorded in CONTINUOUS_BUG_AUDIT.md. These results supersede earlier pending
closure and intermediate test results above.
