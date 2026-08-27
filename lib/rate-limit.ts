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
export const RATE_LIMIT_SIGNUP = 10 // signup attempts/hour per IP
export const RATE_LIMIT_PASSWORD = 10 // failed password changes/hour per user+IP

/** Pre-configured stores. */
export const dailyWriteStore: Map<string, Window> = new Map()
export const dailyImportStore: Map<string, Window> = new Map()
export const dailyLoginStore: Map<string, Window> = new Map()
export const dailySignupStore: Map<string, Window> = new Map()
export const dailyPasswordStore: Map<string, Window> = new Map()

stores.set('daily-writes', dailyWriteStore)
stores.set('daily-import', dailyImportStore)
stores.set('daily-login', dailyLoginStore)
stores.set('daily-signup', dailySignupStore)
stores.set('daily-password', dailyPasswordStore)

/**
 * Check whether `key` has remaining budget within the given window WITHOUT
 * consuming any budget. Prune-on-read evicts expired windows lazily.
 *
 * Combined with `consumeRateLimit` this lets callers reject early when a
 * budget is exhausted (peek) while only counting a slot once the guarded
 * action actually succeeds (consume) — so failed/aborted attempts don't burn
 * the budget.
 */
export function peekRateLimit(
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
    return { ok: true, remaining: limit - existing.count, resetAt }
  }

  return { ok: true, remaining: limit, resetAt }
}

/** Consume one unit of `key`'s budget within the given window. */
export function consumeRateLimit(
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
    existing.count++
    return { ok: existing.count <= limit, remaining: Math.max(0, limit - existing.count), resetAt }
  }

  store.set(key, { count: 1, resetAt })
  return { ok: true, remaining: limit - 1, resetAt }
}

/**
 * Check `key`'s budget and, if within the limit, consume one unit.
 * (Equivalent to `peekRateLimit` then `consumeRateLimit`; kept for callers
 * that treat each guarded call as one unit regardless of success/failure.)
 */
export function checkRateLimit(
  store: Map<string, Window>,
  key: string,
  limit: number,
  windowMs: number = WINDOWS.day,
  now: number = Date.now()
): RateLimitResult {
  const peeked = peekRateLimit(store, key, limit, windowMs, now)
  if (!peeked.ok) return peeked
  return consumeRateLimit(store, key, limit, windowMs, now)
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

/** Check user's daily write budget without consuming it. */
export function peekWriteRateLimit(actorId: string): { ok: true } | { ok: false; error: string; resetAt: number | null; retryAfter: number } {
  const result = peekRateLimit(dailyWriteStore, `writes:${actorId}`, RATE_LIMIT_DAILY)
  if (!result.ok) {
    const retry = getRetryAfter(result.resetAt)
    return { ok: false, error: `Rate limit exceeded. Try again in ${retry}s.`, resetAt: result.resetAt, retryAfter: retry }
  }
  return { ok: true }
}

/** Consume 1 unit of user's daily write budget upon successful write. */
export function consumeWriteRateLimit(actorId: string): void {
  consumeRateLimit(dailyWriteStore, `writes:${actorId}`, RATE_LIMIT_DAILY)
}
