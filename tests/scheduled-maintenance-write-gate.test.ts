import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('scheduled-maintenance write gate', () => {
  it('reads native gate state directly from the database', async () => {
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
    const query = vi.fn().mockResolvedValue([])
    vi.doMock('@/lib/db/pool', () => ({ query }))

    const { readScheduledMaintenanceWriteGate } = await import('@/lib/db/write-gate')
    await expect(readScheduledMaintenanceWriteGate()).resolves.toBeNull()
    expect(query).toHaveBeenCalledTimes(1)
  })
})
