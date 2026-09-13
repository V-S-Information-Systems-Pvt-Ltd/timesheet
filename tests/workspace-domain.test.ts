import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAdminBackfillSettings,
  getAdminWorkspaceBranding,
  getBackfillSettings,
  getBrandingOrDefault,
  getDefaultLayouts,
  getDefaultMobileLayout,
  getMobileLayoutState,
  getWorkspaceBranding,
  resetDefaultMobileLayout,
  resetMobileLayout,
  resetWorkspaceBranding,
  saveAdminLayout,
  saveDashboardLayout,
  saveDefaultMobileLayout,
  saveMobileLayout,
  saveWorkspaceBranding,
  setBackfillSettings,
  type WorkspaceDomainDeps,
} from '@/lib/domain/workspace'
import type { WorkspacePersistence } from '@/lib/domain/workspace-port'
import type { Actor } from '@/lib/db/repository'
import { DEFAULT_BRANDING } from '@/lib/branding'
import { ADMIN_TILE_IDS, TILE_IDS } from '@/app/constants'
import { DEFAULT_MOBILE_LAYOUT } from '@/lib/layout'
import type { DashboardLayout, AdminDashboardLayout, MobileLayout } from '@/app/types'

const engineer: Actor = {
  id: 'eng-1',
  email: 'engineer@vsis.lk',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'engineer',
  isActive: true,
}

const teamLead: Actor = {
  id: 'lead-1',
  email: 'lead@vsis.lk',
  role: 'user',
  permission_role: 'user',
  hierarchy_role: 'team_lead',
  isActive: true,
}

const admin: Actor = {
  id: 'admin-1',
  email: 'admin@vsis.lk',
  role: 'admin',
  permission_role: 'admin',
  hierarchy_role: 'manager',
  isActive: true,
}

const superAdmin: Actor = { ...admin, id: 'super-1', email: 'super@vsis.lk' }

const validDashboard: DashboardLayout = { tiles: TILE_IDS.map((id) => ({ id, enabled: true })) }
const validAdmin: AdminDashboardLayout = { tiles: ADMIN_TILE_IDS.map((id) => ({ id, enabled: true })) }

function makeDeps() {
  const persistence: WorkspacePersistence = {
    getBackfillWindow: vi.fn(),
    setBackfillWindow: vi.fn(),
    getDefaultLayouts: vi.fn(),
    setDefaultLayouts: vi.fn(),
    getMobileLayout: vi.fn(),
    setMobileLayout: vi.fn(),
    setDashboardLayout: vi.fn(),
    setAdminLayout: vi.fn(),
    getBranding: vi.fn(),
    setBranding: vi.fn(),
  }
  const deps: WorkspaceDomainDeps = { persistence }
  return { persistence: vi.mocked(persistence), deps }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUPER_ADMIN_EMAIL = 'super@vsis.lk'
})

describe('workspace domain — backfill settings', () => {
  it('reads the effective settings for an active actor', async () => {
    const { persistence, deps } = makeDeps()
    persistence.getBackfillWindow.mockResolvedValue({ mode: 'days', windowDays: 7, extraDays: 0 })

    const result = await getBackfillSettings(engineer, deps)
    expect(result).toEqual({ ok: true, data: { mode: 'days', windowDays: 7, extraDays: 0 } })
    expect(persistence.getBackfillWindow).toHaveBeenCalledWith(engineer)
  })

  it('validates mode and day ranges before writing', async () => {
    const { persistence, deps } = makeDeps()

    const badMode = await setBackfillSettings(admin, { mode: 'bogus' as never, windowDays: 1, extraDays: 0 }, deps)
    expect(badMode.ok).toBe(false)
    if (!badMode.ok) expect(badMode.error.message).toBe('Invalid backfill mode.')

    const badWindow = await setBackfillSettings(admin, { mode: 'days', windowDays: 500, extraDays: 0 }, deps)
    expect(badWindow.ok).toBe(false)
    if (!badWindow.ok) expect(badWindow.error.message).toContain('0 and 365')

    const badExtra = await setBackfillSettings(admin, { mode: 'days', windowDays: 1, extraDays: -1 }, deps)
    expect(badExtra.ok).toBe(false)
    if (!badExtra.ok) expect(badExtra.error.message).toContain('0 and 365')

    expect(persistence.setBackfillWindow).not.toHaveBeenCalled()
  })

  it('rejects non-admins and inactive actors with FORBIDDEN', async () => {
    const { persistence, deps } = makeDeps()

    const asUser = await setBackfillSettings(engineer, { mode: 'days', windowDays: 1, extraDays: 0 }, deps)
    expect(asUser.ok).toBe(false)
    if (!asUser.ok) expect(asUser.error.code).toBe('FORBIDDEN')

    const inactive = await setBackfillSettings({ ...admin, isActive: false }, { mode: 'days', windowDays: 1, extraDays: 0 }, deps)
    expect(inactive.ok).toBe(false)
    if (!inactive.ok) expect(inactive.error.code).toBe('FORBIDDEN')

    expect(persistence.setBackfillWindow).not.toHaveBeenCalled()
  })

  it('persists valid settings for an admin', async () => {
    const { persistence, deps } = makeDeps()
    persistence.setBackfillWindow.mockResolvedValue({ error: null })

    const result = await setBackfillSettings(admin, { mode: 'month_start', windowDays: 0, extraDays: 3 }, deps)
    expect(result.ok).toBe(true)
    expect(persistence.setBackfillWindow).toHaveBeenCalledWith(admin, {
      mode: 'month_start',
      windowDays: 0,
      extraDays: 3,
    })
  })

  it('gates the admin backfill read on the admin permission axis', async () => {
    const { persistence, deps } = makeDeps()
    persistence.getBackfillWindow.mockResolvedValue({ mode: 'days', windowDays: 1, extraDays: 0 })

    const denied = await getAdminBackfillSettings(teamLead, deps)
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')

    const allowed = await getAdminBackfillSettings(admin, deps)
    expect(allowed.ok).toBe(true)
  })
})

describe('workspace domain — panel layouts', () => {
  it('validates the dashboard tile set before writing', async () => {
    const { persistence, deps } = makeDeps()

    const invalid = await saveDashboardLayout(engineer, { tiles: [] }, deps)
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.error.message).toBe('Invalid layout.')
    expect(persistence.setDashboardLayout).not.toHaveBeenCalled()

    persistence.setDashboardLayout.mockResolvedValue({ error: null })
    const valid = await saveDashboardLayout(engineer, validDashboard, deps)
    expect(valid.ok).toBe(true)
    expect(persistence.setDashboardLayout).toHaveBeenCalledWith(engineer, validDashboard)
  })

  it('strips the super-admin tile for a regular admin but keeps it for the super-admin', async () => {
    const { persistence, deps } = makeDeps()
    persistence.setAdminLayout.mockResolvedValue({ error: null })

    const regularResult = await saveAdminLayout(admin, validAdmin, deps)
    expect(regularResult.ok).toBe(true)
    expect(persistence.setAdminLayout).toHaveBeenCalledWith(admin, {
      tiles: validAdmin.tiles.filter((t) => t.id !== 'super-admin'),
    })

    persistence.setAdminLayout.mockClear()
    const superResult = await saveAdminLayout(superAdmin, validAdmin, deps)
    expect(superResult.ok).toBe(true)
    expect(persistence.setAdminLayout).toHaveBeenCalledWith(superAdmin, { tiles: validAdmin.tiles })
  })

  it('rejects a wrong admin tile set', async () => {
    const { persistence, deps } = makeDeps()
    const result = await saveAdminLayout(admin, { tiles: [{ id: 'settings', enabled: true }] }, deps)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe('Invalid layout.')
    expect(persistence.setAdminLayout).not.toHaveBeenCalled()
  })

  it('maps a repository error on the default layout read to STORAGE_ERROR', async () => {
    const { persistence, deps } = makeDeps()
    persistence.getDefaultLayouts.mockResolvedValue({ data: null, error: 'DB failure' })

    const result = await getDefaultLayouts(engineer, deps)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_ERROR')
      expect(result.error.message).toBe('DB failure')
    }
  })
})

describe('workspace domain — mobile layout precedence and capability gates', () => {
  function withDefaults(mobile: MobileLayout | null = null) {
    const { persistence, deps } = makeDeps()
    persistence.getMobileLayout.mockResolvedValue({ data: null, error: null })
    persistence.getDefaultLayouts.mockResolvedValue({
      data: { dashboard: validDashboard, admin: validAdmin, mobile },
      error: null,
    })
    return { persistence, deps }
  }

  it('falls back to the registry default when no workspace default exists', async () => {
    const { deps } = withDefaults(null)
    const result = await getMobileLayoutState(admin, deps)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.defaultLayout).toEqual(DEFAULT_MOBILE_LAYOUT)
    }
  })

  it('keeps the team module for the hierarchy axis (team_lead) and drops it for an engineer', async () => {
    const { deps } = withDefaults()

    const lead = await getMobileLayoutState(teamLead, deps)
    expect(lead.ok).toBe(true)
    if (lead.ok) {
      const ids = lead.data.layout.modules.map((m) => m.id)
      expect(ids).toContain('team')
      expect(ids).not.toContain('admin-users')
    }

    const eng = await getMobileLayoutState(engineer, deps)
    expect(eng.ok).toBe(true)
    if (eng.ok) {
      const ids = eng.data.layout.modules.map((m) => m.id)
      expect(ids).not.toContain('team')
      expect(ids).not.toContain('admin-users')
      expect(ids).toContain('log-time')
      expect(ids).toContain('timesheets')
      expect(ids).toContain('profile')
    }
  })

  it('exposes admin capability gates for an admin actor', async () => {
    const { deps } = withDefaults()
    const result = await getMobileLayoutState(admin, deps)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.capabilities.canManageSettings).toBe(true)
      expect(result.data.layout.modules.some((m) => m.id === 'admin-settings')).toBe(true)
    }
  })

  it('applies a saved override over the workspace default and forces essential modules', async () => {
    const { persistence, deps } = makeDeps()
    const saved: MobileLayout = {
      modules: [
        { id: 'log-time', enabled: false, placement: 'more' },
        { id: 'leaves', enabled: false, placement: 'home' },
      ],
    }
    persistence.getMobileLayout.mockResolvedValue({ data: saved, error: null })
    persistence.getDefaultLayouts.mockResolvedValue({
      data: { dashboard: validDashboard, admin: validAdmin, mobile: null },
      error: null,
    })

    const result = await getMobileLayoutState(engineer, deps)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.savedLayout).toEqual(saved)
      const logTime = result.data.layout.modules.find((m) => m.id === 'log-time')
      expect(logTime?.enabled).toBe(true)
    }
  })

  it('sanitizes and persists a personal layout override', async () => {
    const { persistence, deps } = withDefaults()
    persistence.setMobileLayout.mockResolvedValue({ error: null })

    const result = await saveMobileLayout(engineer, { modules: [{ id: 'log-time', enabled: false }] }, deps)
    expect(result.ok).toBe(true)
    const [, written] = persistence.setMobileLayout.mock.calls[0]
    expect(written?.modules.find((m) => m.id === 'log-time')?.enabled).toBe(true)
    expect(written?.modules.length).toBe(DEFAULT_MOBILE_LAYOUT.modules.length)
  })

  it('rejects an unsanitizable payload', async () => {
    const { persistence, deps } = withDefaults()
    const result = await saveMobileLayout(engineer, { nope: true }, deps)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_ERROR')
    expect(persistence.setMobileLayout).not.toHaveBeenCalled()
  })

  it('clears a personal override on reset', async () => {
    const { persistence, deps } = withDefaults()
    persistence.setMobileLayout.mockResolvedValue({ error: null })

    const result = await resetMobileLayout(engineer, deps)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.savedLayout).toBeNull()
    expect(persistence.setMobileLayout).toHaveBeenCalledWith(engineer, null)
  })

  it('reads the workspace default mobile layout', async () => {
    const { deps } = withDefaults(DEFAULT_MOBILE_LAYOUT)
    const result = await getDefaultMobileLayout(admin, deps)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.layout).toEqual(DEFAULT_MOBILE_LAYOUT)
  })

  it('requires super-admin for default-layout writes and preserves dashboard/admin', async () => {
    const { persistence, deps } = withDefaults()
    persistence.setDefaultLayouts.mockResolvedValue({ error: null })

    const denied = await saveDefaultMobileLayout(admin, DEFAULT_MOBILE_LAYOUT, deps)
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')
    expect(persistence.setDefaultLayouts).not.toHaveBeenCalled()

    const allowed = await saveDefaultMobileLayout(superAdmin, { modules: [{ id: 'timesheets', enabled: true }] }, deps)
    expect(allowed.ok).toBe(true)
    const [, written] = persistence.setDefaultLayouts.mock.calls[0]
    expect(written.dashboard).toEqual(validDashboard)
    expect(written.admin).toEqual(validAdmin)
    expect(written.mobile?.modules.length).toBe(DEFAULT_MOBILE_LAYOUT.modules.length)
  })

  it('requires super-admin to reset the default layout and returns the registry default', async () => {
    const { persistence, deps } = withDefaults(DEFAULT_MOBILE_LAYOUT)
    persistence.setDefaultLayouts.mockResolvedValue({ error: null })

    const allowed = await resetDefaultMobileLayout(superAdmin, deps)
    expect(allowed.ok).toBe(true)
    if (allowed.ok) expect(allowed.data.layout).toEqual(DEFAULT_MOBILE_LAYOUT)
    expect(persistence.setDefaultLayouts).toHaveBeenCalledWith(superAdmin, {
      dashboard: validDashboard,
      admin: validAdmin,
      mobile: null,
    })
  })
})

describe('workspace domain — branding defaults, validation, and reset', () => {
  it('returns default branding when the provider returns a null row', async () => {
    const { persistence, deps } = makeDeps()
    persistence.getBranding.mockResolvedValue({ data: null, error: null })
    await expect(getBrandingOrDefault(deps)).resolves.toEqual(DEFAULT_BRANDING)
  })

  it('returns default branding when the provider throws (safe fallback)', async () => {
    const { persistence, deps } = makeDeps()
    persistence.getBranding.mockRejectedValue(new Error('connection reset'))
    await expect(getBrandingOrDefault(deps)).resolves.toEqual(DEFAULT_BRANDING)
  })

  it('reads configured branding for an active actor and maps provider errors', async () => {
    const { persistence, deps } = makeDeps()
    persistence.getBranding.mockResolvedValue({
      data: { appName: 'Acme', primaryColor: '#0D9488', logoUrl: null },
      error: null,
    })
    const ok = await getWorkspaceBranding(engineer, deps)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.data.appName).toBe('Acme')

    persistence.getBranding.mockResolvedValue({ data: null, error: 'supabase down' })
    const err = await getWorkspaceBranding(engineer, deps)
    expect(err.ok).toBe(false)
    if (!err.ok) expect(err.error.code).toBe('STORAGE_ERROR')
  })

  it('validates branding input and reports field errors', async () => {
    const { persistence, deps } = makeDeps()
    const result = await saveWorkspaceBranding(
      superAdmin,
      { appName: '', primaryColor: 'not-a-color', logoUrl: 'http://insecure.example.com/logo.png' },
      deps
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_ERROR')
      expect(result.error.fieldErrors?.appName).toBeDefined()
      expect(result.error.fieldErrors?.primaryColor).toBeDefined()
      expect(result.error.fieldErrors?.logoUrl).toBeDefined()
    }
    expect(persistence.setBranding).not.toHaveBeenCalled()
  })

  it('requires super-admin to save branding and persists normalized values', async () => {
    const { persistence, deps } = makeDeps()
    persistence.setBranding.mockResolvedValue({ error: null })

    const denied = await saveWorkspaceBranding(admin, { appName: 'Acme' }, deps)
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')
    expect(persistence.setBranding).not.toHaveBeenCalled()

    const allowed = await saveWorkspaceBranding(
      superAdmin,
      { appName: '  Acme  ', primaryColor: '#0d9488', logoUrl: 'https://cdn.example.com/logo.png' },
      deps
    )
    expect(allowed.ok).toBe(true)
    if (allowed.ok) expect(allowed.data.appName).toBe('Acme')
    expect(persistence.setBranding).toHaveBeenCalledWith(superAdmin, {
      appName: 'Acme',
      primaryColor: '#0D9488',
      logoUrl: 'https://cdn.example.com/logo.png',
    })
  })

  it('resets branding to defaults for the super-admin', async () => {
    const { persistence, deps } = makeDeps()
    persistence.setBranding.mockResolvedValue({ error: null })

    const result = await resetWorkspaceBranding(superAdmin, deps)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual(DEFAULT_BRANDING)
    expect(persistence.setBranding).toHaveBeenCalledWith(superAdmin, DEFAULT_BRANDING)
  })

  it('gates the super-admin branding read', async () => {
    const { deps } = makeDeps()
    const denied = await getAdminWorkspaceBranding(admin, deps)
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN')
  })
})
