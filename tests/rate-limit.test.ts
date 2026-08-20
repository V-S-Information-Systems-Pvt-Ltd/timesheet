// tests/rate-limit.test.ts
// Unit tests for the in-memory fixed-window rate limiter (lib/rate-limit.ts).
// Phase 3 §3.2: rate-limited endpoints return 429 when exceeded (callers use
// the boolean on RateLimitResult and Retry-After).
import { describe, expect, it, beforeEach } from 'vitest'
import {
  WINDOWS,
  RATE_LIMIT_DAILY,
  RATE_LIMIT_IMPORT,
  RATE_LIMIT_LOGIN,
  checkRateLimit,
  peekRateLimit,
  consumeRateLimit,
  getRetryAfter,
  prune,
  getStore,
  rateLimit,
  dailyWriteStore,
  dailyImportStore,
  dailyLoginStore,
} from '../lib/rate-limit'

describe('checkRateLimit', () => {
  const store = new Map<string, { count: number; resetAt: number }>()

  beforeEach(() => {
    store.clear()
  })

  it('allows requests up to the limit and then blocks', () => {
    const now = 1_000_000_000_000
    const first = checkRateLimit(store, 'u1', 2, WINDOWS.day, now)
    expect(first.ok).toBe(true)
    expect(first.remaining).toBe(1)

    const second = checkRateLimit(store, 'u1', 2, WINDOWS.day, now)
    expect(second.ok).toBe(true)
    expect(second.remaining).toBe(0)

    const third = checkRateLimit(store, 'u1', 2, WINDOWS.day, now)
    expect(third.ok).toBe(false)
    expect(third.remaining).toBe(0)
    // The blocked result still reports when the window resets.
    expect(third.resetAt).toBeGreaterThan(now)
  })

  it('resets after the window boundary passes', () => {
    const windowMs = 60_000 // 1 minute window
    const t0 = 1_000_000_000_000
    checkRateLimit(store, 'u1', 1, windowMs, t0) // consumes the single slot
    const blocked = checkRateLimit(store, 'u1', 1, windowMs, t0)
    expect(blocked.ok).toBe(false)

    // A minute later the window has rolled over and the budget is available again.
    const after = checkRateLimit(store, 'u1', 1, windowMs, t0 + windowMs)
    expect(after.ok).toBe(true)
    expect(after.remaining).toBe(0)
  })

  it('gives each key an independent budget', () => {
    const now = 1_000_000_000_000
    checkRateLimit(store, 'u1', 1, WINDOWS.day, now)
    const other = checkRateLimit(store, 'u2', 1, WINDOWS.day, now)
    expect(other.ok).toBe(true)
  })

  it('getRetryAfter is seconds until reset, capped at 0 when past', () => {
    const resetAt = 1_000_000_050_000
    expect(getRetryAfter(resetAt, 1_000_000_000_000)).toBe(50)
    expect(getRetryAfter(resetAt, 1_000_000_100_000)).toBe(0)
    expect(getRetryAfter(null)).toBe(0)
  })

  it('prune removes expired windows', () => {
    checkRateLimit(store, 'u1', 1, WINDOWS.day, 1_000_000_000_000)
    expect(store.size).toBe(1)
    prune(store, 999_999_000_000) // before resetAt? no-op
    // Move far past the window: the entry is now expired and pruned.
    prune(store, 1_000_000_000_000 + WINDOWS.day + 1)
    expect(store.size).toBe(0)
  })
})

describe('configured constants and stores', () => {
  it('exposes the plan thresholds', () => {
    expect(RATE_LIMIT_DAILY).toBe(100)
    expect(RATE_LIMIT_IMPORT).toBe(10)
    expect(RATE_LIMIT_LOGIN).toBe(10)
  })

  it('wire the pre-configured stores by bucket name', () => {
    expect(getStore('daily-writes')).toBe(dailyWriteStore)
    expect(getStore('daily-import')).toBe(dailyImportStore)
    expect(getStore('daily-login')).toBe(dailyLoginStore)
    expect(getStore('nope')).toBeUndefined()
  })

  it('rateLimit() is a daily-budget convenience wrapper', () => {
    const now = 1_000_000_000_000
    const result = rateLimit(dailyWriteStore, 'writes:u1', 100, now)
    expect(result.ok).toBe(true)
    expect(result.resetAt).toBeGreaterThan(now)
  })
})

describe('peekRateLimit / consumeRateLimit', () => {
  const store = new Map<string, { count: number; resetAt: number }>()

  beforeEach(() => {
    store.clear()
  })

  it('peek does NOT consume budget but reports remaining', () => {
    const first = peekRateLimit(store, 'u1', 3, WINDOWS.day, 1_000_000_000_000)
    expect(first.ok).toBe(true)
    expect(first.remaining).toBe(3)
    // Nothing was stored/consumed.
    expect(store.size).toBe(0)
    expect(peekRateLimit(store, 'u1', 3, WINDOWS.day, 1_000_000_000_000).remaining).toBe(3)
  })

  it('peek reflects slots consumed by consumeRateLimit and blocks at the limit', () => {
    consumeRateLimit(store, 'u1', 2, WINDOWS.day, 1_000_000_000_000)
    consumeRateLimit(store, 'u1', 2, WINDOWS.day, 1_000_000_000_000)
    expect(peekRateLimit(store, 'u1', 2, WINDOWS.day, 1_000_000_000_000).ok).toBe(false)
    // Reached the limit without a further consume being needed.
    expect(consumeRateLimit(store, 'u1', 2, WINDOWS.day, 1_000_000_000_000).ok).toBe(false)
  })

  it('checkRateLimit is peek-then-consume', () => {
    const first = checkRateLimit(store, 'u1', 1, WINDOWS.day, 1_000_000_000_000)
    expect(first.ok).toBe(true)
    expect(store.size).toBe(1)
    expect(peekRateLimit(store, 'u1', 1, WINDOWS.day, 1_000_000_000_000).ok).toBe(false)
  })
})
