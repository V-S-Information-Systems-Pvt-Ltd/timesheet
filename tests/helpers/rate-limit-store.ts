// tests/helpers/rate-limit-store.ts
// Shared in-memory double for the repository-backed rate-limit store.
//
// The previous limiter exported its Map stores directly, and route/action tests
// reached into them with .clear()/.set()/.get()/.has(). The new limiter keeps
// storage behind a RateLimitStore seam (lib/rate-limit.ts `setRateLimitStore`),
// so these tests assert against a fake with the same two primitives instead.
//
// The fake is an honest fixed-window counter: reserve rejects at the limit,
// release decrements without going negative. It never throws, so it never
// exercises the degraded-fallback path (that is covered by rate-limit.test.ts).

import { vi } from 'vitest'
import type { RateLimitStore } from '@/lib/rate-limit'

export interface RateLimitFake extends RateLimitStore {
  /** bucket:subjectHash -> held count */
  counts: Map<string, number>
  reserveMock: ReturnType<typeof vi.fn>
  releaseMock: ReturnType<typeof vi.fn>
}

function key(bucket: string, subjectHash: string, windowStart: Date): string {
  return `${bucket}:${subjectHash}:${windowStart.getTime()}`
}

export function createRateLimitFake(): RateLimitFake {
  const counts = new Map<string, number>()

  const fake: RateLimitFake = {
    counts,
    reserveMock: vi.fn(),
    releaseMock: vi.fn(),
    async reserve(input) {
      ;(fake.reserveMock as unknown as (i: typeof input) => void)(input)
      const k = key(input.bucket, input.subjectHash, input.windowStart)
      const current = counts.get(k) ?? 0
      if (current >= input.limit) return { reserved: false, count: current }
      const next = current + 1
      counts.set(k, next)
      return { reserved: true, count: next }
    },
    async release(input) {
      ;(fake.releaseMock as unknown as (i: typeof input) => void)(input)
      const k = key(input.bucket, input.subjectHash, input.windowStart)
      counts.set(k, Math.max(0, (counts.get(k) ?? 0) - 1))
    },
  }
  return fake
}

/** Held count for a bucket+subject within a specific window. */
export function heldCount(fake: RateLimitFake, bucket: string, subjectHash: string, windowStart: Date): number {
  return fake.counts.get(key(bucket, subjectHash, windowStart)) ?? 0
}

/** Total held (un-released) units across a bucket. 0 means every reservation was released. */
export function netHeld(fake: RateLimitFake, bucket: string): number {
  let total = 0
  for (const [k, count] of fake.counts) {
    if (k.startsWith(`${bucket}:`)) total += count
  }
  return total
}