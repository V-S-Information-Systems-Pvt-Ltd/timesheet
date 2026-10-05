import { afterEach, describe, expect, it, vi } from 'vitest'

const originalBackend = process.env.NEXT_PUBLIC_BACKEND

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  if (originalBackend === undefined) delete process.env.NEXT_PUBLIC_BACKEND
  else process.env.NEXT_PUBLIC_BACKEND = originalBackend
})

describe('scheduled-maintenance write gate', () => {
  it('uses the privileged Supabase client without request-scoped auth state', async () => {
    process.env.NEXT_PUBLIC_BACKEND = 'supabase'

    const maybeSingle = vi.fn().mockResolvedValue({
      data: { state: 'open', run_id: null, reason: null },
      error: null,
    })
    const select = vi.fn(() => ({ maybeSingle }))
    const from = vi.fn(() => ({ select }))
    const getAdminClient = vi.fn(() => ({ from }))
    const getMobileSupabaseClient = vi.fn()
    const createClient = vi.fn()

    vi.doMock('@/lib/supabase/admin', () => ({ getAdminClient }))
    vi.doMock('@/lib/supabase/bearer', () => ({ getMobileSupabaseClient }))
    vi.doMock('@/lib/supabase/server', () => ({ createClient }))

    const { readScheduledMaintenanceWriteGate } = await import('@/lib/db/write-gate')
    await expect(readScheduledMaintenanceWriteGate()).resolves.toEqual({
      state: 'open',
      runId: null,
      reason: null,
    })

    expect(getAdminClient).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('migration_write_gate')
    expect(getMobileSupabaseClient).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
  })

  it('surfaces Supabase gate read failures so cron can fail closed', async () => {
    process.env.NEXT_PUBLIC_BACKEND = 'supabase'

    const from = vi.fn(() => ({
      select: () => ({
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: { code: '42501', message: 'permission denied' },
        }),
      }),
    }))
    vi.doMock('@/lib/supabase/admin', () => ({ getAdminClient: () => ({ from }) }))

    const { readScheduledMaintenanceWriteGate } = await import('@/lib/db/write-gate')
    await expect(readScheduledMaintenanceWriteGate()).rejects.toMatchObject({ code: '42501' })
  })

  it('does not treat a missing Supabase gate relation as an open deployment', async () => {
    process.env.NEXT_PUBLIC_BACKEND = 'supabase'

    const from = vi.fn(() => ({
      select: () => ({
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST205', message: 'relation is not present in the schema cache' },
        }),
      }),
    }))
    vi.doMock('@/lib/supabase/admin', () => ({ getAdminClient: () => ({ from }) }))

    const { readScheduledMaintenanceWriteGate } = await import('@/lib/db/write-gate')
    await expect(readScheduledMaintenanceWriteGate()).rejects.toMatchObject({ code: 'PGRST205' })
  })

  it('reads native gate state directly from the database', async () => {
    process.env.NEXT_PUBLIC_BACKEND = 'native'

    const query = vi.fn().mockResolvedValue([
      { state: 'fenced', run_id: 'run-1', reason: 'migration window' },
    ])
    vi.doMock('@/lib/db/pool', () => ({ query }))

    const { readScheduledMaintenanceWriteGate } = await import('@/lib/db/write-gate')
    await expect(readScheduledMaintenanceWriteGate()).resolves.toEqual({
      state: 'fenced',
      runId: 'run-1',
      reason: 'migration window',
    })

    expect(query).toHaveBeenCalledTimes(1)
  })

  it('returns null when the native gate row is missing so cron can fail closed', async () => {
    process.env.NEXT_PUBLIC_BACKEND = 'native'

    const query = vi.fn().mockResolvedValue([])
    vi.doMock('@/lib/db/pool', () => ({ query }))

    const { readScheduledMaintenanceWriteGate } = await import('@/lib/db/write-gate')
    await expect(readScheduledMaintenanceWriteGate()).resolves.toBeNull()
    expect(query).toHaveBeenCalledTimes(1)
  })
})
