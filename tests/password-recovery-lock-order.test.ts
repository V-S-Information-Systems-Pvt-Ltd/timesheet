// Password reset and admin-set password must lock mobile_sessions before the
// profile row, matching changePassword, or the two can deadlock.
import { describe, expect, it, vi } from 'vitest'

const { client } = vi.hoisted(() => ({
  client: { query: vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [{ id: 'u1', user_id: 'u1' }] })) },
}))

vi.mock('@/lib/db/pool', () => ({
  query: vi.fn(),
  transaction: vi.fn(async (fn: (c: typeof client) => unknown) => fn(client)),
}))
vi.mock('@/lib/db/email-verification', () => ({ markEmailVerified: vi.fn() }))

import { consumePasswordResetToken, setPasswordByAdmin } from '@/lib/db/password-recovery'

function lockOrder() {
  const sqls = client.query.mock.calls.map(([sql]) => String(sql))
  return {
    sessions: sqls.findIndex((sql) => sql.includes('from public.mobile_sessions') && sql.includes('for update')),
    profile: sqls.findIndex((sql) => sql.includes('update public.profiles')),
  }
}

describe('password replacement lock order', () => {
  it.each([
    ['admin-set password', () => setPasswordByAdmin('u1', 'NewPassword1!')],
    ['reset token', () => consumePasswordResetToken('raw-token', 'NewPassword1!')],
  ])('%s locks sessions before the profile', async (_name, run) => {
    client.query.mockClear()
    await run()
    const { sessions, profile } = lockOrder()
    expect(sessions).toBeGreaterThanOrEqual(0)
    expect(sessions).toBeLessThan(profile)
  })

  it('does not lock anything else when the profile is gone', async () => {
    client.query.mockClear()
    client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
    expect(await setPasswordByAdmin('missing', 'NewPassword1!')).toBe(false)
    expect(client.query.mock.calls.map(([sql]) => String(sql)).some((sql) => sql.includes('password_reset_tokens'))).toBe(false)
  })
})
