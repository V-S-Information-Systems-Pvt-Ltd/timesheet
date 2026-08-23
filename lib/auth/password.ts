// lib/auth/password.ts
// Scrypt password hashing for the native backend.
// Uses Node's built-in crypto without native addons.
//
// Formats supported:
// 1. Versioned (current): "scrypt$N$r$p$<salt-hex>$<derived-key-hex>"
// 2. Legacy: "<salt-hex>:<derived-key-hex>" (transparently upgraded on login)

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'

export const SCRYPT_DEFAULTS = {
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 32 * 1024 * 1024,
} as const

// Upper bounds for scrypt params to prevent resource-exhaustion / DoS attacks.
const MAX_N = 65536
const MAX_R = 32
const MAX_P = 16

interface ParsedHash {
  format: 'versioned' | 'legacy'
  N: number
  r: number
  p: number
  keylen: number
  salt: string
  expected: Buffer
}

function parseHash(stored: string): ParsedHash | null {
  if (typeof stored !== 'string' || !stored) return null

  // 1. Versioned format: scrypt$N$r$p$salt$hash
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$')
    if (parts.length !== 6) return null
    const [, nStr, rStr, pStr, salt, hashHex] = parts
    const N = parseInt(nStr, 10)
    const r = parseInt(rStr, 10)
    const p = parseInt(pStr, 10)

    // Validate N is a positive power of 2 within bounds
    if (!Number.isInteger(N) || N <= 1 || N > MAX_N || (N & (N - 1)) !== 0) return null
    // Validate r and p within bounds
    if (!Number.isInteger(r) || r < 1 || r > MAX_R) return null
    if (!Number.isInteger(p) || p < 1 || p > MAX_P) return null

    if (!salt || salt.length < 16) return null
    if (!hashHex || hashHex.length < 32 || hashHex.length % 2 !== 0) return null

    try {
      const expected = Buffer.from(hashHex, 'hex')
      return { format: 'versioned', N, r, p, keylen: expected.length, salt, expected }
    } catch {
      return null
    }
  }

  // 2. Legacy format: salt:hash (default params N=16384, r=8, p=1, keylen=64)
  if (stored.includes(':')) {
    const [salt, hashHex] = stored.split(':')
    if (!salt || !hashHex || hashHex.length % 2 !== 0) return null

    try {
      const expected = Buffer.from(hashHex, 'hex')
      return {
        format: 'legacy',
        N: SCRYPT_DEFAULTS.N,
        r: SCRYPT_DEFAULTS.r,
        p: SCRYPT_DEFAULTS.p,
        keylen: expected.length,
        salt,
        expected,
      }
    } catch {
      return null
    }
  }

  return null
}

function runScrypt(
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey)
    })
  })
}

/** Hashes a password into the versioned scrypt format. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await runScrypt(password, salt, SCRYPT_DEFAULTS.keylen, {
    N: SCRYPT_DEFAULTS.N,
    r: SCRYPT_DEFAULTS.r,
    p: SCRYPT_DEFAULTS.p,
    maxmem: SCRYPT_DEFAULTS.maxmem,
  })
  return `scrypt$${SCRYPT_DEFAULTS.N}$${SCRYPT_DEFAULTS.r}$${SCRYPT_DEFAULTS.p}$${salt}$${derived.toString('hex')}`
}

/** Whether the stored hash should be upgraded to the current standard format. */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored)
  if (!parsed) return true
  return (
    parsed.format === 'legacy' ||
    parsed.N !== SCRYPT_DEFAULTS.N ||
    parsed.r !== SCRYPT_DEFAULTS.r ||
    parsed.p !== SCRYPT_DEFAULTS.p
  )
}

/** Verifies a password against either a versioned or legacy stored hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored)
  if (!parsed) return false

  try {
    const derived = await runScrypt(password, parsed.salt, parsed.keylen, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: SCRYPT_DEFAULTS.maxmem,
    })
    if (derived.length !== parsed.expected.length) return false
    return timingSafeEqual(derived, parsed.expected)
  } catch {
    return false
  }
}

/** Verifies password and returns detailed status including rehash requirement. */
export async function verifyPasswordDetails(
  password: string,
  stored: string
): Promise<{ valid: boolean; needsRehash: boolean }> {
  const valid = await verifyPassword(password, stored)
  return { valid, needsRehash: valid && needsRehash(stored) }
}

// Fixed valid dummy hash for timing attack mitigation on nonexistent accounts / empty hashes
const DUMMY_HASH =
  'scrypt$16384$8$1$0123456789abcdef0123456789abcdef$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

/**
 * Executes a full scrypt verification cycle against a fixed dummy hash.
 * Always resolves to false. Used to prevent timing oracles when a user does not exist.
 */
export async function verifyDummyPassword(password: string): Promise<boolean> {
  await verifyPassword(password, DUMMY_HASH)
  return false
}
