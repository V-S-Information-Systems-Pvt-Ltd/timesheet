// tests/workspace-service.test.ts
// Focused tests for the versioned mobile transport adapter over the workspace
// application service. They pin the MobileServiceResult mapping (success and
// every error code) without asserting HTTP envelopes, which the route tests own.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRepo } = vi.hoisted(() => ({
  mockRepo: {
    getMobileLayout: vi.fn(),
    setMobileLayout: vi.fn(),
    getDefaultLayouts: vi.fn(),
    setDefaultLayouts: vi.fn(),
  },
}))

vi.mock('@/lib/db/workspace', () => ({
  workspacePersistence: mockRepo,
  workspaceDeps: () => ({ persistence: mockRepo }),
}))

import {
  getAdminLayoutService,
  getPersonalLayoutService,
  resetAdminLayoutService,
  resetPersonalLayoutService,
  saveAdminLayoutService,
  savePersonalLayoutService,
} from '@/lib/api/v1/services/workspace'
import { DEFAULT_MOBILE_LAYOUT } from '@/lib/layout'
import type { Actor } from '@/lib/db/repository'

const engineer: Actor = {
  id: 'eng-1',
  email: 'engineer@vsis.lk',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'engineer',
  isActive: true,
}

const inactive: Actor = { ...engineer, isActive: false }

const admin: Actor = {
  id: 'admin-1',
  email: 'admin@vsis.lk',
  role: 'admin',
  permission_role: 'admin',
  hierarchy_role: 'manager',
  isActive: true,
}

const superAdmin: Actor = { ...admin, id: 'super-1', email: 'super@vsis.lk' }

const defaultLayouts = { dashboard: { tiles: [] }, admin: { tiles: [] }, mobile: DEFAULT_MOBILE_LAYOUT }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUPER_ADMIN_EMAIL = 'super@vsis.lk'
  mockRepo.getMobileLayout.mockResolvedValue({ data: null, error: null })
  mockRepo.setMobileLayout.mockResolvedValue({ error: null })
  mockRepo.getDefaultLayouts.mockResolvedValue({ data: defaultLayouts, error: null })
  mockRepo.setDefaultLayouts.mockResolvedValue({ error: null })
})

describe('workspace v1 service adapter', () => {
  it('maps a successful personal-layout read', async () => {
    const result = await getPersonalLayoutService(engineer)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.defaultLayout).toEqual(DEFAULT_MOBILE_LAYOUT)
      expect(result.data.capabilities.canManageSettings).toBe(false)
    }
  })

  it('maps an inactive actor to a 403 FORBIDDEN result', async () => {
    const result = await getPersonalLayoutService(inactive)
    expect(result).toEqual({
      success: false,
      code: 'FORBIDDEN',
      message: expect.any(String),
      status: 403,
    })
  })

  it('maps a provider failure to a 500 INTERNAL_ERROR result', async () => {
    mockRepo.getDefaultLayouts.mockResolvedValue({ data: null, error: 'layout store down' })
    const result = await getPersonalLayoutService(engineer)
    expect(result).toMatchObject({ success: false, code: 'INTERNAL_ERROR', status: 500 })
  })

  it('maps a successful personal-layout save', async () => {
    const result = await savePersonalLayoutService(engineer, { modules: [{ id: 'log-time', enabled: false }] })
    expect(result.success).toBe(true)
    expect(mockRepo.setMobileLayout).toHaveBeenCalled()
  })

  it('maps an unsanitizable layout to a 400 INVALID_PAYLOAD result', async () => {
    const result = await savePersonalLayoutService(engineer, { nope: true })
    expect(result).toMatchObject({ success: false, code: 'INVALID_PAYLOAD', status: 400 })
    expect(mockRepo.setMobileLayout).not.toHaveBeenCalled()
  })

  it('maps a successful personal-layout reset', async () => {
    const result = await resetPersonalLayoutService(engineer)
    expect(result.success).toBe(true)
    expect(mockRepo.setMobileLayout).toHaveBeenCalledWith(engineer, null)
  })

  it('maps a successful admin default-layout read', async () => {
    const result = await getAdminLayoutService(admin)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.layout).toEqual(DEFAULT_MOBILE_LAYOUT)
  })

  it('maps a super-admin default-layout save and a non-super-admin rejection', async () => {
    const denied = await saveAdminLayoutService(admin, DEFAULT_MOBILE_LAYOUT)
    expect(denied).toMatchObject({ success: false, code: 'FORBIDDEN', status: 403 })

    const allowed = await saveAdminLayoutService(superAdmin, { modules: [{ id: 'timesheets', enabled: true }] })
    expect(allowed.success).toBe(true)
    expect(mockRepo.setDefaultLayouts).toHaveBeenCalled()
  })

  it('maps a successful admin default-layout reset', async () => {
    const result = await resetAdminLayoutService(superAdmin)
    expect(result.success).toBe(true)
    expect(mockRepo.setDefaultLayouts).toHaveBeenCalledWith(superAdmin, {
      dashboard: defaultLayouts.dashboard,
      admin: defaultLayouts.admin,
      mobile: null,
    })
  })
})
