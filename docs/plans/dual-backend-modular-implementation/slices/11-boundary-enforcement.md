# 11 Shared-client adoption is complete and enforced

**What to build:** Finish migration of equivalent platform-neutral client logic, remove obsolete duplicate/backend-selecting implementations, and enforce package/server/platform dependency boundaries in CI.

**Blocked by:** 03, 04, 05, 06, 07, 08, 09, and 10.

## Approach

- Inventory remaining duplicate contracts, date/hierarchy/capability/validation logic, backend-selecting browser calls, and platform-neutral reducers/controllers.
- Move only behavior with matching semantics into the existing shared packages. Controllers use callback interfaces, not React setters, navigation, or storage.
- Convert old contract/helper paths to compatibility re-exports, migrate all callers, then remove exports whose compatibility window has ended.
- Add lint/import tests for package dependency direction, frontend database imports, shared-package server/platform imports, and cross-domain private adapter imports.
- Extend root/mobile coverage to relocated packages and services; remove temporary exclusions rather than lowering thresholds.
- Search for obsolete direct browser Supabase/data-backend selection and legacy private imports before contracting compatibility adapters.

## Acceptance criteria

- [ ] Canonical contracts and equivalent pure business/client logic each have one definition and public export.
- [ ] Browser application data access contains no backend selection or direct Supabase data queries; provider-specific browser auth remains behind the auth facade.
- [ ] Shared packages contain no server, database, secret, React Native, navigation, or storage imports and follow core → contracts → client dependency direction.
- [ ] Compatibility adapters/re-exports remain only where a documented released caller still needs them; every removal has a repository-wide zero-caller check.
- [ ] Coverage includes shared packages and relocated services without reducing existing aggregate or security-sensitive thresholds.
- [ ] Web/mobile UI, offline queue schema/isolation/retry behavior, secure storage, date presentation, and file export remain platform-specific and regression-tested.

## Verification

```powershell
rg -n "NEXT_PUBLIC_BACKEND|createClient|from ['\"].*supabase" app lib/data mobile/src --glob '!**/*.test.*'
npm run lint
npm run typecheck
npm test
npm run test:coverage
$env:NEXT_PUBLIC_BACKEND = 'supabase'; npm run build
$env:NEXT_PUBLIC_BACKEND = 'native'; npm run build
Push-Location mobile
npm run lint
npm run typecheck
npm test
Pop-Location
```

Expected: search results are limited to approved auth/server/provider boundaries, all gates pass, and coverage reports include every shared package and relocated service.

## STOP conditions

- A candidate shared controller requires platform branching or changes offline/storage/navigation semantics.
- Removing a compatibility surface would break a supported released client or an un-migrated server path.
- Boundary enforcement reports legitimate imports that reveal the proposed dependency direction is incomplete; amend the plan rather than blanket-whitelisting them.
