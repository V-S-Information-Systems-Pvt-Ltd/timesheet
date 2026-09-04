# Mobile Code Review Findings Fix Plan

## Purpose

Resolve the findings from the review of `mobile-dev` at `0a7e58d`:

1. replace plaintext refresh-token persistence with genuine platform credential
   storage;
2. make secure-storage failures explicit and safe across session lifecycle
   operations;
3. correct the workspace security- and code-review instructions so they cannot
   approve insecure storage or reject valid streaming/tooling code; and
4. make the Windows bundler honor a valid nonstandard `pwsh.exe` installation
   already present on `PATH`.

This plan does not enable the report-export controls, authorize a Supabase
migration, or satisfy any Android/iOS/Windows evidence gate from
`MOBILE_ADMIN_CUSTOMIZATION_AND_PARITY_PLAN.md`.

## Implementation status

This working-tree change implements S0, the JavaScript side of S1, S4, the
legacy-cleanup hook in S5, and S7. S2/S3 still require native Android Keystore,
iOS Keychain, and Windows PasswordVault modules plus installed-build evidence;
S5's operator session revocation is intentionally not automated. S6 remains
blocked because `.agents/skills/` is read-only in this workspace.

## Reviewed baseline

- Branch: `mobile-dev`; reviewed HEAD: `0a7e58d`.
- `createTokenStore()` selects `DurableTokenStore` in production.
- `DurableTokenStore` serializes the refresh token and session ID to plaintext
  `localStorage` or `vsis-timesheet-tokens.json`, swallows storage failures, and
  can silently degrade to memory-only behavior.
- `mobile/docs/secure-storage-spike.md` explicitly prohibits token persistence
  in files, browser storage, SQLite, or other non-credential stores.
- `/api/v1/config` currently advertises `bearerAuth: true` even though native
  secure-storage proof remains pending.
- `MemoryTokenStore` is used extensively by tests, but the new security-review
  skill describes it as acceptable platform-secure storage.
- The code-review skill requires a JSON envelope for every REST v1 response,
  although `/api/v1/reports/export` deliberately returns streamed CSV or 204.
- The code-review skill prohibits Node built-ins anywhere below `mobile/`, which
  also covers legitimate Node-only scripts in `mobile/scripts/`.
- `mobile/scripts/bundle-windows.js` searches only fixed Program Files paths;
  its error message incorrectly claims that adding `pwsh.exe` to `PATH` works.

## Security and rollout invariants

- Persist only the opaque refresh token and non-secret session ID. Access tokens
  remain in process memory.
- Android uses a Keystore-backed credential mechanism, iOS uses Keychain with
  device-only accessibility, and Windows uses PasswordVault or an equivalent OS
  credential locker.
- Production must never persist refresh tokens in `localStorage`, AsyncStorage,
  SQLite, a plain file, Redux persistence, logs, telemetry, or crash reports.
- Production must not silently fall back to `MemoryTokenStore`. An unavailable,
  locked, corrupt, or failed credential store is a visible session error.
- If login creates a server session but secure persistence fails, revoke that
  session before returning to signed-out/error state.
- Existing plaintext refresh tokens are not migrated into the secure store.
  Delete the legacy data and require a new login because confidentiality of the
  old token cannot be assumed.
- Keep public bearer rollout disabled until all three platforms have recorded
  installed-build write/read/delete and process-restart evidence.
- Do not claim iOS evidence from the current Windows host. Use an authorized
  macOS/EAS/TestFlight runner and record its artifact.
- No dependency is adopted until its React Native 0.84, new-architecture,
  Android, iOS, and maintenance status is documented. If no maintained package
  supports Windows, implement the small Windows PasswordVault bridge locally.

## Implementation order

### S0. Contain the current plaintext-token risk

1. Add an explicit server rollout flag for bearer mobile authentication,
   defaulting to disabled until secure-storage acceptance is complete.
2. Make `/api/v1/config` derive `capabilities.bearerAuth` from that fail-closed
   flag instead of returning `true` unconditionally.
3. Preserve the existing client check that blocks sign-in when the capability
   is false, and add a regression test proving no login request is sent.
4. Document the temporary rollout state in `.env.example` and the mobile setup
   guide without including credentials or target-specific secrets.

Exit criteria:

- A default deployment does not advertise bearer authentication as ready.
- Explicit enablement has a single documented environment/configuration path.
- Config-route and mobile sign-in tests cover both disabled and enabled states.

### S1. Finalize the secure-storage adapter contract

Refine `SecureTokenStore` so storage failures cannot be mistaken for an empty
session:

- define stable failures for unavailable, locked, corrupt, read, write, and
  delete operations;
- require `write()` to resolve only after the OS credential store confirms the
  write;
- distinguish `read() -> null` (no credential exists) from a read failure;
- require `clear()` to report failure so logout can surface incomplete local
  cleanup; and
- keep the stored payload versioned so malformed or future payloads fail closed.

Move `MemoryTokenStore` to `mobile/test-utils/` and update tests to import it
from there. It must not be exported by the production secure-storage barrel or
selected by `createTokenStore()`.

Add contract tests shared by every native adapter for:

- empty read;
- write/read round-trip;
- overwrite;
- delete;
- corrupt payload;
- unavailable/locked credential store; and
- absence of access-token persistence.

### S2. Implement Android and iOS credential adapters

Run the dependency compatibility spike before changing `mobile/package.json`:

1. record the candidate package and exact pinned version;
2. verify React Native 0.84 and new-architecture support from maintained source
   and a minimal native build;
3. record required Android/iOS native configuration and accessibility options;
4. confirm the dependency stores secrets through Android Keystore and Apple
   Keychain rather than AsyncStorage; and
5. stop for a product/maintainer decision if the candidate is abandoned,
   unmaintained, or requires an unsupported native fork.

Implement adapters behind the `SecureTokenStore` interface:

- Android: Keystore-backed credential entry scoped to this application.
- iOS: generic-password Keychain entry using device-only accessibility where
  supported.
- Use stable service/account names so upgrades read the same credential.
- Map native cancellation, locked-device, unavailable-service, corrupt-value,
  and write/delete errors into the S1 error contract.
- Never include token values in error messages.

### S3. Implement the React Native Windows PasswordVault adapter

Create an owned React Native Windows 0.84 native module when the selected
Android/iOS dependency does not provide maintained Windows support.

Requirements:

- use `Windows.Security.Credentials.PasswordVault` (or an approved equivalent);
- expose only read, write, and delete operations required by
  `SecureTokenStore`;
- use the same stable service/account naming policy as the other platforms;
- register the native module in the Windows project without editing generated
  autolinking output by hand unless the React Native Windows template requires
  it;
- return stable error codes and never token text; and
- build and test Debug and Release x64 configurations.

### S4. Integrate secure failures with session lifecycle behavior

Update the session controller/provider flow so that:

- successful login becomes authenticated only after the refresh token is
  securely persisted;
- a persistence failure triggers best-effort server-session revocation, clears
  all in-memory auth state, and returns a stable signed-out error;
- refresh rotation persists the replacement before discarding the usable local
  state, with deterministic recovery if persistence fails;
- logout, logout-all, refresh-reuse detection, account deactivation, and forced
  disconnect clear the credential entry;
- credential read failures do not appear as a normal signed-out/no-session
  result; and
- workspace URL persistence remains separate because it is not secret.

Add tests for login-write failure, refresh-write failure, failed cleanup,
revoked/reused refresh tokens, process restart, and concurrent session actions.

### S5. Remove legacy plaintext credentials and perform the cutover

Add a one-time, idempotent legacy cleanup that deletes without reusing or
migrating:

- `localStorage['vsis_timesheet_secure_tokens']`; and
- `%LOCALAPPDATA%/vsis-timesheet-tokens.json` or the corresponding legacy path.

The cleanup must not log the file contents and must tolerate an absent file.
Record cleanup failure separately from secure-store state and keep the user
signed out until it is resolved.

Because existing plaintext refresh tokens may already have been copied, the
release runbook must include an authorized cutover action that revokes all
pre-cutover mobile sessions. This is an operator action, not an application
migration: record target, timestamp, approver, affected session count, and
post-action probe. Do not execute it as part of implementation without explicit
authorization.

Only after S1-S5 tests and all platform evidence pass may the bearer rollout
flag be enabled in a target environment.

### S6. Correct the workspace review skills

Update `.agents/skills/security-review/SKILL.md` to:

- label `MemoryTokenStore` as test-only;
- require Keystore/Keychain/PasswordVault-backed production storage;
- explicitly reject `localStorage`, AsyncStorage, plaintext files, SQLite, and
  silent memory-only production fallback;
- require login-session revocation after secure-write failure; and
- add a check that bearer rollout remains disabled until platform proof exists.

Update `.agents/skills/code-review/SKILL.md` to:

- require `{ data, error, meta }` only for JSON REST responses;
- recognize documented streaming/download success contracts such as CSV/204,
  while retaining JSON error-envelope checks;
- prohibit Node built-ins in React Native runtime feature modules, not in
  Node-only build and packaging scripts; and
- require runtime code to reach platform behavior through
  `mobile/src/platform/` abstractions.

Exit criteria:

- the security skill cannot describe an in-memory or plaintext store as secure;
- the code-review skill does not flag `/api/v1/reports/export` for its valid CSV
  response; and
- `mobile/scripts/*.js` remains eligible to use Node APIs while bundled mobile
  code does not.

### S7. Honor `pwsh.exe` from PATH in the Windows bundler

Refactor `mobile/scripts/bundle-windows.js` so PowerShell resolution is testable
without launching Metro:

1. inspect the inherited Windows `PATH` for an existing `pwsh.exe` first;
2. handle quoted entries, empty entries, and case-insensitive `Path`/`PATH` keys;
3. fall back to the current standard Program Files locations;
4. prepend the resolved directory only when it is not already present;
5. retain non-Windows behavior unchanged; and
6. make the failure message describe the paths actually checked.

Add tests for a custom PATH installation, standard Program Files fallback,
duplicate/case-varied entries, and a missing executable. Then run a fresh
Windows bundle with both the normal environment and a controlled custom-PATH
fixture.

## Platform evidence gate

Update `mobile/docs/secure-storage-spike.md` with exact commands, versions, and
artifacts. Each target must demonstrate:

| Target | Required evidence |
| --- | --- |
| Android | Installed development/preview build; write/read/delete; full process termination and restore; logout deletion |
| iOS | Registered-device/TestFlight build; Keychain accessibility recorded; write/read/delete; process termination and restore |
| Windows | Debug and Release x64 build; PasswordVault write/read/delete; process termination and restore; logout deletion |

Mocked Jest tests, a Metro bundle, and a successful compile do not count as
installed-device credential-storage evidence.

## Verification

Run focused checks while implementing:

```powershell
npx vitest run tests/mobile-config-route.test.ts tests/mobile-login-route.test.ts tests/mobile-refresh-route.test.ts tests/mobile-logout-route.test.ts tests/mobile-session-store.test.ts
npm --prefix mobile test -- --runInBand __tests__/secure-token-store.test.ts __tests__/session-controller.test.ts __tests__/session-provider.test.tsx __tests__/sign-in-screen.test.tsx
npm --prefix mobile run typecheck
npm --prefix mobile run lint
npm --prefix mobile run test:windows
npm --prefix mobile run bundle:windows
rg -n "localStorage|vsis-timesheet-tokens\.json|getNodeFs|AsyncStorage" mobile/src/platform/secure-storage mobile/src/auth
rg -n "MemoryTokenStore" mobile/src
git diff --check
```

Expected static results after the cutover:

- no production secure-storage/auth module contains the legacy browser/file
  persistence identifiers;
- `MemoryTokenStore` has no import or export below `mobile/src/`; and
- no generated bundle or packaged binary contains a literal refresh token,
  credential value, or signing secret.

Then run the repository matrix:

```powershell
npm run lint
npm run typecheck
npm test
npm --prefix mobile run lint
npm --prefix mobile run typecheck
npm --prefix mobile test -- --runInBand
$env:NEXT_PUBLIC_BACKEND="supabase"; npm run build
$env:NEXT_PUBLIC_BACKEND="native"; npm run build
git diff --check
```

Database integration, Android installed-build, iOS installed-build, Windows
installed-build, and operator revocation evidence must be reported separately;
do not infer them from unit tests or bundles.

## Recommended commit sequence

1. `fix(auth): gate mobile bearer rollout pending secure storage`
2. `refactor(mobile): define fail-closed secure storage contract`
3. `feat(mobile): add Android and iOS credential adapters`
4. `feat(windows): add PasswordVault token adapter`
5. `fix(auth): handle secure storage failures and legacy cleanup`
6. `test(mobile): verify secure token lifecycle contracts`
7. `fix(skills): align review rules with runtime contracts`
8. `fix(windows): resolve pwsh from inherited path`
9. `docs(mobile): record secure storage and cutover evidence`

Keep the review-skill and bundler fixes independent from the secure-storage
cutover. Do not enable bearer rollout or perform the operator revocation until
the corresponding acceptance gates are satisfied.

## Final acceptance checklist

- [ ] Production refresh tokens are stored only in OS-backed credential stores.
- [ ] Access tokens remain memory-only.
- [ ] No plaintext or silent memory-only production fallback remains.
- [ ] Storage failures are explicit and login-write failure revokes the server
      session.
- [ ] Legacy plaintext credentials are deleted and never migrated forward.
- [ ] Pre-cutover mobile sessions are revoked by an authorized, recorded
      operator action.
- [ ] Android, iOS, and Windows installed-build evidence is attached.
- [ ] Bearer rollout remains disabled until the evidence gate passes.
- [ ] Review skills correctly handle test-only storage, streaming REST success
      responses, and Node-only mobile tooling.
- [ ] Windows bundling accepts both inherited-PATH and standard PowerShell 7
      installations.
- [ ] Focused tests, full tests, lint, typecheck, dual-backend builds, Windows
      bundle, and `git diff --check` pass with fresh output.
