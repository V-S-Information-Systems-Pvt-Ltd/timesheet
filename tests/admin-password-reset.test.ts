import { beforeEach, describe, expect, it, vi } from 'vitest'
import { actors, makeActor } from './helpers'

const { client, getProfileById, canManageUser, sendPasswordResetEmail, safeAudit } = vi.hoisted(() => ({
  client: { query: vi.fn() },
  getProfileById: vi.fn(),
  canManageUser: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  safeAudit: vi.fn(),
}))

vi.mock('@/lib/db/pool', () => ({
  query: vi.fn(async () => []),
  transaction: async <T>(fn: (c: typeof client) => Promise<T>) => fn(client),
}))
vi.mock('@/lib/db/people', () => ({ peopleDeps: () => ({ persistence: { getProfileById } }) }))
vi.mock('@/lib/db/native/visibility', () => ({ canManageUser }))
vi.mock('@/lib/email/password-reset', () => ({ sendPasswordResetEmail }))
vi.mock('@/lib/audit', () => ({ safeAudit }))

import { adminPasswordResetService } from '@/lib/api/v1/services/admin-users'
import { generatePassword } from '@/lib/auth/password'
import { validatePasswordPolicy } from '@/lib/password-policy'

const target = { id: 'user-9', email: 'nine@example.com' }
const sql = () => client.query.mock.calls.map(([text]) => String(text).replace(/\s+/g, ' '))

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  getProfileById.mockResolvedValue(target)
  canManageUser.mockResolvedValue(true)
  sendPasswordResetEmail.mockResolvedValue(undefined)
  client.query.mockImplementation(async (text: string) => {
    if (text.includes('select id, email from public.profiles')) return { rows: [target] }
    if (text.includes('update public.profiles')) return { rows: [{ id: target.id }] }
    return { rows: [] }
  })
})

describe('adminPasswordResetService', () => {
  it('emails a reset link and audits it', async () => {
    const result = await adminPasswordResetService(actors.admin(), target.id, { mode: 'email' })
    expect(result).toEqual({ success: true, data: { mode: 'email', email: target.email } })
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(expect.objectContaining({ to: target.email }))
    expect(safeAudit).toHaveBeenCalledWith(expect.anything(), { action: 'user.password_reset_email', targetId: target.id })
  })

  it('generates a policy-valid password and revokes every session', async () => {
    const result = await adminPasswordResetService(actors.admin(), target.id, { mode: 'generate' })
    if (!result.success || result.data.mode !== 'generate') throw new Error('expected a generated password')
    expect(validatePasswordPolicy(result.data.password).ok).toBe(true)
    const statements = sql()
    expect(statements.some(s => s.includes('session_version = session_version + 1'))).toBe(true)
    expect(statements.some(s => s.includes('update public.mobile_sessions set revoked_at'))).toBe(true)
    expect(statements.some(s => s.includes('update public.password_reset_tokens set used_at'))).toBe(true)
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    expect(safeAudit).toHaveBeenCalledWith(expect.anything(), { action: 'user.password_generated', targetId: target.id })
  })

  it('reports email delivery failure as 502 without auditing', async () => {
    sendPasswordResetEmail.mockRejectedValue(new Error('SMTP down'))
    const result = await adminPasswordResetService(actors.admin(), target.id, { mode: 'email' })
    expect(result).toMatchObject({ success: false, code: 'EMAIL_FAILED', status: 502 })
    expect(safeAudit).not.toHaveBeenCalled()
  })

  it.each([
    ['non-admin actor', () => actors.co()],
    ['admin who cannot manage the target', () => { canManageUser.mockResolvedValue(false); return actors.admin() }],
    ['admin targeting the super-admin', () => { vi.stubEnv('SUPER_ADMIN_EMAIL', target.email); return actors.admin() }],
  ])('forbids a %s', async (_label, makeCaller) => {
    const result = await adminPasswordResetService(makeCaller(), target.id, { mode: 'generate' })
    expect(result).toMatchObject({ success: false, code: 'FORBIDDEN', status: 403 })
    expect(client.query).not.toHaveBeenCalled()
  })

  it('rejects an unknown mode, the actor themself, and a missing user', async () => {
    expect(await adminPasswordResetService(actors.admin(), target.id, { mode: 'sms' })).toMatchObject({ status: 400 })
    const self = makeActor({ id: target.id, email: target.email, role: 'admin' })
    expect(await adminPasswordResetService(self, target.id, { mode: 'generate' })).toMatchObject({ status: 400 })
    getProfileById.mockResolvedValue(null)
    expect(await adminPasswordResetService(actors.admin(), 'missing', { mode: 'email' })).toMatchObject({ status: 404 })
    expect(client.query).not.toHaveBeenCalled()
  })
})

describe('generatePassword', () => {
  it('always meets the password policy and varies', () => {
    const passwords = Array.from({ length: 50 }, generatePassword)
    expect(passwords.every(p => p.length === 16 && validatePasswordPolicy(p).ok)).toBe(true)
    expect(new Set(passwords).size).toBe(50)
  })
})
