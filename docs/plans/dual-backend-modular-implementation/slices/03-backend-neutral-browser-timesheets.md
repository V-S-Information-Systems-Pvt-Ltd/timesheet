# 03 Browser timesheet access is backend-neutral

**What to build:** Browser timesheet queries and mutations use the shared typed HTTP client without selecting Supabase/native in frontend code, while Server Components and Server Actions continue to call the application service directly.

**Blocked by:** 01 and 02.

## Approach

- Build the shared HTTP client around injected fetch, base URL, and authentication behavior; move the mobile transport core while leaving native token storage and refresh coordination in mobile.
- Extend the existing versioned timesheet resources to accept either cookie or bearer authentication. Explicit bearer credentials take precedence; invalid bearer credentials never fall back to cookies.
- Apply origin protection to cookie-authenticated mutations. Bind ordinary Supabase calls to the validated request identity and retain request-scoped RLS.
- Adapt the browser timesheet portion of the existing data facade to the shared client while preserving its return shapes, caching, and in-flight request behavior.
- Keep `/api/data` as a thin compatibility adapter and keep server-only callers off the HTTP loopback path.
- Remove direct browser Supabase access only for migrated timesheet operations in this slice.

## Acceptance criteria

- [ ] Browser timesheet data access contains no runtime backend selection or direct database-client call.
- [ ] Cookie and bearer requests return the same authorized domain outcomes and preserved transport shapes.
- [ ] Invalid explicit bearer credentials fail without cookie fallback; bearer feature-gate, revoked-session, inactive-user, and concurrent-user isolation remain enforced.
- [ ] Cookie mutations reject cross-origin requests, while safe same-origin and bearer requests retain existing behavior.
- [ ] Supabase tests prove two concurrent request identities cannot leak through shared/global client state.
- [ ] Server Actions and Server Components invoke the service directly, with no self-HTTP request.

## Verification

```powershell
npx vitest run tests/data-client-native.test.ts tests/data-client-supabase.test.ts tests/data-client-cache.test.ts tests/mobile-request-auth.test.ts tests/mobile-tokens.test.ts tests/csrf.test.ts tests/parity-tracer.test.ts
$env:NEXT_PUBLIC_BACKEND = 'supabase'; npm run build
$env:NEXT_PUBLIC_BACKEND = 'native'; npm run build
```

Expected: both build modes pass and auth/data-client tests prove strict credential selection and backend-neutral browser behavior.

## STOP conditions

- Cookie support requires changing released `/api/v1` bearer responses or weakening the bearer feature gate.
- Request-scoped Supabase identity cannot be maintained under concurrent cookie and bearer requests.
