import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRenderIdentity } from '@/lib/auth/render'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), session: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getActor: mocks.actor, getSessionUser: mocks.session }))
beforeEach(() => { vi.clearAllMocks() })

describe('render-only composite identity facade calls', () => {
  it('derives safe identity from one actor resolution without duplicating its internal session lookup', async () => {
    mocks.actor.mockResolvedValue({ id: 'alice', email: 'alice@example.test', isActive: true, sessionVersion: 8, secret: 'never serialize' })
    const result = await getRenderIdentity()
    expect(result.session).toEqual({ id: 'alice', email: 'alice@example.test' })
    expect(mocks.actor).toHaveBeenCalledTimes(1); expect(mocks.session).not.toHaveBeenCalled()
  })
  it('falls back to session only when actor is absent', async () => {
    mocks.actor.mockResolvedValue(null)
    mocks.session.mockResolvedValue({ id: 'alice', email: 'alice@example.test', sessionVersion: 8 })
    expect((await getRenderIdentity()).session).toEqual({ id: 'alice', email: 'alice@example.test' })
    expect(mocks.session).toHaveBeenCalledTimes(1)
  })
  it('does not persist a previous identity between bare calls outside a render request', async () => {
    mocks.actor.mockResolvedValueOnce({ id: 'alice', email: 'alice@example.test' }).mockResolvedValueOnce(null)
    mocks.session.mockResolvedValue(null)
    expect((await getRenderIdentity()).session?.id).toBe('alice')
    expect((await getRenderIdentity()).session).toBeNull()
    expect(mocks.actor).toHaveBeenCalledTimes(2)
  })
  it('propagates failed identity lookup for the retryable seed gate', async () => {
    mocks.actor.mockRejectedValue(new Error('storage unavailable'))
    await expect(getRenderIdentity()).rejects.toThrow('storage unavailable')
    expect(mocks.session).not.toHaveBeenCalled()
  })
})
