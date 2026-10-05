import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ getAdminClient: vi.fn() }))

import { getAdminClient } from '@/lib/supabase/admin'
import { supabaseRegistrationPort } from '@/lib/auth/registration-supabase'

const mockGetAdminClient = vi.mocked(getAdminClient)

function mockWhitelistLookup(result: unknown) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const limit = vi.fn(() => ({ maybeSingle }))
  const eq = vi.fn(() => ({ limit }))
  const select = vi.fn(() => ({ eq }))
  mockGetAdminClient.mockReturnValue({ from: vi.fn(() => ({ select })) } as never)
  return { select, eq, limit, maybeSingle }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('supabase registration whitelist lookup', () => {
  it('uses the server admin client for one normalized, exact-domain lookup', async () => {
    const query = mockWhitelistLookup({
      data: { id: 'domain-1', domain: 'vsis.lk', auto_activate: true, created_at: '2026-08-01' },
      error: null,
    })

    await expect(supabaseRegistrationPort.findWhitelistedDomain(' @VSIS.LK ')).resolves.toMatchObject({
      domain: 'vsis.lk',
      autoActivate: true,
    })

    expect(mockGetAdminClient).toHaveBeenCalledOnce()
    expect(query.select).toHaveBeenCalledWith('id, domain, auto_activate')
    expect(query.eq).toHaveBeenCalledWith('domain', 'vsis.lk')
    expect(query.limit).toHaveBeenCalledWith(1)
  })

  it('propagates database errors instead of treating them as a blocked domain', async () => {
    mockWhitelistLookup({ data: null, error: { message: 'database unavailable' } })

    await expect(supabaseRegistrationPort.findWhitelistedDomain('vsis.lk')).rejects.toThrow('database unavailable')
  })
})
