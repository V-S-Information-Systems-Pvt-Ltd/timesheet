import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isNative: true,
  nativeReserve: vi.fn(async () => ({ reserved: true, count: 1 })),
  nativeRelease: vi.fn(async () => {}),
  supabaseReserve: vi.fn(async () => ({ reserved: true, count: 1 })),
  supabaseRelease: vi.fn(async () => {}),
}))

vi.mock('@/lib/backend/config', () => ({
  get IS_NATIVE() { return mocks.isNative },
}))

vi.mock('@/lib/db/native/operations', () => ({
  nativeOperationsPersistence: {
    reserveRateLimit: mocks.nativeReserve,
    releaseRateLimit: mocks.nativeRelease,
  },
}))

vi.mock('@/lib/db/supabase/operations', () => ({
  supabaseOperationsPersistence: {
    reserveRateLimit: mocks.supabaseReserve,
    releaseRateLimit: mocks.supabaseRelease,
  },
}))

const reservation = {
  bucket: 'daily-login',
  subjectHash: 'hashed-subject',
  windowStart: new Date('2026-09-26T11:00:00.000Z'),
  resetAt: new Date('2026-09-26T12:00:00.000Z'),
  limit: 10,
}

describe('rate-limit provider composition', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it.each([
    ['native', true],
    ['supabase', false],
  ] as const)('routes reserve and release through the %s adapter', async (_name, isNative) => {
    mocks.isNative = isNative
    const { rateLimitStore } = await import('@/lib/db/rate-limits')

    await expect(rateLimitStore.reserve(reservation)).resolves.toEqual({ reserved: true, count: 1 })
    await rateLimitStore.release({
      bucket: reservation.bucket,
      subjectHash: reservation.subjectHash,
      windowStart: reservation.windowStart,
    })

    const selectedReserve = isNative ? mocks.nativeReserve : mocks.supabaseReserve
    const selectedRelease = isNative ? mocks.nativeRelease : mocks.supabaseRelease
    const otherReserve = isNative ? mocks.supabaseReserve : mocks.nativeReserve
    const otherRelease = isNative ? mocks.supabaseRelease : mocks.nativeRelease

    expect(selectedReserve).toHaveBeenCalledExactlyOnceWith(reservation)
    expect(selectedRelease).toHaveBeenCalledExactlyOnceWith({
      bucket: reservation.bucket,
      subjectHash: reservation.subjectHash,
      windowStart: reservation.windowStart,
    })
    expect(otherReserve).not.toHaveBeenCalled()
    expect(otherRelease).not.toHaveBeenCalled()
  })

  it('propagates a storage failure to the limiter policy', async () => {
    mocks.isNative = false
    mocks.supabaseReserve.mockRejectedValueOnce(new Error('storage unavailable'))
    const { rateLimitStore } = await import('@/lib/db/rate-limits')

    await expect(rateLimitStore.reserve(reservation)).rejects.toThrow('storage unavailable')
    expect(mocks.nativeReserve).not.toHaveBeenCalled()
  })
})
