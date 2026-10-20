import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSecret, secretProblem } from '@/lib/secret-env'
import { isMobileBearerAuthEnabled } from '@/lib/auth/mobile-config'

afterEach(() => vi.unstubAllEnvs())

// Generated per run so no secret-shaped literal lives in the repository.
const randomSecret = () => randomBytes(24).toString('base64url')

describe('secret-env', () => {
  it('rejects the committed placeholder values even though they are long enough', () => {
    expect(secretProblem('AUTH_SECRET', 'CHANGE_ME-to-a-long-random-string')).toMatch(/placeholder/)
    expect(secretProblem('AUTH_SECRET', 'change-me-to-a-long-random-string')).toMatch(/placeholder/)
    expect(secretProblem('AUTH_SECRET', 'placeholder-secret-at-least-32-chars-long')).toMatch(/placeholder/)
  })

  it('rejects short or missing values and accepts a random one', () => {
    expect(secretProblem('AUTH_SECRET', undefined)).toMatch(/at least 32/)
    expect(secretProblem('AUTH_SECRET', 'short')).toMatch(/at least 32/)
    expect(secretProblem('AUTH_SECRET', randomSecret())).toBeNull()
  })

  it('readSecret throws on a placeholder', () => {
    vi.stubEnv('AUTH_SECRET', 'CHANGE_ME-to-a-long-random-string')
    expect(() => readSecret('AUTH_SECRET')).toThrow(/placeholder/)
  })

  it('keeps mobile bearer auth disabled when its secret is shared with AUTH_SECRET', () => {
    const shared = randomSecret()
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'true')
    vi.stubEnv('MOBILE_AUTH_SECRET', shared)
    vi.stubEnv('AUTH_SECRET', shared)
    expect(isMobileBearerAuthEnabled()).toBe(false)
    vi.stubEnv('AUTH_SECRET', `${shared}-browser`)
    expect(isMobileBearerAuthEnabled()).toBe(true)
  })
})
