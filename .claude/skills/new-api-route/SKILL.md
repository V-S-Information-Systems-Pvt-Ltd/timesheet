---
name: new-api-route
description: Add or extend an /api/v1 route handler the way this repo requires (withMobileActor guard, service layer returning MobileServiceResult, established error shape, focused tests). Use when creating a new app/api/v1 endpoint or HTTP method.
argument-hint: <resource path, e.g. departments/[id]>
---

# New /api/v1 route

The browser and mobile app reach the server only through `/api/v1`. Never add Server Actions or `/api/auth` / `/api/data` routes; `tests/boundary-enforcement.test.ts` fails if you do.

## Layers (copy `app/api/v1/departments/route.ts` and `lib/api/v1/services/departments.ts`)

1. **Route**: `app/api/v1/<path>/route.ts`
   ```ts
   import { parseJsonBody, serverError, serviceResultResponse, withMobileActor } from '@/app/api/v1/_http'
   export const runtime = 'nodejs'
   export async function POST(request: Request) {
     return withMobileActor(request, async (auth) => {
       try {
         const parsed = await parseJsonBody(request)
         if (!parsed.ok) return parsed.response
         // validate with zod; on failure return badRequest(...)
         return serviceResultResponse(await doThingService(auth.actor, /* parsed */))
       } catch (err) {
         return serverError(err)
       }
     }, { allowCookie: true }) // only if the web app calls it too
   }
   ```
   Return through `apiError` / `badRequest` / `serviceResultResponse` and never throw to the client. Apply rate limiting once per batch, not per item.
2. **Service**: `lib/api/v1/services/<domain>.ts` takes an `Actor`, calls `lib/domain/*` with `*Deps()` from `lib/db/<domain>`, maps domain errors to `MobileServiceResult` (FORBIDDEN→403, CONFLICT→409, else 400), and calls `safeAudit` after successful writes.
3. **Persistence**: add any new SQL in `lib/db/native/*`, parameterized and scoped by actor. Writes return `DbWrite`. Never open a `pg` client from a route or service.
4. **Browser client**: if the web UI needs the route, add it to `lib/data/client.ts`.

## Authorization
A valid session is not authorization. `withMobileActor` gives you an active actor; role and department checks still belong in the domain or SQL layer (`permission_role`, `hierarchy_role`, `scope_departments`).

## Tests (required)
Add a Vitest file under `tests/`. Mock `@/lib/db/pool` with `vi.hoisted` (see `tests/department-scope.test.ts`). Cover the success path, at least one denied actor (403), and invalid input (400). Then run `/verify`.

If the public API contract changes, add a short entry to `docs/ai-context/ARCHITECTURE_DELTA.md`.
