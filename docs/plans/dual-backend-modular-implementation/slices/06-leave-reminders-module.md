# 06 Leave and reminder behavior is shared end to end

**What to build:** Personal and administrative leave, reminders, and global reminders use canonical contracts, one application service, domain-specific persistence, and shared client operations.

**Blocked by:** 03.

## Approach

- Characterize personal/admin visibility, create/update/delete, completion/dismissal, inactive-user, date, and role behavior.
- Add the leave/reminders service and provider ports, keeping notification delivery/platform presentation outside the domain.
- Route actions, compatibility endpoints, versioned endpoints, and web/mobile clients through the service.
- Move shared validation/state transitions into core/contracts only when equivalent on both clients.
- Preserve the current keyed offline-mutation protocol for leave and reminder writes: immutable provider effect evidence, canonical payload conflict checks, authorization rechecks before stored replay, fail-closed recovery, and write-budget release on duplicate or failed deliveries.
- Remove duplicate declarations and orchestration only after transport and provider parity is proven.

## Acceptance criteria

- [ ] Personal users cannot read or mutate another user's leave/reminders; administrative scopes match across providers.
- [ ] Global reminder creation, update, deletion, visibility, and per-user dismissal retain released behavior.
- [ ] Date validation and reminder state transitions have one authoritative server implementation and equivalent client feedback.
- [ ] Error envelopes, action signatures, endpoint URLs, and mobile DTOs remain compatible.
- [ ] Allow/deny and failure rollback cases pass against native PostgreSQL and Supabase RLS.
- [ ] Keyed leave/reminder retries preserve same-payload replay, different-payload conflict, immutable-effect recovery, replay reauthorization, and exactly-once write-budget charging.

## Verification

```powershell
npx vitest run tests/leaves-route.test.ts tests/reminders-route.test.ts tests/mobile-leaves-route.test.ts tests/mobile-reminders-route.test.ts tests/mobile-global-reminders-route.test.ts tests/mobile-admin-operational-routes.test.ts tests/idempotency-stamp-recovery.test.ts tests/supabase-repository-authz.test.ts
Push-Location mobile
npm test -- --runTestsByPath __tests__/leaves-screen.test.tsx __tests__/reminders-screen.test.tsx
Pop-Location
```

Expected: personal/admin scenarios, keyed replay/conflict/reauthorization behavior, and transport compatibility pass for both domains and providers.

## STOP conditions

- Leave and reminder operations require different transaction/security lifecycles that make a combined module hide invariants; split this ticket before implementation continues.
- Moving a keyed mutation cannot retain same-transaction effect evidence, canonical conflict detection, replay reauthorization, or exactly-once budget accounting.
- Notification side effects cannot be kept outside the persistence transaction without changing acknowledged behavior.
