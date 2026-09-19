# 05 People and hierarchy behavior is shared end to end

**What to build:** Profiles, capability calculations, reporting hierarchy, and account administration use shared rules/contracts and one application service while preserving the independent permission and hierarchy role axes.

**Blocked by:** 03.

## Approach

- Characterize self-profile, people list, hierarchy, user administration, activation, manager assignment, and capability behavior.
- Move pure role/capability/hierarchy calculations to core; keep provider identity creation and credential lifecycle behind the identity boundary.
- Add the people service and narrow native/Supabase ports, then migrate actions, `/api/data`, `/api/v1`, shared-client operations, and callers.
- Keep server row mapping and provider-auth error handling outside shared packages.
- Preserve compatibility exports until all web/mobile callers use canonical contracts.

## Acceptance criteria

- [ ] Permission role and hierarchy role remain independent and the legacy role mapping remains compatible.
- [ ] Inactive users, self-versus-other access, manager/team-lead visibility, and admin create/update allow/deny behavior match across providers/transports.
- [ ] Capability and hierarchy calculations have one platform-neutral implementation used by web and mobile.
- [ ] Provider identity creation and credentials do not leak into the people persistence port or shared packages.
- [ ] Existing action signatures, response DTOs, and mobile screens remain compatible.

## Verification

```powershell
npx vitest run tests/mobile-people-route.test.ts tests/mobile-admin-user-routes.test.ts tests/hierarchy.test.ts tests/title-aligned-hierarchy.test.ts tests/action-policy.test.ts tests/supabase-repository-authz.test.ts
Push-Location mobile
npm test -- --runTestsByPath __tests__/team-screen.test.tsx __tests__/user-admin-screen.test.tsx __tests__/navigation-modules.test.ts
Pop-Location
```

Expected: both role axes and allow/deny paths are parity-covered through server and mobile consumers.

## STOP conditions

- A people operation cannot be separated from provider credential/session lifecycle without changing its public atomicity promise.
- Existing tests disagree on the canonical permission/hierarchy mapping.
