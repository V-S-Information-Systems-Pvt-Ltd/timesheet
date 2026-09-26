# Dual-backend modular remediation plan

**Status:** ready for execution

**Executor:** Codex `gpt-5.6-luna`, reasoning effort `max`

**Reviewed baseline:** `3e71858` on `arch/dual-backend-modular-implementation`

**Parent plan:** `docs/plans/archive/dual-backend-modular-implementation/PLAN.md`

**Execution notes:** `docs/plans/archive/dual-backend-modular-remediation/NOTES.md`

## Objective

Close the remaining correctness, security, and evidence gaps without changing the dual-backend architecture, public action names, `/api/v1` URLs, released response shapes, provider choice, or RLS model. Preserve the native implementation while making Supabase public registration follow provider-owned email-confirmation semantics, make required live gates fail closed, and make each mobile release mode test only runnable artifacts.

This is a remediation of the existing implementation, not another architecture migration. Work in the slices below, keep each slice reviewable, and update `NOTES.md` after every verification attempt. Do not claim the parent plan complete while a required provider, browser, or platform check is skipped.

## Starting state and ownership

- Preserve the existing user-owned worktree changes in `AGENTS.md`, `docs/README.md`, `.serena/`, `.ua/intermediate/`, `docs/ai-context/`, and `docs/plans/archive/MAINTAINABILITY_IMPLEMENTATION_PLAN.md`. Do not stage, rewrite, or remove them unless the execution task explicitly expands scope.
- Re-check `git status --short` and `git log -8 --oneline --decorate` before editing. If HEAD is no longer `3e71858`, review the intervening diff and amend this plan before applying stale edits.
- Use the current source as authoritative. The review used the new context hierarchy, but Atlas, Serena, and RTK were unavailable in the review environment; all conclusions below were verified against current files and focused tests rather than inferred from an index.
- Do not add dependencies, migrations, generic repository abstractions, or new public response fields for these fixes.
- Do not commit or push unless the execution request explicitly authorizes it. If commits are authorized, use Conventional Commits and keep remediation slices independently revertible.

## Review findings

| Priority | Finding | Plan contract affected | Evidence |
|---|---|---|---|
| P1 | Public server signup creates a caller-chosen Supabase password with the service role and `email_confirm: true`. Local Supabase configuration also disables email confirmation. This bypasses ownership verification and lets an attacker pre-register another address on an auto-activated domain. | Slice 10 requires provider semantics and limits service-role use to documented privileged identity operations. | `lib/auth/registration-supabase.ts:51-54`; `supabase/config.toml:225`; both public signup routes call this port. |
| P1 | Manual Android `unsigned` mode builds an APK with no certificate and then unconditionally attempts `adb install`. Android rejects that artifact, so a supported workflow input cannot pass. | Slice 01 requires real platform launch evidence, while missing identity/signing must not be replaced by throwaway credentials. | `.github/workflows/mobile-release.yml:70-77`; `mobile/package.json` maps the mode to `package-android.js --unsigned`. |
| P2 | The live Supabase suite conditionally skips its authenticated HTTP isolation and concurrency cases when the anon key is absent. The CI step does not declare that HTTP evidence is mandatory, so a partially configured job can pass without the required RLS proof. | Global verification explicitly says a skipped provider check is not success and mocks cannot close the live RLS gate. | `tests/supabase-live-rls.int.test.ts:465,491`; `.github/workflows/ci.yml` live Supabase step. |
| P2 | Supabase matrix seeding whitelists only `vsis.lk` before Auth creation, but appends the configured `E2E_EMAIL` afterward. A fresh stack using a different E2E domain fails in `handle_new_user`. | The seeded Supabase browser/live matrix must work with its configured fixtures. | `scripts/seed-supabase-matrix.mjs:28-31,50-55`. |

No additional architecture-boundary regression was found in the reviewed implementation. Root typecheck, lint, 1,277 unit tests, 266 mobile tests, both backend production builds, workflow YAML parsing, and script syntax had passed in the preceding review. Those results are baseline evidence only; rerun the affected gates after remediation.

## Decisions

1. Public Supabase registration uses an anonymous, server-only Supabase Auth client and `auth.signUp`; it never uses `auth.admin.createUser`, never force-confirms the address, and never returns an Auth session or token.
2. `isActive` continues to mean application-profile activation. Email ownership confirmation is a separate provider state represented internally so the existing response shape can remain stable and its message can be truthful.
3. Supabase email confirmation is the recommended required deployment setting. Set the local test configuration to require confirmation and prove the pending-to-confirmed flow. If production intentionally disables confirmation, stop for a security/product decision; do not restore admin force-confirmation.
4. Service-role access may remain for the narrow whitelist and duplicate-profile reads. It must not perform the untrusted identity-creation write.
5. A dedicated `SUPABASE_LIVE_REQUIRED=true` flag makes live-provider prerequisites mandatory only in the explicit CI live step. Ordinary unit jobs and local runs without a Supabase stack may still skip the suite visibly.
6. An unsigned Android release artifact receives structure checks only. Emulator installation and launch remain mandatory for signed mode; never sign the release artifact with a temporary/debug key to make the smoke test pass.

## Slice R1 — Restore safe Supabase registration semantics

**Files:**

- `lib/auth/registration.ts`
- `lib/auth/registration-supabase.ts`
- `lib/auth/registration-service.ts`
- add `lib/supabase/public.ts` if no existing server-only anonymous client cleanly fits
- `supabase/config.toml`
- `tests/registration-contract-parity.test.ts`
- `tests/signup-route.test.ts`
- `tests/mobile-signup-v1-route.test.ts`
- `tests/identity-boundary.test.ts`
- add `tests/supabase-live-registration.int.test.ts`

**Implementation:**

1. Add a server-only anonymous Supabase client factory using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, with token refresh and persistence disabled. Create one client per operation; keep it separate from the cookie-writing server client and the service-role admin client.
2. Replace `auth.admin.createUser({ email_confirm: true })` in `supabaseRegistrationPort.registerIdentity` with anonymous `auth.signUp({ email, password, options: { data: { name } } })`.
3. Extend the internal `RegisteredIdentity` result with an optional confirmation requirement derived from whether Supabase returned a session. If a session is returned, treat it as a provider-configuration failure, sign out the request-local client, delete the just-created identity/profile, and fail closed. Do not expose provider tokens or add a public field.
4. Make `registerUser` return a truthful message for an active-but-unconfirmed Supabase identity, while retaining the existing `success`, `isActive`, and route envelope shapes. Native messages and behavior remain unchanged.
5. Preserve duplicate/error mapping. Explicitly test the existing-account race and generic provider failure without leaking provider internals.
6. Set local Supabase email Auth confirmation on. Add a live test that creates a whitelisted fixture through the anonymous path, verifies no session and failed password login before confirmation, confirms the fixture through the Admin API, verifies login then succeeds, and cleans up the Auth/profile/domain rows.
7. Add a boundary assertion that the public registration adapter contains no `auth.admin.createUser`, `email_confirm: true`, service-role identity creation, or token response.

**Focused verification:**

```powershell
npx vitest run tests/registration-contract-parity.test.ts tests/signup-route.test.ts tests/mobile-signup-v1-route.test.ts tests/identity-boundary.test.ts
$env:SUPABASE_LIVE_REQUIRED = 'true'
npx vitest run tests/supabase-live-registration.int.test.ts
Remove-Item Env:SUPABASE_LIVE_REQUIRED -ErrorAction SilentlyContinue
```

**Expected:** all focused tests pass; the live registration test runs with zero skips; a new Supabase identity cannot authenticate before email confirmation; native signup behavior and both HTTP response shapes remain compatible.

## Slice R2 — Make Supabase fixtures and live gates fail closed

**Files:**

- `scripts/seed-supabase-matrix.mjs`
- `tests/supabase-live-rls.int.test.ts`
- `.github/workflows/ci.yml`

**Implementation:**

1. Construct `usersToSeed` before creating any Auth identity. Normalize and validate every fixture email, derive the distinct domains, and upsert all of them into `public.whitelisted_domains` before `listUsers`, `updateUserById`, or `createUser` executes.
2. Keep deterministic users and the configured E2E account idempotent. Do not broaden public RLS access to the whitelist table.
3. In the explicit live suite, when `SUPABASE_LIVE_REQUIRED=true`, fail at setup with a message naming every missing prerequisite: `TEST_DATABASE_URL`, Supabase URL, anon key, and service-role key. Under that flag, the authenticated HTTP isolation and concurrency tests must not use `skipIf` as a fallback.
4. Set `SUPABASE_LIVE_REQUIRED=true` in the CI live Supabase step. Add a small preflight in that step or the test helper so malformed/empty exported values fail before Vitest can report a skipped success.
5. Exercise custom-domain seeding in CI by overriding only the seed step's `E2E_EMAIL` with a non-`vsis.lk` fixture. The deterministic `admin@vsis.lk` user remains available for the subsequent browser matrix.

**Focused verification:**

```powershell
node --check scripts/seed-supabase-matrix.mjs
$env:E2E_EMAIL = 'matrix.e2e@matrix-fixture.test'
node scripts/seed-supabase-matrix.mjs
$env:SUPABASE_LIVE_REQUIRED = 'true'
npx vitest run tests/supabase-live-rls.int.test.ts tests/supabase-live-registration.int.test.ts
```

Run once with one required variable intentionally unset in a disposable shell and require a non-zero exit naming that variable. Restore the invoking shell environment afterward.

**Expected:** the custom-domain Auth user is created on a fresh local stack; both live suites run with zero skips; authenticated PostgREST allow/deny, concurrent daily-hour enforcement, restore commit/rollback, and registration confirmation all pass; missing live prerequisites fail the gate.

## Slice R3 — Make Android release smoke mode-correct

**Files:**

- `.github/workflows/mobile-release.yml`

**Implementation:**

1. Keep size/archive-integrity inspection and artifact upload for both Android modes.
2. Gate the emulator install/launch step with `if: env.RELEASE_MODE == 'signed'`.
3. Add an explicit unsigned-mode result stating that the artifact is structure-tested only because Android cannot install an APK with no certificate. Do not call that result launch evidence.
4. Preserve the permanent-keystore fail-closed checks for signed tag and signed dispatch builds. Do not generate an ephemeral keystore and do not mutate the unsigned release artifact.
5. Confirm the iOS and Windows jobs retain their existing mode-specific signing and launch behavior; make no unrelated workflow refactor.

**Focused verification:**

```powershell
node -e "const fs=require('fs'); const YAML=require('yaml'); YAML.parse(fs.readFileSync('.github/workflows/mobile-release.yml','utf8')); console.log('mobile-release.yml valid')"
Push-Location mobile
npm run package:android:unsigned
Pop-Location
```

Then dispatch both workflow modes. Unsigned mode must pass Android structure validation without attempting `adb install`; signed mode must build with the permanent keystore and pass emulator install, launch, and process-liveness checks.

## Slice R4 — Re-run and close the parent plan’s open evidence gates

**Depends on:** R1, R2, R3.

1. Run focused tests first, then root lint, typecheck, unit tests, coverage, and both production builds. Run mobile lint, typecheck, and tests.
2. Against disposable native PostgreSQL and local Supabase, run Playwright E2E and accessibility separately with `CI=true`, building and testing one backend before replacing `.next/standalone` with the other build.
3. Run live Supabase registration/RLS/restore with `SUPABASE_LIVE_REQUIRED=true` and record test counts plus zero skips.
4. On real GitHub runners, capture Android signed launch and unsigned structure-only results, iOS release archive plus bundled Simulator launch, and Windows signed MSIX signature/install/launch. Record workflow run URLs and artifact names in `NOTES.md`.
5. Re-run the Docker/standalone native exercise if an affected shared/server path changed. Preserve the prior exactly-once create/replay/list/duplicate/batch-delete checks.
6. Capture the parent plan’s still-missing before/after endpoint latency and error-rate observations using the existing benchmark/logging facilities. Do not add a telemetry platform. If no trustworthy pre-remediation baseline exists, record that limitation and collect a reproducible current baseline; do not invent a comparison.
7. Review the final diff for secrets, token leakage, changed public envelopes, backend parity, and accidental edits to the user-owned starting changes.

**Standing verification:**

```powershell
npm run lint
npm run typecheck
npm test
npm run test:coverage

$env:NEXT_PUBLIC_BACKEND = 'supabase'
npm run build
npm run e2e
npm run a11y

$env:NEXT_PUBLIC_BACKEND = 'native'
npm run build
npm run e2e
npm run a11y

Push-Location mobile
npm run lint
npm run typecheck
npm test
Pop-Location

git diff --check
git status --short
```

Use the parent plan’s disposable-database setup and environment-isolation requirements. A command that skips, targets an unproven database, or reuses a stale server does not close its gate.

## STOP conditions

Stop the affected slice, write the evidence and exact blocker to `NOTES.md`, and request a plan decision if:

- the deployed Supabase project intentionally disables email confirmation, or anonymous `signUp` cannot preserve ownership verification without changing the released signup contract; do not fall back to admin force-confirmation;
- a public signup response would need to expose an access token/session or conflate profile activation with email confirmation;
- a fix requires weakening RLS, granting `anon` direct whitelist reads, or moving ordinary-user work to the service role;
- the target database or Supabase project cannot be proven disposable;
- unsigned Android launch evidence is requested without a separately identified installable, non-release smoke artifact; do not debug-sign the release artifact;
- a signed mobile job lacks its permanent keystore/certificate/profile/team secrets;
- a public route, Server Action, DTO, or released mobile response shape must break;
- baseline drift or user-owned worktree changes overlap the planned files in a way that cannot be preserved safely.

Unavailable credentials, providers, SDKs, or hosted runners leave the corresponding gate open. They do not authorize a weaker substitute or a completion claim.

## Acceptable finish

The remediation is complete only when:

- neither public signup route can force-confirm a caller-supplied Supabase identity, and the live confirmation flow proves login is denied before verification;
- native signup behavior and all existing public response shapes remain compatible;
- custom-domain Supabase fixtures seed on a fresh stack;
- required live Supabase tests fail on missing prerequisites and pass with zero skips when configured;
- Android unsigned mode passes structure checks without attempting installation, while signed mode passes permanent-key signing and emulator launch;
- both-backend E2E/accessibility and required Android/iOS/Windows runner evidence are recorded, with skipped checks still marked open;
- root/mobile quality gates and affected backend builds pass; and
- `NOTES.md` contains commands, results, test counts, workflow links/artifacts, deviations, and the final open/closed status of every parent-plan gate.

## Plan review

| Dimension | Score | Evidence |
|---|---:|---|
| Completeness | 5/5 | Covers all four current findings, parent-plan runtime gaps, rollback-safe ordering, notes, and finish criteria. |
| Feasibility | 5/5 | Reuses existing registration ports, Supabase clients, CI matrix, release workflow, and test frameworks; no schema or dependency change is required. |
| Testability | 5/5 | Every behavior has focused checks, explicit failure-mode probes, zero-skip requirements, standing gates, and hosted-runner evidence. |
| Clarity | 5/5 | Names exact files, ordering, decisions, expected results, and ownership boundaries. |
| Risk awareness | 5/5 | Protects email ownership, RLS, service-role scope, release signing, disposable targets, public contracts, and user-owned changes. |

**Disposition:** ready for Luna Max execution. Start with R1 and R2; R3 may run independently; do not begin final evidence closure until all three code/workflow slices pass focused review.
