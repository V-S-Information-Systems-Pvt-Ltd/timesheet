// lib/rate-limit.ts
// In-memory fixed-window rate limiter for the native backend.
// Keyed by `${userId}:${action}` so each user gets an independent budget.
// Windows reset at bucket boundaries (e.g. 100/day rolls at midnight UTC).
// Prune-on-read evicts expired windows lazily.

export interface RateLimitResult {
  ok: boolean
  remaining: number
  resetAt: number | null
}

interface Window {
  count: number
  resetAt: number
}

const stores = new Map<string, Map<string, Window>>()

/** Window sizes in milliseconds. */
export const WINDOWS = {
  day: 24 * 60 * 60 * 1000,
  hour: 60 * 60 * 1000,
  minute: 60 * 1000,
}

export const RATE_LIMIT_DAILY = 100 // writes/day per user
export const RATE_LIMIT_IMPORT = 10 // imports/day per user
export const RATE_LIMIT_LOGIN = 10 // login attempts/hour per email

/** Pre-configured stores. */
export const dailyWriteStore: Map<string, Window> = new Map()
export const dailyImportStore: Map<string, Window> = new Map()
export const dailyLoginStore: Map<string, Window> = new Map()

stores.set('daily-writes', dailyWriteStore)
stores.set('daily-import', dailyImportStore)
stores.set('daily-login', dailyLoginStore)

/**
 * Check whether `key` has remaining budget within the given window.
 * Prune-on-read evicts expired windows lazily.
 */
export function checkRateLimit(
  store: Map<string, Window>,
  key: string,
  limit: number,
  windowMs: number = WINDOWS.day,
  now: number = Date.now()
): RateLimitResult {
  prune(store, now)

  const resetAt = Math.floor(now / windowMs) * windowMs + windowMs
  const existing = store.get(key)

  if (existing && existing.resetAt === resetAt) {
    if (existing.count >= limit) {
      return { ok: false, remaining: 0, resetAt: existing.resetAt }
    }
    existing.count++
    return { ok: true, remaining: limit - existing.count, resetAt }
  }

  store.set(key, { count: 1, resetAt })
  return { ok: true, remaining: limit - 1, resetAt }
}

/** Seconds until `resetAt`, rounded up; 0 when already past. */
export function getRetryAfter(resetAt: number | null, now: number = Date.now()): number {
  if (!resetAt) return 0
  return Math.max(0, Math.ceil((resetAt - now) / 1000))
}

/** Prune windows whose reset time has passed. */
export function prune(store: Map<string, Window>, now: number = Date.now()): void {
  for (const [key, w] of store) {
    if (w.resetAt <= now) store.delete(key)
  }
}

/** Bucket name → store, for convenience. */
export function getStore(bucket: string): Map<string, Window> | undefined {
  return stores.get(bucket)
}

/** Convenience wrapper: rate-limit a daily budget by key. */
export function rateLimit(
  store: Map<string, Window>,
  key: string,
  limit: number,
  now: number = Date.now()
): RateLimitResult {
  return checkRateLimit(store, key, limit, WINDOWS.day, now)
}
