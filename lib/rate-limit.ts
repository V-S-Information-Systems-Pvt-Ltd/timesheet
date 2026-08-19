// lib/rate-limit.ts
// In-memory sliding-window rate limiter.
// Keyed by identifier (IP address or user ID). Not shared across workers
// — sufficient for single-instance deployments; swap the store for Redis
// in a multi-instance setup.

type Entry = { count: number; resetAt: number }

const store = new Map<string, Entry>()

function prune(now: number) {
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key)
  }
}

/**
 * Returns true when the request is allowed, false when rate-limited.
 * When false, the caller should respond with 429 and a Retry-After header.
 */
export function rateLimit(identifier: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  prune(now)

  const entry = store.get(identifier)
  if (!entry || entry.resetAt <= now) {
    store.set(identifier, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (entry.count >= max) {
    return false
  }

  entry.count++
  return true
}

export function getRetryAfter(identifier: string): number | null {
  const entry = store.get(identifier)
  if (!entry) return null
  const now = Date.now()
  if (entry.resetAt <= now) {
    store.delete(identifier)
    return null
  }
  return Math.ceil((entry.resetAt - now) / 1000)
}
