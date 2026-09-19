# 07 Reporting behavior is shared end to end

**What to build:** Scoped aggregates, dashboard reporting, pagination, filters, and CSV export use one reporting service and canonical contracts while remaining RLS/SQL scoped.

**Blocked by:** 03.

## Approach

- Characterize personal/team/admin scopes, date filters, grouping, pagination, totals, CSV headers/content, and empty/error behavior.
- Add a reporting service and explicit read ports; preserve optimized provider queries instead of forcing a generic query abstraction.
- Route actions/pages, compatibility endpoints, versioned endpoints, and shared-client calls through the service.
- Share query schemas, DTOs, filtering/reducer logic, and CSV-neutral calculations; keep browser/native file delivery platform-specific.
- Retain request cancellation/stale-response protection and server-side scope enforcement.

## Acceptance criteria

- [ ] Equivalent filters and scopes produce matching totals/buckets through web and mobile transports on both providers.
- [ ] Pagination cannot omit or duplicate rows and stale responses cannot replace a newer query.
- [ ] Ordinary users cannot access other users' aggregates through service-role or unscoped queries.
- [ ] CSV contents match on-screen scope/filter semantics while download/file-save mechanisms remain platform-local.
- [ ] Existing report URLs, query fields, response envelopes, and empty/error states remain compatible.

## Verification

```powershell
npx vitest run tests/reports.test.ts tests/reports-route.test.ts tests/reports-export-route.test.ts tests/mobile-reports-route.test.ts tests/mobile-admin-reports-export-route.test.ts tests/data-client-pagination.test.ts tests/supabase-repository-authz.test.ts
Push-Location mobile
npm test -- --runTestsByPath __tests__/reports-screen.test.tsx __tests__/privileged-reports-screen.test.tsx __tests__/report-file-export.test.ts
Pop-Location
```

Expected: scoped totals, pagination, exports, and platform-specific delivery tests pass without privileged read expansion.

## STOP conditions

- A shared aggregate would require service-role access for ordinary-user reporting or a `SECURITY DEFINER` RPC not covered by a separate security design.
- Provider pagination cannot guarantee complete/stable results under the existing public contract.
