import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ADMIN_LAYOUT, DEFAULT_DASHBOARD_LAYOUT } from '@/app/constants'

const { getActor, gate, verify, persistence } = vi.hoisted(() => ({
  getActor: vi.fn(), gate: vi.fn(), verify: vi.fn(),
  persistence: {
    getDefaultLayouts: vi.fn(), setDashboardLayout: vi.fn(), setAdminLayout: vi.fn(),
    setDefaultLayouts: vi.fn(), setBackfillWindow: vi.fn(), getBackfillWindow: vi.fn(),
  },
}))
vi.mock('@/lib/auth', async () => ({ ...await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth'), getActor }))
vi.mock('@/lib/db/write-gate', () => ({ writeGateResponse: gate }))
vi.mock('@/lib/db/workspace', () => ({ workspaceDeps: () => ({ persistence }) }))
vi.mock('@/lib/auth/mobile-tokens', () => ({ verifyMobileAccessToken: verify, isLegacyMobileToken: vi.fn(async () => false) }))
vi.mock('@/lib/auth/mobile-session-store', () => ({ mobileSessionStore: { findSessionAndActorById: vi.fn() } }))

import { GET as getLayouts, PATCH as patchLayout, PUT as putLayouts } from '@/app/api/v1/layout/web/route'
import { GET as getCapabilities } from '@/app/api/v1/capabilities/route'
import { PUT as putBackfill } from '@/app/api/v1/admin/settings/backfill/route'

const actor = {
  id: 'user-1', email: 'user@example.com', isActive: true,
  role: 'user' as const, permission_role: 'user' as const, hierarchy_role: 'user' as const,
}
const admin = { ...actor, id: 'admin-1', email: 'admin@example.com', role: 'admin' as const, permission_role: 'admin' as const }
function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000', cookie: 'session=1', 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  process.env.SUPER_ADMIN_EMAIL = 'super@example.com'
  getActor.mockResolvedValue(actor)
  gate.mockResolvedValue(null)
  persistence.getDefaultLayouts.mockResolvedValue({
    data: { dashboard: DEFAULT_DASHBOARD_LAYOUT, admin: DEFAULT_ADMIN_LAYOUT, mobile: { modules: [] } }, error: null,
  })
  for (const write of [persistence.setDashboardLayout, persistence.setAdminLayout, persistence.setDefaultLayouts, persistence.setBackfillWindow]) {
    write.mockResolvedValue({ error: null })
  }
  persistence.getBackfillWindow.mockResolvedValue({ mode: 'days', windowDays: 7, extraDays: 0 })
})
afterEach(() => { delete process.env.SUPER_ADMIN_EMAIL })

describe('browser web-layout and capability resources', () => {
  it('reads global defaults for any active actor while writers are fenced', async () => {
    gate.mockResolvedValue({ status: 503, body: { error: 'Writers fenced.' } })
    const response = await getLayouts(request('/api/v1/layout/web'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { dashboard: DEFAULT_DASHBOARD_LAYOUT, admin: DEFAULT_ADMIN_LAYOUT } })
    expect(gate).not.toHaveBeenCalled()
  })

  it('persists the signed-in actor dashboard layout and acknowledges without a read-back', async () => {
    persistence.getDefaultLayouts.mockRejectedValue(new Error('Read-back unavailable'))
    const response = await patchLayout(request('/api/v1/layout/web', 'PATCH', {
      target: 'dashboard', layout: DEFAULT_DASHBOARD_LAYOUT,
    }))
    expect(response.status).toBe(200)
    expect(persistence.setDashboardLayout).toHaveBeenCalledWith(actor, DEFAULT_DASHBOARD_LAYOUT)
    expect(persistence.getDefaultLayouts).not.toHaveBeenCalled()
  })

  it('requires admin for personal admin layout and filters the super-admin tile for ordinary admins', async () => {
    expect((await patchLayout(request('/api/v1/layout/web', 'PATCH', {
      target: 'admin', layout: DEFAULT_ADMIN_LAYOUT,
    }))).status).toBe(403)
    getActor.mockResolvedValue(admin)
    const response = await patchLayout(request('/api/v1/layout/web', 'PATCH', {
      target: 'admin', layout: DEFAULT_ADMIN_LAYOUT,
    }))
    expect(response.status).toBe(200)
    expect(persistence.setAdminLayout).toHaveBeenCalledWith(admin, {
      tiles: DEFAULT_ADMIN_LAYOUT.tiles.filter((tile) => tile.id !== 'super-admin'),
    })
  })

  it('treats capability discovery as a hint and separately enforces superadmin default writes', async () => {
    getActor.mockResolvedValue(admin)
    expect(await (await getCapabilities(request('/api/v1/capabilities'))).json()).toEqual({
      data: { isSuperAdmin: false }, error: null,
    })
    expect((await putLayouts(request('/api/v1/layout/web', 'PUT', {
      dashboard: DEFAULT_DASHBOARD_LAYOUT, admin: DEFAULT_ADMIN_LAYOUT,
    }))).status).toBe(403)

    const superAdmin = { ...admin, email: 'super@example.com' }
    getActor.mockResolvedValue(superAdmin)
    expect(await (await getCapabilities(request('/api/v1/capabilities'))).json()).toEqual({
      data: { isSuperAdmin: true }, error: null,
    })
    expect((await putLayouts(request('/api/v1/layout/web', 'PUT', {
      dashboard: DEFAULT_DASHBOARD_LAYOUT, admin: DEFAULT_ADMIN_LAYOUT,
    }))).status).toBe(200)
    expect(persistence.setDefaultLayouts).toHaveBeenCalledWith(superAdmin, {
      dashboard: DEFAULT_DASHBOARD_LAYOUT, admin: DEFAULT_ADMIN_LAYOUT,
    })
  })

  it('rejects missing, duplicate, unknown and malformed tiles before persistence', async () => {
    const invalid = [null, {}, { target: 'dashboard' },
      { target: 'dashboard', layout: { tiles: [] } },
      { target: 'dashboard', layout: { tiles: [{ id: 'unknown', enabled: true }] } },
      { target: 'dashboard', layout: { tiles: DEFAULT_DASHBOARD_LAYOUT.tiles.map((tile) => ({ ...tile, extra: true })) } }]
    for (const body of invalid) {
      expect((await patchLayout(request('/api/v1/layout/web', 'PATCH', body))).status).toBe(400)
    }
    expect(persistence.setDashboardLayout).not.toHaveBeenCalled()
  })

  it('rejects unsafe origins, explicit invalid bearers and closed/unreadable fences', async () => {
    const body = { target: 'dashboard', layout: DEFAULT_DASHBOARD_LAYOUT }
    expect((await patchLayout(request('/api/v1/layout/web', 'PATCH', body, { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await patchLayout(request('/api/v1/layout/web', 'PATCH', body, { authorization: 'invalid' }))).status).toBe(401)
    expect(getActor).not.toHaveBeenCalled()
    for (const state of ['closed', 'unreadable']) {
      if (state === 'closed') gate.mockResolvedValue({ status: 503, body: { error: 'Writers fenced.' } })
      else gate.mockRejectedValue(new Error('Gate unavailable'))
      const response = await patchLayout(request('/api/v1/layout/web', 'PATCH', body))
      expect(response.status).toBe(503)
      expect(response.headers.get('retry-after')).toBe('60')
    }
  })
})

describe('browser backfill settings write', () => {
  it('acknowledges an admin write without a post-write read-back', async () => {
    getActor.mockResolvedValue(admin)
    persistence.getBackfillWindow.mockRejectedValue(new Error('Read-back unavailable'))
    const settings = { mode: 'month_start', windowDays: 0, extraDays: 5 }
    const response = await putBackfill(request('/api/v1/admin/settings/backfill', 'PUT', settings))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { success: true }, error: null })
    expect(persistence.setBackfillWindow).toHaveBeenCalledWith(admin, settings)
    expect(persistence.getBackfillWindow).not.toHaveBeenCalled()
  })

  it('rejects ordinary users and invalid bounds', async () => {
    const settings = { mode: 'days', windowDays: 7, extraDays: 0 }
    expect((await putBackfill(request('/api/v1/admin/settings/backfill', 'PUT', settings))).status).toBe(403)
    getActor.mockResolvedValue(admin)
    expect((await putBackfill(request('/api/v1/admin/settings/backfill', 'PUT', { ...settings, windowDays: 366 }))).status).toBe(400)
    expect(persistence.setBackfillWindow).not.toHaveBeenCalled()
  })
})
