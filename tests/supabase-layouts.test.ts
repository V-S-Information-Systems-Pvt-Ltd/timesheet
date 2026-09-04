// tests/supabase-layouts.test.ts
// Tests for supabase repository getDefaultLayouts DbResult contract.
// Verifies both success and error paths.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { supabaseRepository } from '@/lib/db/supabase'
import type { DashboardLayout, AdminDashboardLayout, MobileLayout } from '@/app/types'

const actor = {
  id: 'user-1',
  email: 'user@x.com',
  role: 'admin' as const,
  permission_role: 'admin' as const,
  hierarchy_role: 'user' as const,
  isActive: true,
}

function makeClient(result: { data: unknown; error: unknown }) {
  const builder = {
    from: () => ({
      select: () => ({
        maybeSingle: () => Promise.resolve(result),
      }),
    }),
  }
  vi.mocked(createClient).mockResolvedValue(builder as never)
}

beforeEach(() => vi.clearAllMocks())

describe('supabase repository getDefaultLayouts (DbResult contract)', () => {
  it('returns { data, error: null } when query succeeds with stored layouts', async () => {
    const layout = { tiles: [{ id: 'timesheet', enabled: true }] }
    const adminLayout = { tiles: [{ id: 'users', enabled: true }] }
    const mobileLayout = { modules: [{ id: 'timesheets', enabled: true }] }

    makeClient({
      data: {
        default_dashboard_layout: layout,
        default_admin_layout: adminLayout,
        default_mobile_layout: mobileLayout,
      },
      error: null,
    })

    const result = await supabaseRepository.getDefaultLayouts(actor)
    expect(result.error).toBeNull()
    expect(result.data).toEqual({ dashboard: layout, admin: adminLayout, mobile: mobileLayout })
  })

  it('falls back to default layouts when columns are null', async () => {
    makeClient({
      data: { default_dashboard_layout: null, default_admin_layout: null, default_mobile_layout: null },
      error: null,
    })

    const result = await supabaseRepository.getDefaultLayouts(actor)
    expect(result.error).toBeNull()
    expect(result.data).not.toBeNull()
    expect(Array.isArray(result.data?.dashboard?.tiles)).toBe(true)
    expect(Array.isArray(result.data?.admin?.tiles)).toBe(true)
    expect(Array.isArray(result.data?.mobile?.modules)).toBe(true)
  })

  it('returns { data: null, error: message } when the query fails', async () => {
    makeClient({ data: null, error: { message: 'supabase connection refused' } })

    const result = await supabaseRepository.getDefaultLayouts(actor)
    expect(result.data).toBeNull()
    expect(result.error).toBe('supabase connection refused')
  })
})

describe('supabase repository setDefaultLayouts tri-state contract', () => {
  const dashLayout: DashboardLayout = { tiles: [{ id: 'entries', enabled: true }] }
  const admLayout: AdminDashboardLayout = { tiles: [{ id: 'settings', enabled: true }] }
  const mobLayout: MobileLayout = { modules: [{ id: 'timesheets', enabled: true, placement: 'home' }] }

  beforeEach(() => {
    process.env.SUPER_ADMIN_EMAIL = 'user@x.com'
  })

  it('preserves default_mobile_layout when mobile is undefined', async () => {
    let updatedPayload: Record<string, unknown> | null = null
    const builder = {
      from: () => ({
        update: (payload: Record<string, unknown>) => {
          updatedPayload = payload
          return {
            eq: () => Promise.resolve({ error: null }),
          }
        },
      }),
    }
    vi.mocked(createClient).mockResolvedValue(builder as never)

    const res = await supabaseRepository.setDefaultLayouts(actor, {
      dashboard: dashLayout,
      admin: admLayout,
      mobile: undefined,
    })

    expect(res.error).toBeNull()
    expect(updatedPayload).not.toBeNull()
    expect(updatedPayload!).not.toHaveProperty('default_mobile_layout')
    expect(updatedPayload!.default_dashboard_layout).toEqual(dashLayout)
    expect(updatedPayload!.default_admin_layout).toEqual(admLayout)
  })

  it('clears default_mobile_layout to null when mobile is null', async () => {
    let updatedPayload: Record<string, unknown> | null = null
    const builder = {
      from: () => ({
        update: (payload: Record<string, unknown>) => {
          updatedPayload = payload
          return {
            eq: () => Promise.resolve({ error: null }),
          }
        },
      }),
    }
    vi.mocked(createClient).mockResolvedValue(builder as never)

    const res = await supabaseRepository.setDefaultLayouts(actor, {
      dashboard: dashLayout,
      admin: admLayout,
      mobile: null,
    })

    expect(res.error).toBeNull()
    expect(updatedPayload).not.toBeNull()
    expect(updatedPayload!.default_mobile_layout).toBeNull()
  })

  it('replaces default_mobile_layout with JSON object when mobile is an object', async () => {
    let updatedPayload: Record<string, unknown> | null = null
    const builder = {
      from: () => ({
        update: (payload: Record<string, unknown>) => {
          updatedPayload = payload
          return {
            eq: () => Promise.resolve({ error: null }),
          }
        },
      }),
    }
    vi.mocked(createClient).mockResolvedValue(builder as never)

    const res = await supabaseRepository.setDefaultLayouts(actor, {
      dashboard: dashLayout,
      admin: admLayout,
      mobile: mobLayout,
    })

    expect(res.error).toBeNull()
    expect(updatedPayload).not.toBeNull()
    expect(updatedPayload!.default_mobile_layout).toEqual(mobLayout)
  })
})
