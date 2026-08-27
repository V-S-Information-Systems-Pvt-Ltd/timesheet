import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { mockFrom, mockGetAdminClient } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ getAdminClient: mockGetAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { listSupabaseMobileActorTimesheets } from '@/lib/db/supabase'

beforeEach(() => {
  vi.clearAllMocks()
  const query = Object.assign(Promise.resolve({ data: [], error: null, count: 0 }), {
    order: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    range: vi.fn(),
    limit: vi.fn(),
  })
  query.order.mockReturnValue(query)
  query.eq.mockReturnValue(query)
  query.gte.mockReturnValue(query)
  query.lte.mockReturnValue(query)
  query.range.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  mockFrom.mockReturnValue({ select: vi.fn().mockReturnValue(query) })
  mockGetAdminClient.mockReturnValue({ from: mockFrom })
})

describe('listSupabaseMobileActorTimesheets', () => {
  it('uses the service client but always constrains rows to the authenticated actor', async () => {
    await expect(listSupabaseMobileActorTimesheets('user-1', { dateFrom: '2026-08-01', limit: 10 })).resolves.toEqual({ rows: [], count: 0 })
    const query = mockFrom.mock.results[0].value.select.mock.results[0].value
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(query.gte).toHaveBeenCalledWith('log_date', '2026-08-01')
    expect(query.limit).toHaveBeenCalledWith(10)
  })
})
