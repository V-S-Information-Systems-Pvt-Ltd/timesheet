# 01 Shared smart-hours and timesheet contract run in both apps

**What to build:** Establish the three shared package boundaries with the smallest real vertical slice: one smart-hours calculation and the canonical timesheet request/response contract are imported by web and mobile, with both application locations and mobile's native dependency layout unchanged.

**Blocked by:** none, can start immediately.

## Approach

- Record the implementation commit and characterize current web/mobile smart-hours and timesheet-contract differences before moving definitions.
- Add root npm workspaces for `@vsis/core`, `@vsis/contracts`, and `@vsis/client`; keep the mobile lockfile separate and consume shared packages through local `file:` dependencies.
- Move the pure smart-hours implementation to core and the canonical timesheet schemas/DTOs to contracts. Preserve existing public names through temporary re-exports.
- Configure TypeScript, Vitest/Jest, ESLint, Metro, Docker, standalone asset copying, CI, and mobile packaging to include shared sources.
- In `Dockerfile`, copy workspace manifests before `npm ci` and all required package sources before building; prove root and mobile clean installs from their committed lockfiles. Consult installed Next.js `transpilePackages.md` and `output.md`: workspace transpilation is supported, while standalone assets/tracing still require verification. Avoid adding a package compiler or transpilation dependency unless the existing toolchain cannot consume the sources.
- Make Metro watch the external package sources and force React/React Native to resolve from the mobile installation. Do not hoist or duplicate native runtime dependencies.
- Update one web and one mobile production caller for each shared definition, then delete only the corresponding duplicate implementation.

## Acceptance criteria

- [ ] Web and mobile import the same smart-hours implementation and produce identical results for weekday filtering, invalid/zero hours, ties, and conversion from timesheet rows.
- [ ] Web server, browser, and mobile compile against one canonical timesheet input and DTO definition; old imports remain compatible through re-exports.
- [ ] `@vsis/core` and `@vsis/contracts` meet the same 60% lines/functions/statements coverage threshold CI enforces for `lib/**` (extend the Vitest coverage include paths to `packages/**` in this slice); skipped platform coverage does not substitute.
- [ ] Explicit package-path coverage gates enforce that requirement; aggregate branch coverage stays at 50%, and any moved validation/security logic keeps its existing higher per-file thresholds in this slice.
- [ ] Shared-package source contains no Next.js, React Native, database, application, storage, or secret imports.
- [ ] Metro and Jest resolve one mobile-local React runtime and the intended mobile-local native implementation for each platform, including the existing Windows mapping. Record resolved paths/versions for application and shared-package importers. Root React 19.2.4 and mobile React/test-renderer 19.2.3 may remain independent; root has no React Native dependency. Shared packages must not import React or introduce runtime peers. If root React enters the mobile graph, fix resolution rather than upgrading frameworks to force version equality.
- [ ] Docker/standalone builds and Android, iOS, and Windows smoke builds can see shared package sources.

## Verification

```powershell
npx vitest run tests/smart-hours.test.ts tests/mobile-contract-parity.test.ts
Push-Location mobile
npm run typecheck
npm test -- --runTestsByPath __tests__/smart-hours.test.ts __tests__/api-client.test.ts
npm run package:android
npm run package:windows:unsigned
# On a configured macOS runner with CocoaPods and signing provisioned:
npx react-native build-ios --mode Release
Pop-Location
```

Expected: shared behavior/contract tests pass and package builds contain the shared sources. Run the global Docker/standalone and dual-backend gates. Record release-artifact launches on all three mobile platforms with Metro stopped; a development simulator launch alone is insufficient.

## STOP conditions

- Metro requires a second React/React Native copy or package sources cannot be included in a supported native archive.
- Existing web/mobile contract differences are intentional public behavior rather than duplicate declarations.
