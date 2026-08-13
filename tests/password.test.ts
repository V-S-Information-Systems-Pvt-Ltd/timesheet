import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../lib/auth/password'

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/)
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

  it('returns false for malformed or empty stored hashes', async () => {
    await expect(verifyPassword('x', 'not-a-valid-hash')).resolves.toBe(false)
    await expect(verifyPassword('x', '')).resolves.toBe(false)
    await expect(verifyPassword('x', 'onlysalt:')).resolves.toBe(false)
  })
})
