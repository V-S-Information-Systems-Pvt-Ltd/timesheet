# 10 Identity lifecycle has an explicit infrastructure boundary

**What to build:** Login, signup, refresh, logout, password change/recovery, revocation, and session lifecycle use explicit identity interfaces while preserving native and Supabase provider semantics.

**Blocked by:** 01.

## Approach

- Characterize every web/mobile and native/Supabase authentication permutation, including feature gates, revocation, inactive users, cookie renewal, bearer refresh, and provider/application session interaction.
- Define canonical identity inputs/errors/capabilities in contracts, but keep tokens, cookies, secure storage, provider clients, and credential hashing in infrastructure.
- Inject provider/session dependencies into identity operations; keep Request/cookie parsing and HTTP response/cookie writing in adapters.
- Preserve explicit bearer precedence, request-scoped RLS binding, origin checks, rate limits, and timing-safe password behavior.
- Migrate one lifecycle operation at a time and retain provider-specific implementations where semantics genuinely differ.

## Acceptance criteria

- [ ] All four web/mobile × native/Supabase paths preserve login, refresh, logout, password-change, recovery, and revocation behavior.
- [ ] Invalid bearer credentials never fall back to cookies; disabled bearer access, revoked sessions, and inactive users fail consistently.
- [ ] Supabase ordinary-user operations run under the validated principal; service-role usage remains limited to documented privileged identity operations.
- [ ] No shared package imports token storage, cookie APIs, password hashes, provider clients, native modules, or secrets.
- [ ] Concurrent requests from different actors cannot share identity context.

## Verification

```powershell
npx vitest run tests/auth.test.ts tests/auth-facade.test.ts tests/auth-routes.test.ts tests/auth-change-password-timing.test.ts tests/mobile-login-route.test.ts tests/mobile-refresh-route.test.ts tests/mobile-logout-route.test.ts tests/mobile-change-password-route.test.ts tests/mobile-request-auth.test.ts tests/mobile-tokens.test.ts tests/password-recovery-routes.test.ts
Push-Location mobile
npm test -- --runTestsByPath __tests__/session-controller.test.ts __tests__/session-provider.test.tsx __tests__/secure-token-store.test.ts
Pop-Location
```

Expected: provider/transport matrix, isolation, revocation, and timing-sensitive tests pass with public contracts unchanged.

## STOP conditions

- One canonical operation would falsely imply atomicity across provider Auth and application-database writes.
- Preserving a provider's session semantics requires changing released web/mobile contracts or weakening revocation/RLS binding.
