import { describe, expect, it } from 'vitest'
import { validatePasswordPolicy } from '../lib/password-policy'
import { passwordSchema } from '../lib/validation-schemas'

describe('password policy validation (F04 client/server parity)', () => {
  const validPasswords = [
    'Abcd1234',
    'SecretP@ssw0rd!',
    'Valid123',
    'VeryLongSecurePassword99',
  ]

  const invalidCases = [
    { pwd: 'short', expectedErr: /at least 8 characters/ },
    { pwd: 'nocapital123', expectedErr: /uppercase/ },
    { pwd: 'NOLOWERCASE123', expectedErr: /lowercase/ },
    { pwd: 'NoDigitsHere', expectedErr: /digit/ },
    { pwd: '', expectedErr: /at least 8 characters/ },
  ]

  for (const pwd of validPasswords) {
    it(`accepts valid password: ${pwd}`, () => {
      const res = validatePasswordPolicy(pwd)
      expect(res.ok).toBe(true)
      expect(res.error).toBeUndefined()

      const schemaRes = passwordSchema.safeParse(pwd)
      expect(schemaRes.success).toBe(true)
    })
  }

  for (const { pwd, expectedErr } of invalidCases) {
    it(`rejects invalid password "${pwd}" with parity`, () => {
      const res = validatePasswordPolicy(pwd)
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(expectedErr)

      const schemaRes = passwordSchema.safeParse(pwd)
      expect(schemaRes.success).toBe(false)
      if (!schemaRes.success) {
        expect(schemaRes.error.issues[0].message).toMatch(expectedErr)
      }
    })
  }
})
