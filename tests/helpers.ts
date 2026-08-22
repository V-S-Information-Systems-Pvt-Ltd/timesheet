// tests/helpers.ts
// Shared test fixtures for actor/session literals that are otherwise
// duplicated across auth, actions, data-client, and timesheets-api tests.
import type { Actor } from '@/lib/db/repository'
import { rolePairFromLegacy } from '@/lib/roles'

export interface TestSession {
  id: string
  email: string
}

/** Build a minimal Actor for the given role (permission/hierarchy auto-derived
 * from the legacy role unless explicitly overridden). */
export function makeActor(over: Partial<Actor> = {}): Actor {
  const { role = 'user', permission_role, hierarchy_role, ...rest } = over
  const pair = rolePairFromLegacy(role)
  return {
    id: 'user-1',
    email: 'user@example.com',
    role,
    permission_role: permission_role ?? pair.permission,
    hierarchy_role: hierarchy_role ?? pair.hierarchy,
    isActive: true,
    ...rest,
  }
}

/** Build actors for the common roles used in authorization tests. */
export const actors = {
  admin: (): Actor => makeActor({ id: 'admin-1', email: 'admin@example.com', role: 'admin' }),
  user: (): Actor => makeActor({ id: 'user-1', email: 'user@example.com', role: 'user' }),
  inactive: (): Actor => makeActor({ id: 'user-2', email: 'inactive@example.com', role: 'user', isActive: false }),
  co: (): Actor => makeActor({ id: 'co-1', email: 'co@example.com', role: 'co' }),
  pm: (): Actor => makeActor({ id: 'pm-1', email: 'pm@example.com', role: 'pm' }),
  manager: (): Actor => makeActor({ id: 'mgr-1', email: 'mgr@example.com', role: 'manager' }),
  teamLead: (): Actor => makeActor({ id: 'tl-1', email: 'tl@example.com', role: 'team_lead' }),
}

/** Build a ClientSessionUser / SessionUser shape. */
export function makeSession(over: Partial<TestSession> = {}): TestSession {
  return { id: 'user-1', email: 'user@example.com', ...over }
}

/** A minimal fetch mock that resolves with JSON. */
export function mockFetchResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  })
}
