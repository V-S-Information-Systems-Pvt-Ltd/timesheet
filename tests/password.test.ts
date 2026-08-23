import { describe, expect, it } from 'vitest'
import {
  hashPassword,
  needsRehash,
  verifyDummyPassword,
  verifyPassword,
  verifyPasswordDetails,
} from '../lib/auth/password'

describe('password hashing (scrypt)', () => {
  it('hashes into versioned scrypt format and verifies correctly', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/)
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('right-password')
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false)
  })

  it('produces unique salts for the same password', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toBe(b)
    await expect(verifyPassword('same-password', a)).resolves.toBe(true)
    await expect(verifyPassword('same-password', b)).resolves.toBe(true)
  })

  it('verifies legacy salt:hash format and marks for rehash', async () => {
    const pwd = 'legacy-password'
    // To construct a valid legacy hash, let's hash with current parameters and convert to salt:hash format
    const versioned = await hashPassword(pwd)
    const [, , , , vSalt, vHash] = versioned.split('$')
    const legacyHash = `${vSalt}:${vHash}`

    expect(needsRehash(legacyHash)).toBe(true)
    await expect(verifyPassword(pwd, legacyHash)).resolves.toBe(true)
    await expect(verifyPassword('wrong-pwd', legacyHash)).resolves.toBe(false)

    const details = await verifyPasswordDetails(pwd, legacyHash)
    expect(details).toEqual({ valid: true, needsRehash: true })
  })

  it('indicates versioned standard hashes do not need rehash', async () => {
    const hash = await hashPassword('modern-pwd')
    expect(needsRehash(hash)).toBe(false)
    const details = await verifyPasswordDetails('modern-pwd', hash)
    expect(details).toEqual({ valid: true, needsRehash: false })
  })

  it('rejects out-of-bounds or malformed scrypt parameters', async () => {
    // N not power of 2
    expect(await verifyPassword('x', 'scrypt$1000$8$1$salt$hash')).toBe(false)
    // N too large (> 65536)
    expect(await verifyPassword('x', 'scrypt$131072$8$1$salt$hash')).toBe(false)
    // r too large (> 32)
    expect(await verifyPassword('x', 'scrypt$16384$64$1$salt$hash')).toBe(false)
    // p too large (> 16)
    expect(await verifyPassword('x', 'scrypt$16384$8$32$salt$hash')).toBe(false)
    // Malformed strings
    expect(await verifyPassword('x', 'not-a-valid-hash')).toBe(false)
    expect(await verifyPassword('x', '')).toBe(false)
    expect(await verifyPassword('x', 'onlysalt:')).toBe(false)
    expect(await verifyPassword('x', 'scrypt$invalid')).toBe(false)
  })

  it('runs verifyDummyPassword without crashing and resolves to false', async () => {
    const res = await verifyDummyPassword('any-password')
    expect(res).toBe(false)
  })
})
