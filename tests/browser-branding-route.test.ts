import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BRANDING } from '@/lib/branding'

const { getActor, gate, verify, persistence, revalidatePath } = vi.hoisted(() => ({
  getActor: vi.fn(), gate: vi.fn(), verify: vi.fn(), revalidatePath: vi.fn(),
  persistence: { getBranding: vi.fn(), setBranding: vi.fn() },
}))
vi.mock('@/lib/auth', async () => ({ ...await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth'), getActor }))
vi.mock('@/lib/db/write-gate', () => ({ writeGateResponse: gate }))
vi.mock('@/lib/db/workspace', () => ({ workspaceDeps: () => ({ persistence }) }))
vi.mock('@/lib/auth/mobile-tokens', () => ({ verifyMobileAccessToken: verify, isLegacyMobileToken: vi.fn(async () => false) }))
vi.mock('@/lib/auth/mobile-session-store', () => ({ mobileSessionStore: { findSessionAndActorById: vi.fn() } }))
vi.mock('next/cache', () => ({ revalidatePath }))

import { GET, PUT } from '@/app/api/v1/admin/branding/route'

const actor = {
  id: 'user-1', email: 'user@example.com', isActive: true,
  role: 'user' as const, permission_role: 'user' as const, hierarchy_role: 'user' as const,
}
const superAdmin = { ...actor, id: 'super-1', email: 'super@example.com', role: 'admin' as const, permission_role: 'admin' as const }
const customBranding = { appName: 'Astra Timesheet', primaryColor: '#2255aa', logoUrl: 'https://example.com/logo.png?v=2' }
function request(method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/v1/admin/branding', {
    method,
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', cookie: 'session=1', 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  process.env.SUPER_ADMIN_EMAIL = superAdmin.email
  getActor.mockResolvedValue(actor)
  gate.mockResolvedValue(null)
  persistence.getBranding.mockResolvedValue({ data: customBranding, error: null })
  persistence.setBranding.mockResolvedValue({ error: null })
})
afterEach(() => { delete process.env.SUPER_ADMIN_EMAIL })

describe('browser workspace branding resource', () => {
  it('allows any active actor to read branding while fenced', async () => {
    gate.mockResolvedValue({ status: 503, body: { error: 'Writers fenced.' } })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: customBranding, error: null })
    expect(gate).not.toHaveBeenCalled()
  })

  it('requires the configured superadmin for writes', async () => {
    expect((await PUT(request('PUT', customBranding))).status).toBe(403)
    expect(persistence.setBranding).not.toHaveBeenCalled()
    getActor.mockResolvedValue(superAdmin)
    expect((await PUT(request('PUT', customBranding))).status).toBe(200)
    expect(persistence.setBranding).toHaveBeenCalledWith(superAdmin, { ...customBranding, primaryColor: '#2255AA' })
  })

  it('returns the first field validation error to browser callers', async () => {
    getActor.mockResolvedValue(superAdmin)
    const response = await PUT(request('PUT', { ...customBranding, appName: '' }))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.message).toBe(body.error.fieldErrors.appName)
    expect(persistence.setBranding).not.toHaveBeenCalled()
  })

  it('saves and resets with root-layout invalidation', async () => {
    getActor.mockResolvedValue(superAdmin)
    expect((await PUT(request('PUT', customBranding))).status).toBe(200)
    expect(revalidatePath).toHaveBeenLastCalledWith('/', 'layout')
    expect((await PUT(request('PUT', { reset: true }))).status).toBe(200)
    expect(persistence.setBranding).toHaveBeenLastCalledWith(superAdmin, DEFAULT_BRANDING)
    expect(revalidatePath).toHaveBeenCalledTimes(2)
  })

  it('preserves provider errors and origin/bearer/fence refusal', async () => {
    getActor.mockResolvedValue(superAdmin)
    persistence.setBranding.mockResolvedValueOnce({ error: 'Branding write refused.' })
    expect((await PUT(request('PUT', customBranding))).status).toBe(500)
    expect((await PUT(request('PUT', customBranding, { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await PUT(request('PUT', customBranding, { authorization: 'invalid' }))).status).toBe(401)
    for (const state of ['closed', 'unreadable']) {
      if (state === 'closed') gate.mockResolvedValue({ status: 503, body: { error: 'Writers fenced.' } })
      else gate.mockRejectedValue(new Error('Gate unavailable'))
      const response = await PUT(request('PUT', customBranding))
      expect(response.status).toBe(503)
      expect(response.headers.get('retry-after')).toBe('60')
    }
  })

  it('accepts cookies independently of the bearer feature switch', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'false')
    try {
      getActor.mockResolvedValue(superAdmin)
      expect((await PUT(request('PUT', customBranding))).status).toBe(200)
      expect(verify).not.toHaveBeenCalled()
    } finally { vi.unstubAllEnvs() }
  })
})
