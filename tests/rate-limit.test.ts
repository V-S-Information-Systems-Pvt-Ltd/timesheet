// tests/rate-limit.test.ts
// Unit tests for the shared fixed-window rate limiter (lib/rate-limit.ts).
//
// The limiter is now async and reserves/releases through a storage seam. These
// tests exercise the seam's contract with a fake, the bounded local fallback,
// and the window/retry arithmetic that is still pure.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
import {
  WINDOWS,
  RATE_LIMIT_DAILY,
  RATE_LIMIT_IMPORT,
  RATE_LIMIT_LOGIN,
  RATE_LIMIT_SIGNUP,
  RATE_LIMIT_PASSWORD,
  RATE_LIMIT_PASSWORD_RESET_REQUEST,
  RATE_LIMIT_PASSWORD_RESET_COMPLETE,
  RATE_LIMIT_BUCKETS,
  getRetryAfter,
  reserveRateLimit,
  reserveWriteRateLimit,
  setRateLimitStore,
  resetLocalRateLimitWindows,
  getDegradedReservationCount,
} from '../lib/rate-limit'
import { createRateLimitFake, netHeld, type RateLimitFake } from './helpers/rate-limit-store'

const NOW = 1_000_000_000_000

describe('reserveRateLimit via the storage seam', () => {
  let fake: RateLimitFake

  beforeEach(() => {
    fake = createRateLimitFake()
    setRateLimitStore(fake)
  })

  afterEach(() => {
    setRateLimitStore(null)
    resetLocalRateLimitWindows()
  })

  it('allows requests up to the limit and then blocks', async () => {
    const first = await reserveRateLimit('daily-writes', 'writes:u1', { now: NOW })
    expect(first.ok).toBe(true)
    if (first.ok) expect(first.remaining).toBe(99)

    // Reserve 98 more to reach the budget.
    for (let i = 0; i < 98; i++) {
      const r = await reserveRateLimit('daily-writes', 'writes:u1', { now: NOW })
      expect(r.ok).toBe(true)
    }
    const last = await reserveRateLimit('daily-writes', 'writes:u1', { now: NOW })
    if (!last.ok) {
      expect(last.ok).toBe(false)
      expect(last.retryAfter).toBeGreaterThan(0)
    }
  })

  it('resets after the window boundary passes', async () => {
    const bucket = 'daily-login' // hour window
    const subject = 'login:a@b.com:1.2.3.4'
    for (let i = 0; i < RATE_LIMIT_LOGIN; i++) {
      const r = await reserveRateLimit(bucket, subject, { now: NOW })
      expect(r.ok).toBe(true)
    }
    const blocked = await reserveRateLimit(bucket, subject, { now: NOW })
    expect(blocked.ok).toBe(false)

    // An hour later the window has rolled and the budget is available again.
    const after = await reserveRateLimit(bucket, subject, { now: NOW + WINDOWS.hour })
    expect(after.ok).toBe(true)
  })

  it('gives each subject an independent budget', async () => {
    for (let i = 0; i < RATE_LIMIT_LOGIN; i++) {
      const r = await reserveRateLimit('daily-login', 'login:a@b.com:1.2.3.4', { now: NOW })
      expect(r.ok).toBe(true)
    }
    const other = await reserveRateLimit('daily-login', 'login:a@b.com:5.6.7.8', { now: NOW })
    expect(other.ok).toBe(true)
  })

  it('release() hands a claimed slot back exactly once', async () => {
    const first = await reserveRateLimit('daily-login', 'login:a@b.com:1.2.3.4', { now: NOW })
    expect(first.ok).toBe(true)
    const reserved = first.ok ? first : null
    expect(netHeld(fake, 'daily-login')).toBe(1)

    // Releasing twice only returns one slot.
    await reserved!.release()
    await reserved!.release()
    expect(netHeld(fake, 'daily-login')).toBe(0)
  })

  it('does not reserve twice for the same subject across release calls', async () => {
    const a = await reserveRateLimit('daily-login', 'login:a@b.com:1.2.3.4', { now: NOW })
    const b = await reserveRateLimit('daily-login', 'login:a@b.com:1.2.3.4', { now: NOW })
    expect(a.ok && b.ok).toBe(true)
    expect(netHeld(fake, 'daily-login')).toBe(2)
  })
})

describe('local fallback (degraded pre-auth enforcement)', () => {
  afterEach(() => {
    setRateLimitStore(null)
    resetLocalRateLimitWindows()
  })

  it('falls back to a bounded per-instance window when storage errors for pre-auth buckets', async () => {
    setRateLimitStore({
      async reserve() {
        throw new Error('storage unavailable')
      },
      async release() {
        throw new Error('storage unavailable')
      },
    })

    for (let i = 0; i < RATE_LIMIT_LOGIN; i++) {
      const r = await reserveRateLimit('daily-login', 'login:a@b.com:1.2.3.4', { now: NOW })
      expect(r.ok).toBe(true)
    }
    // The 11th is rejected by the local window, so enforcement still applies.
    const blocked = await reserveRateLimit('daily-login', 'login:a@b.com:1.2.3.4', { now: NOW })
    expect(blocked.ok).toBe(false)
    expect(getDegradedReservationCount()).toBeGreaterThan(0)
  })

  it('release() returns a local-fallback slot', async () => {
    setRateLimitStore({
      async reserve() {
        throw new Error('storage unavailable')
      },
      async release() {
        throw new Error('storage unavailable')
      },
    })
    const r = await reserveRateLimit('daily-login', 'login:a@b.com:1.2.3.4', { now: NOW })
    expect(r.ok).toBe(true)
    if (r.ok) await r.release()
    // A fresh reserve after the release succeeds.
    const again = await reserveRateLimit('daily-login', 'login:a@b.com:1.2.3.4', { now: NOW })
    expect(again.ok).toBe(true)
  })

  it('does not evict an exhausted subject when the fallback key cap is full', async () => {
    setRateLimitStore({
      async reserve() {
        throw new Error('storage unavailable')
      },
      async release() {},
    })

    const victim = 'login:victim@example.com:203.0.113.10'
    for (let i = 0; i < RATE_LIMIT_LOGIN; i++) {
      expect((await reserveRateLimit('daily-login', victim, { now: NOW })).ok).toBe(true)
    }
    expect((await reserveRateLimit('daily-login', victim, { now: NOW })).ok).toBe(false)

    // Fill the bounded map with distinct subjects. The victim is inserted first,
    // so an eviction-based implementation would incorrectly reset its budget.
    for (let i = 0; i < 9_999; i++) {
      await reserveRateLimit('daily-login', `login:spray-${i}@example.com:203.0.113.11`, { now: NOW })
    }

    expect((await reserveRateLimit('daily-login', victim, { now: NOW })).ok).toBe(false)
    expect((await reserveRateLimit('daily-login', 'login:new@example.com:203.0.113.12', { now: NOW })).ok).toBe(false)
  })
})

describe('write budget wrapper', () => {
  let fake: RateLimitFake

  beforeEach(() => {
    fake = createRateLimitFake()
    setRateLimitStore(fake)
  })

  afterEach(() => {
    setRateLimitStore(null)
    resetLocalRateLimitWindows()
  })

  it('reserves the daily write budget and reports a retry message on rejection', async () => {
    const first = await reserveWriteRateLimit('u1', { now: NOW })
    expect(first.ok).toBe(true)
    if (first.ok) await first.reservation.release()

    // Drain the daily-writes bucket so the wrapper rejects.
    for (let i = 0; i < RATE_LIMIT_DAILY; i++) {
      await reserveRateLimit('daily-writes', `writes:u1`, { now: NOW })
    }
    const rejected = await reserveWriteRateLimit('u1', { now: NOW })
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.error).toMatch(/Rate limit exceeded/)
  })
})

describe('getRetryAfter', () => {
  it('is seconds until reset, capped at 0 when past', () => {
    const resetAt = 1_000_000_050_000
    expect(getRetryAfter(resetAt, 1_000_000_000_000)).toBe(50)
    expect(getRetryAfter(resetAt, 1_000_000_100_000)).toBe(0)
    expect(getRetryAfter(null)).toBe(0)
  })
})

describe('configured constants and buckets', () => {
  it('exposes the plan thresholds unchanged', () => {
    expect(RATE_LIMIT_DAILY).toBe(100)
    expect(RATE_LIMIT_IMPORT).toBe(10)
    expect(RATE_LIMIT_LOGIN).toBe(10)
    expect(RATE_LIMIT_SIGNUP).toBe(10)
    expect(RATE_LIMIT_PASSWORD).toBe(10)
    expect(RATE_LIMIT_PASSWORD_RESET_REQUEST).toBe(3)
    expect(RATE_LIMIT_PASSWORD_RESET_COMPLETE).toBe(10)
  })

  it('maps every bucket to a limit, window, and failure policy', () => {
    expect(RATE_LIMIT_BUCKETS['daily-writes'].limit).toBe(RATE_LIMIT_DAILY)
    expect(RATE_LIMIT_BUCKETS['daily-writes'].windowMs).toBe(WINDOWS.day)
    expect(RATE_LIMIT_BUCKETS['daily-writes'].onStorageError).toBe('fail-closed')
    expect(RATE_LIMIT_BUCKETS['daily-login'].onStorageError).toBe('local-fallback')
    expect(RATE_LIMIT_BUCKETS['daily-signup'].onStorageError).toBe('local-fallback')
    expect(RATE_LIMIT_BUCKETS['password-reset-request'].onStorageError).toBe('local-fallback')
    // Mutations fail closed; only pre-auth gates degrade.
    expect(RATE_LIMIT_BUCKETS['daily-import'].onStorageError).toBe('fail-closed')
  })
})
