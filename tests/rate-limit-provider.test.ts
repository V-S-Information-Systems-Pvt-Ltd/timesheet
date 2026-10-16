import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  nativeReserve: vi.fn(async () => ({ reserved: true, count: 1 })),
  nativeRelease: vi.fn(async () => {}),
}))

vi.mock('@/lib/db/native/operations', () => ({
  nativeOperationsPersistence: {
    reserveRateLimit: mocks.nativeReserve,
    releaseRateLimit: mocks.nativeRelease,
  },
}))

const reservation = {
  bucket: 'daily-login',
  subjectHash: 'hashed-subject',
  windowStart: new Date('2026-09-26T11:00:00.000Z'),
  resetAt: new Date('2026-09-26T12:00:00.000Z'),
  limit: 10,
}

describe('rate-limit store composition', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('routes reserve and release through the native adapter', async () => {
    const { rateLimitStore } = await import('@/lib/db/rate-limits')

    await expect(rateLimitStore.reserve(reservation)).resolves.toEqual({ reserved: true, count: 1 })
    await rateLimitStore.release({
      bucket: reservation.bucket,
      subjectHash: reservation.subjectHash,
      windowStart: reservation.windowStart,
    })

    expect(mocks.nativeReserve).toHaveBeenCalledExactlyOnceWith(reservation)
    expect(mocks.nativeRelease).toHaveBeenCalledExactlyOnceWith({
      bucket: reservation.bucket,
      subjectHash: reservation.subjectHash,
      windowStart: reservation.windowStart,
    })
  })

  it('propagates a storage failure to the limiter policy', async () => {
    mocks.nativeReserve.mockRejectedValueOnce(new Error('storage unavailable'))
    const { rateLimitStore } = await import('@/lib/db/rate-limits')

    await expect(rateLimitStore.reserve(reservation)).rejects.toThrow('storage unavailable')
  })
})
