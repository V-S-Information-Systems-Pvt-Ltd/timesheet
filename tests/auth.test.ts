// tests/auth.test.ts
// Session parsing + sign-out against lib/auth/client.ts for both the native
// and supabase auth implementations.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('native auth client', () => {
  let authClient: typeof import('@/lib/auth/client').authClient

  beforeEach(async () => {
    vi.stubEnv('NEXT_PUBLIC_BACKEND', 'native')
    const mod = await import('@/lib/auth/client')
    authClient = mod.authClient
  })

  it('getSession parses a null session from /api/auth/me', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ user: null }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { user } = await authClient.getSession()
    expect(user).toBeNull()
  })

  it('getSession maps a non-null user to ClientSessionUser', async () => {
    const apiUser = { id: 'abc-123', email: 'jane@example.com' }
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ user: apiUser }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { user } = await authClient.getSession()
    expect(user).toEqual({ id: 'abc-123', email: 'jane@example.com' })
  })

  it('getSession passes credentials: same-origin', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ user: null }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    await authClient.getSession()
    const [, init] = mockFetch.mock.calls[0]
    expect(init?.credentials).toBe('same-origin')
  })

  it('signOut POSTs to /api/auth/logout with same-origin credentials', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    await authClient.signOut()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/auth/logout')
    expect(mockFetch.mock.calls[0][1]?.method).toBe('POST')
    expect(mockFetch.mock.calls[0][1]?.credentials).toBe('same-origin')
  })

  it('signIn sends credentials as JSON to /api/auth/login', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: null }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const result = await authClient.signIn('jane@example.com', 's3cret')
    expect(result).toEqual({ error: null })
    const [path, init] = mockFetch.mock.calls[0]
    expect(path).toBe('/api/auth/login')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ email: 'jane@example.com', password: 's3cret' })
  })

  it('signIn surfaces an error returned by the login endpoint', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Invalid email or password.' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const result = await authClient.signIn('jane@example.com', 'wrong')
    expect(result.error).toBe('Invalid email or password.')
  })

  it('native signUp sends credentials as JSON to /api/auth/signup', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, message: 'Account created!' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const result = await authClient.signUp('x@example.com', 'secret123', 'Jane')
    expect(result.error).toBeNull()
    expect(result.message).toBe('Account created!')
    const [path, init] = mockFetch.mock.calls[0]
    expect(path).toBe('/api/auth/signup')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      email: 'x@example.com',
      password: 'secret123',
      name: 'Jane',
    })
  })

  it('changePassword forwards JSON to /api/auth/change-password', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: null }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const result = await authClient.changePassword('old', 'new-pass')
    expect(result).toEqual({ error: null })
    const [path, init] = mockFetch.mock.calls[0]
    expect(path).toBe('/api/auth/change-password')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ currentPassword: 'old', newPassword: 'new-pass' })
  })
})

describe('supabase auth client', () => {
  let supabaseMock: {
    getSession: ReturnType<typeof vi.fn>
    onAuthStateChange: ReturnType<typeof vi.fn>
    signInWithPassword: ReturnType<typeof vi.fn>
    signUp: ReturnType<typeof vi.fn>
    signOut: ReturnType<typeof vi.fn>
    getUser: ReturnType<typeof vi.fn>
    updateUser: ReturnType<typeof vi.fn>
    resetPasswordForEmail: ReturnType<typeof vi.fn>
  }
  let authClient: typeof import('@/lib/auth/client').authClient

  beforeEach(async () => {
    vi.stubEnv('NEXT_PUBLIC_BACKEND', 'supabase')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'mock-key')

    supabaseMock = {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      getUser: vi.fn(),
      updateUser: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    }

    vi.doMock('@/lib/supabase/client', () => ({
      createClient: () => ({
        auth: {
          getSession: supabaseMock.getSession,
          onAuthStateChange: supabaseMock.onAuthStateChange,
          signInWithPassword: supabaseMock.signInWithPassword,
          signUp: supabaseMock.signUp,
          signOut: supabaseMock.signOut,
          getUser: supabaseMock.getUser,
          updateUser: supabaseMock.updateUser,
          resetPasswordForEmail: supabaseMock.resetPasswordForEmail,
        },
      }),
    }))

    const mod = await import('@/lib/auth/client')
    authClient = mod.authClient
  })

  afterEach(() => {
    vi.doUnmock('@/lib/supabase/client')
  })

  it('getSession maps a Supabase session user', async () => {
    supabaseMock.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'sup-1', email: 'sup@x.com' } } },
    })
    const { user } = await authClient.getSession()
    expect(user).toEqual({ id: 'sup-1', email: 'sup@x.com' })
  })

  it('getSession returns null when there is no session', async () => {
    supabaseMock.getSession.mockResolvedValueOnce({ data: { session: null } })
    const { user } = await authClient.getSession()
    expect(user).toBeNull()
  })

  it('getSession maps null email to empty string', async () => {
    supabaseMock.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'sup-1', email: null } } },
    })
    const { user } = await authClient.getSession()
    expect(user).toEqual({ id: 'sup-1', email: '' })
  })

  it('signOut calls supabase auth.signOut', async () => {
    supabaseMock.signOut.mockResolvedValueOnce({})
    await authClient.signOut()
    expect(supabaseMock.signOut).toHaveBeenCalledTimes(1)
  })

  it('onAuthStateChange invokes callback with mapped user', async () => {
    const cb = vi.fn()
    const unsubscribe = vi.fn()
    supabaseMock.onAuthStateChange.mockReturnValueOnce({
      data: { subscription: { unsubscribe } },
    })
    const unsub = authClient.onAuthStateChange(cb)
    await new Promise((r) => setTimeout(r, 10))
    const handler = supabaseMock.onAuthStateChange.mock.calls[0][0]
    handler(null, { user: { id: 'u1', email: 'u@x.com' } })
    expect(cb).toHaveBeenCalledWith({ id: 'u1', email: 'u@x.com' })
    unsub()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('requestPasswordReset delegates to supabase resetPasswordForEmail with reset-password redirect', async () => {
    // @ts-expect-error test window mock
    global.window = { location: { origin: 'http://localhost:3000' } }
    supabaseMock.resetPasswordForEmail.mockResolvedValueOnce({ error: null })
    const result = await authClient.requestPasswordReset('User@Example.com')
    expect(result).toEqual({ error: null })
    expect(supabaseMock.resetPasswordForEmail).toHaveBeenCalledWith(
      'user@example.com',
      expect.objectContaining({ redirectTo: 'http://localhost:3000/reset-password' })
    )
  })

  it('completePasswordReset updates user password and clears recovery state', async () => {
    // 1. Establish recovery state via PASSWORD_RECOVERY event
    const cb = vi.fn()
    supabaseMock.onAuthStateChange.mockReturnValueOnce({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
    authClient.onAuthStateChange(cb)
    await new Promise((r) => setTimeout(r, 10))
    const handler = supabaseMock.onAuthStateChange.mock.calls[0][0]
    handler('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'u@x.com' } })

    supabaseMock.getUser.mockResolvedValueOnce({
      data: { user: { id: 'u1', email: 'u@x.com' } },
    })
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    supabaseMock.updateUser.mockResolvedValueOnce({ error: null })
    supabaseMock.signOut.mockResolvedValueOnce({})

    const result = await authClient.completePasswordReset('NewPassword123!')
    expect(result).toEqual({ error: null })
    expect(supabaseMock.updateUser).toHaveBeenCalledWith({ password: 'NewPassword123!' })
    expect(supabaseMock.signOut).toHaveBeenCalled()
    expect((await authClient.getPasswordRecoveryState()).ready).toBe(false)
  })

  it('onAuthStateChange marks recovery state ready on PASSWORD_RECOVERY event', async () => {
    const cb = vi.fn()
    const unsubscribe = vi.fn()
    supabaseMock.onAuthStateChange.mockReturnValueOnce({
      data: { subscription: { unsubscribe } },
    })
    authClient.onAuthStateChange(cb)
    await new Promise((r) => setTimeout(r, 10))
    const handler = supabaseMock.onAuthStateChange.mock.calls[0][0]
    handler('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'u@x.com' } })
    expect(cb).toHaveBeenCalledWith({ id: 'u1', email: 'u@x.com' }, 'PASSWORD_RECOVERY')
    const state = await authClient.getPasswordRecoveryState()
    expect(state.ready).toBe(true)
  })
})
