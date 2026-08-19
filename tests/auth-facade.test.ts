// tests/auth-facade.test.ts
// Tests for the server-side auth facade routing between native and supabase.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockNativeAuth = {
  getSessionUser: vi.fn(),
  getActor: vi.fn(),
}

const mockSupabaseAuth = {
  getSessionUser: vi.fn(),
  getActor: vi.fn(),
}

beforeEach(() => {
  vi.resetModules()
  vi.doMock('../lib/auth/native', () => ({ nativeAuth: mockNativeAuth }))
  vi.doMock('../lib/auth/supabase', () => ({ supabaseAuth: mockSupabaseAuth }))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('../lib/auth/native')
  vi.doUnmock('../lib/auth/supabase')
  vi.doUnmock('../lib/backend/config')
})

describe('auth facade (supabase mode)', () => {
  beforeEach(() => {
    vi.doMock('../lib/backend/config', () => ({ IS_NATIVE: false }))
  })

  it('getSessionUser delegates to supabaseAuth', async () => {
    const { getSessionUser } = await import('../lib/auth/index')
    mockSupabaseAuth.getSessionUser.mockResolvedValueOnce({ id: '1', email: 'a@b.com' })
    expect(await getSessionUser()).toEqual({ id: '1', email: 'a@b.com' })
    expect(mockSupabaseAuth.getSessionUser).toHaveBeenCalledTimes(1)
  })

  it('getActor delegates to supabaseAuth', async () => {
    const { getActor } = await import('../lib/auth/index')
    mockSupabaseAuth.getActor.mockResolvedValueOnce({ id: '1', email: 'a@b.com', role: 'user', isActive: true })
    expect(await getActor()).toEqual({ id: '1', email: 'a@b.com', role: 'user', isActive: true })
    expect(mockSupabaseAuth.getActor).toHaveBeenCalledTimes(1)
  })
})

describe('auth facade (native mode)', () => {
  beforeEach(() => {
    vi.doMock('../lib/backend/config', () => ({ IS_NATIVE: true }))
  })

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
