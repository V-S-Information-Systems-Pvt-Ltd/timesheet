// lib/rate-limit.ts
// Shared fixed-window rate limiter.
//
// Reserve / release, not peek / consume.
// -------------------------------------
// The previous design split every gate into `peekRateLimit` (read, no write) and
// `consumeRateLimit` (write). Because the peek reserved nothing, two concurrent
// requests could both observe budget and both proceed — the limit was advisory
// even inside one process, and with N replicas each got its own N budgets.
//
// Callers now `reserve` atomically up front and `release` the slot back when the
// guarded action turns out not to be chargeable. That collapses the three
// counting policies the codebase had into one primitive:
//
//   failed-auth counting      reserve at the gate, release when auth SUCCEEDS
//   successful-mutation count reserve at the gate, release when the write FAILS
//   every-attempt counting    reserve at the gate, never release
//
// Windows are fixed calendar-aligned buckets (a "daily" budget rolls at 00:00
// UTC), unchanged from the previous implementation. Boundaries are computed here
// and passed to storage as bound parameters, so the database never calls now()
// and the limiter stays deterministic under test.

import { hashRateLimitSubject } from './rate-limit-subject'
import { logger } from './logger'

export interface RateLimitResult {
  ok: boolean
  remaining: number
  resetAt: number | null
}

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
export const RATE_LIMIT_PASSWORD_RESET_REQUEST = 3 // reset requests/hour per email+IP
export const RATE_LIMIT_PASSWORD_RESET_COMPLETE = 10 // invalid reset attempts/hour per IP

/**
 * What to do when shared storage is unavailable.
 *
 * `fail-closed` — reject the request. Correct for mutation budgets: refusing a
 * write costs the user one retry and cannot be used to bypass the limit.
 *
 * `local-fallback` — fall back to a bounded per-process window, logging loudly.
 * Correct for the pre-authentication gates. Failing those closed would convert a
 * login flood into 5xx for legitimate users: the pool is small (DB_POOL_MAX
 * defaults to 10) and every query awaits ensureMigrated(), so the attacked path
 * is exactly the one that exhausts connections. Degraded enforcement bounded per
 * instance is a smaller loss than an authentication outage, and it is never a
 * silent bypass — the limit still applies, just per replica.
 */
export type RateLimitFailurePolicy = 'fail-closed' | 'local-fallback'

interface BucketConfig {
  limit: number
  windowMs: number
  onStorageError: RateLimitFailurePolicy
}

/**
 * Bucket registry. Names, limits, and windows are unchanged from the in-memory
 * implementation so budgets carry over across the migration.
 */
export const RATE_LIMIT_BUCKETS = {
  'daily-writes': { limit: RATE_LIMIT_DAILY, windowMs: WINDOWS.day, onStorageError: 'fail-closed' },
  'daily-import': { limit: RATE_LIMIT_IMPORT, windowMs: WINDOWS.day, onStorageError: 'fail-closed' },
  'daily-login': { limit: RATE_LIMIT_LOGIN, windowMs: WINDOWS.hour, onStorageError: 'local-fallback' },
  'daily-signup': { limit: RATE_LIMIT_SIGNUP, windowMs: WINDOWS.hour, onStorageError: 'local-fallback' },
  'daily-password': { limit: RATE_LIMIT_PASSWORD, windowMs: WINDOWS.hour, onStorageError: 'local-fallback' },
  'password-reset-request': {
    limit: RATE_LIMIT_PASSWORD_RESET_REQUEST,
    windowMs: WINDOWS.hour,
    onStorageError: 'local-fallback',
  },
  'password-reset-complete': {
    limit: RATE_LIMIT_PASSWORD_RESET_COMPLETE,
    windowMs: WINDOWS.hour,
    onStorageError: 'local-fallback',
  },
} as const satisfies Record<string, BucketConfig>

export type RateLimitBucket = keyof typeof RATE_LIMIT_BUCKETS

/** A held slot. Call `release()` to hand it back. */
export interface RateLimitReservation {
  ok: true
  remaining: number
  resetAt: number
  /** Idempotent: releasing twice returns only one slot. */
  release(): Promise<void>
}

export interface RateLimitRejection {
  ok: false
  remaining: 0
  resetAt: number
  retryAfter: number
}

export type RateLimitOutcome = RateLimitReservation | RateLimitRejection

// --- storage -------------------------------------------------------------------

export interface RateLimitStore {
  reserve(input: {
    bucket: string
    subjectHash: string
    windowStart: Date
    resetAt: Date
    limit: number
  }): Promise<{ reserved: boolean; count: number }>
  release(input: { bucket: string; subjectHash: string; windowStart: Date }): Promise<void>
}

let storeOverride: RateLimitStore | null = null

/** Test seam. Pass null to restore the repository-backed store. */
export function setRateLimitStore(store: RateLimitStore | null): void {
  storeOverride = store
}

async function activeStore(): Promise<RateLimitStore> {
  if (storeOverride) return storeOverride
  // Lazy so importing this module does not pull the database adapters into
  // callers that only need the constants.
  const { repo } = await import('./db')
  return {
    reserve: (input) => repo.reserveRateLimit(input),
    release: (input) => repo.releaseRateLimit(input),
  }
}

// --- bounded local fallback ----------------------------------------------------

interface LocalWindow {
  count: number
  resetAt: number
}

/**
 * Cap on distinct keys held per process. The previous implementation was
 * unbounded, so a spray of unique subjects grew the map without limit.
 */
const LOCAL_MAX_KEYS = 10_000

const localWindows = new Map<string, LocalWindow>()

let degradedReservations = 0

/** Count of reservations served from the local fallback since process start. */
export function getDegradedReservationCount(): number {
  return degradedReservations
}

function pruneLocal(now: number): void {
  for (const [key, window] of localWindows) {
    if (window.resetAt <= now) localWindows.delete(key)
  }
}

function reserveLocal(
  key: string,
  limit: number,
  windowStart: number,
  resetAt: number
): { reserved: boolean; count: number } {
  pruneLocal(windowStart)

  const existing = localWindows.get(key)
  if (existing && existing.resetAt === resetAt) {
    if (existing.count >= limit) return { reserved: false, count: existing.count }
    existing.count += 1
    return { reserved: true, count: existing.count }
  }

  // Never evict an active subject to make room for an attacker-controlled new
  // key. Eviction would reset the victim's budget and turn degraded mode into
  // a rate-limit bypass. Reject new subjects while the bounded map is full.
  if (localWindows.size >= LOCAL_MAX_KEYS) return { reserved: false, count: limit }
  localWindows.set(key, { count: 1, resetAt })
  return { reserved: true, count: 1 }
}

function releaseLocal(key: string, resetAt: number): void {
  const existing = localWindows.get(key)
  if (!existing || existing.resetAt !== resetAt) return
  existing.count = Math.max(0, existing.count - 1)
  if (existing.count === 0) localWindows.delete(key)
}

/** Test helper: drop all locally held windows. */
export function resetLocalRateLimitWindows(): void {
  localWindows.clear()
  degradedReservations = 0
}

// --- public API ----------------------------------------------------------------

/** Seconds until `resetAt`, rounded up; 0 when already past. */
export function getRetryAfter(resetAt: number | null, now: number = Date.now()): number {
  if (!resetAt) return 0
  return Math.max(0, Math.ceil((resetAt - now) / 1000))
}

function windowBounds(windowMs: number, now: number): { windowStart: number; resetAt: number } {
  const windowStart = Math.floor(now / windowMs) * windowMs
  return { windowStart, resetAt: windowStart + windowMs }
}

/**
 * Atomically reserve one unit of `subject`'s budget in `bucket`.
 *
 * `subject` is the human-meaningful identity (email, IP, user id). It is HMAC'd
 * before it reaches storage; callers never need to hash it themselves.
 */
export async function reserveRateLimit(
  bucket: RateLimitBucket,
  subject: string,
  options?: { now?: number }
): Promise<RateLimitOutcome> {
  const config: BucketConfig = RATE_LIMIT_BUCKETS[bucket]
  const now = options?.now ?? Date.now()
  const { windowStart, resetAt } = windowBounds(config.windowMs, now)
  const subjectHash = hashRateLimitSubject(bucket, subject)
  const localKey = `${bucket}:${subjectHash}`

  let outcome: { reserved: boolean; count: number }
  let degraded = false

  try {
    const store = await activeStore()
    outcome = await store.reserve({
      bucket,
      subjectHash,
      windowStart: new Date(windowStart),
      resetAt: new Date(resetAt),
      limit: config.limit,
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)

    if (config.onStorageError === 'fail-closed') {
      logger.error('Rate-limit storage unavailable; failing closed', { bucket, error })
      return { ok: false, remaining: 0, resetAt, retryAfter: getRetryAfter(resetAt, now) }
    }

    degraded = true
    degradedReservations += 1
    logger.error('Rate-limit storage unavailable; enforcing per-instance only', {
      bucket,
      error,
      degradedReservations,
    })
    outcome = reserveLocal(localKey, config.limit, windowStart, resetAt)
  }

  if (!outcome.reserved) {
    return { ok: false, remaining: 0, resetAt, retryAfter: getRetryAfter(resetAt, now) }
  }

  let released = false
  return {
    ok: true,
    remaining: Math.max(0, config.limit - outcome.count),
    resetAt,
    async release() {
      if (released) return
      released = true
      if (degraded) {
        releaseLocal(localKey, resetAt)
        return
      }
      try {
        const store = await activeStore()
        await store.release({ bucket, subjectHash, windowStart: new Date(windowStart) })
      } catch (err) {
        // A leaked slot costs the subject one unit of budget this window. It is
        // never a bypass, so it must not fail the caller's request.
        logger.warn('Failed to release rate-limit reservation', {
          bucket,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },
  }
}

/**
 * Reserve the actor's daily write budget.
 *
 * Returns the `{ ok: false, error }` shape server actions return to the client
 * (see app/actions/_shared.ts), plus the reservation so the caller can release
 * it when the write fails.
 */
export async function reserveWriteRateLimit(
  actorId: string,
  options?: { now?: number }
): Promise<
  | { ok: true; reservation: RateLimitReservation }
  | { ok: false; error: string; resetAt: number; retryAfter: number }
> {
  const outcome = await reserveRateLimit('daily-writes', `writes:${actorId}`, options)
  if (!outcome.ok) {
    return {
      ok: false,
      error: `Rate limit exceeded. Try again in ${outcome.retryAfter}s.`,
      resetAt: outcome.resetAt,
      retryAfter: outcome.retryAfter,
    }
  }
  return { ok: true, reservation: outcome }
}
