// tests/auth-facade.test.ts
// Tests for the server-side auth facade delegating to the native provider.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockNativeAuth = {
  getSessionUser: vi.fn(),
  getActor: vi.fn(),
}

beforeEach(() => {
  vi.resetModules()
  vi.doMock('../lib/auth/native', () => ({ nativeAuth: mockNativeAuth }))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('../lib/auth/native')
})

describe('auth facade', () => {
  it('getSessionUser delegates to nativeAuth', async () => {
    const { getSessionUser } = await import('../lib/auth/index')
    mockNativeAuth.getSessionUser.mockResolvedValueOnce({ id: '2', email: 'c@d.com' })
    expect(await getSessionUser()).toEqual({ id: '2', email: 'c@d.com' })
    expect(mockNativeAuth.getSessionUser).toHaveBeenCalledTimes(1)
  })

  it('getActor delegates to nativeAuth', async () => {
    const { getActor } = await import('../lib/auth/index')
    mockNativeAuth.getActor.mockResolvedValueOnce({ id: '2', email: 'c@d.com', role: 'admin', isActive: true })
    expect(await getActor()).toEqual({ id: '2', email: 'c@d.com', role: 'admin', isActive: true })
    expect(mockNativeAuth.getActor).toHaveBeenCalledTimes(1)
  })
})
