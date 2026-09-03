import 'server-only'

import { createHmac } from 'node:crypto'

// lib/rate-limit-subject.ts
// Derives the persisted identity for a rate-limit key.
//
// Rate-limit subjects are emails, IP addresses, and session/user ids. Unlike the
// refresh tokens hashed in lib/auth/mobile-tokens.ts (32 random bytes, where an
// unkeyed digest is sound), emails and IPv4 addresses are low-entropy and fully
// enumerable: an unkeyed SHA-256 of either is reversible by dictionary and gives
// no privacy at rest. Subjects are therefore HMAC'd with a server-only key.
//
// Rotating the key invalidates every in-flight window. That is safe — it forgives
// current offenders rather than locking anyone out — but it should not be routine.

const MIN_SECRET_LENGTH = 32

/** Digest length in hex chars. 32 hex chars = 128 bits, ample against collisions. */
const DIGEST_LENGTH = 32

function subjectSecret(): string {
  const value = process.env.RATE_LIMIT_SUBJECT_SECRET
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `RATE_LIMIT_SUBJECT_SECRET must be configured with at least ${MIN_SECRET_LENGTH} characters.`
    )
  }
  return value
}

/**
 * Hash a rate-limit subject for persistence.
 *
 * `bucket` is mixed into the digest so the same subject in two different buckets
 * produces unrelated rows. That keeps a leak of one bucket's rows from confirming
 * membership in another.
 */
export function hashRateLimitSubject(bucket: string, subject: string): string {
  return createHmac('sha256', subjectSecret())
    .update(bucket, 'utf8')
    .update('\u0000', 'utf8')
    .update(subject, 'utf8')
    .digest('hex')
    .slice(0, DIGEST_LENGTH)
}

/** True when the subject secret is configured well enough to persist subjects. */
export function isSubjectSecretConfigured(): boolean {
  const value = process.env.RATE_LIMIT_SUBJECT_SECRET
  return Boolean(value && value.length >= MIN_SECRET_LENGTH)
}
