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

    makeClient({
      data: {
        default_dashboard_layout: layout,
        default_admin_layout: adminLayout,
      },
      error: null,
    })

    const result = await supabaseRepository.getDefaultLayouts(actor)
    expect(result.error).toBeNull()
    expect(result.data).toEqual({ dashboard: layout, admin: adminLayout })
  })

  it('falls back to default layouts when columns are null', async () => {
    makeClient({
      data: { default_dashboard_layout: null, default_admin_layout: null },
      error: null,
    })

    const result = await supabaseRepository.getDefaultLayouts(actor)
    expect(result.error).toBeNull()
    expect(result.data).not.toBeNull()
    expect(Array.isArray(result.data?.dashboard?.tiles)).toBe(true)
    expect(Array.isArray(result.data?.admin?.tiles)).toBe(true)
  })

  it('returns { data: null, error: message } when the query fails', async () => {
    makeClient({ data: null, error: { message: 'supabase connection refused' } })

    const result = await supabaseRepository.getDefaultLayouts(actor)
    expect(result.data).toBeNull()
    expect(result.error).toBe('supabase connection refused')
  })
})
