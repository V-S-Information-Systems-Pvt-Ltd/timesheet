# 04 Reference-data behavior is shared end to end

**What to build:** Projects, activities, and titles use canonical contracts, one application service, domain-specific native/Supabase ports, and the shared client across web and mobile.

**Blocked by:** 03.

## Approach

- Characterize list/create/update/delete and title-impact/reclassification behavior, including role gates, uniqueness, active/inactive filtering, and optional fields.
- Add the reference-data service and narrow provider ports; preserve atomic create-return behavior and provider constraints.
- Route actions, compatibility data endpoints, versioned admin/reference endpoints, and shared-client operations through the service.
- Update web/mobile callers and replace duplicate contract declarations with compatibility re-exports.
- Contract only reference-data methods whose callers have fully migrated; leave unrelated repository methods untouched.

## Acceptance criteria

- [ ] Equivalent reference-data operations have one policy/orchestration owner and identical authorized outcomes across transports/providers.
- [ ] Create operations return the inserted row atomically; duplicate names and optional-field failures do not return or leave the wrong row.
- [ ] Title impact/reclassification preserves both role axes and existing authorization.
- [ ] Web/mobile wire shapes and old import paths remain compatible.
- [ ] Native SQL authorization and Supabase RLS tests cover at least one allow and deny case per operation class.

## Verification

```powershell
npx vitest run tests/mobile-admin-reference-routes.test.ts tests/mobile-contract-parity.test.ts tests/native-repository.test.ts tests/supabase-repository-authz.test.ts tests/title-aligned-hierarchy.test.ts
Push-Location mobile
npm test -- --runTestsByPath __tests__/reference-admin-screens.test.tsx __tests__/project-selection.test.tsx
Pop-Location
```

Expected: contract, route, repository, and mobile consumer tests pass with no replaced declarations still authoritative.

## STOP conditions

- User creation is found to share the same transactional semantics as reference data only by weakening provider-auth behavior; keep it in the people/identity slices.
- Provider uniqueness or title-role semantics differ from the characterized public behavior.
