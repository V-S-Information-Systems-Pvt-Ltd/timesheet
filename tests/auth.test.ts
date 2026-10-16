// tests/auth.test.ts
// Session parsing + sign-out against lib/auth/client.ts.
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
    const mod = await import('@/lib/auth/client')
    authClient = mod.authClient
  })

  it('getSession parses a null session from /api/v1/auth/browser/me', async () => {
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

  it('signOut POSTs to /api/v1/auth/browser/logout with same-origin credentials', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    await authClient.signOut()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/v1/auth/browser/logout')
    expect(mockFetch.mock.calls[0][1]?.method).toBe('POST')
    expect(mockFetch.mock.calls[0][1]?.credentials).toBe('same-origin')
  })

  it('signIn sends credentials as JSON to /api/v1/auth/browser/login', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: null }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const result = await authClient.signIn('jane@example.com', 's3cret')
    expect(result).toEqual({ error: null })
    const [path, init] = mockFetch.mock.calls[0]
    expect(path).toBe('/api/v1/auth/browser/login')
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

  it('native signUp sends credentials as JSON to /api/v1/auth/browser/signup', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, message: 'Account created!' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const result = await authClient.signUp('x@example.com', 'secret123', 'Jane')
    expect(result.error).toBeNull()
    expect(result.message).toBe('Account created!')
    const [path, init] = mockFetch.mock.calls[0]
    expect(path).toBe('/api/v1/auth/browser/signup')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      email: 'x@example.com',
      password: 'secret123',
      name: 'Jane',
    })
  })

  it('changePassword forwards JSON to /api/v1/auth/browser/change-password', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: null }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const result = await authClient.changePassword('old', 'new-pass')
    expect(result).toEqual({ error: null })
    const [path, init] = mockFetch.mock.calls[0]
    expect(path).toBe('/api/v1/auth/browser/change-password')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ currentPassword: 'old', newPassword: 'new-pass' })
  })

  it('requestPasswordReset uses the v1 browser recovery endpoint', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'If an account exists for that email, we sent a password reset link.' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    expect(await authClient.requestPasswordReset('User@Example.com')).toEqual({ error: null })
    const [path, init] = mockFetch.mock.calls[0]
    expect(path).toBe('/api/v1/auth/browser/forgot-password')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ email: 'user@example.com' })
  })

  it('completePasswordReset uses the v1 browser recovery endpoint', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: null }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    expect(await authClient.completePasswordReset('NewPass1', 'a'.repeat(43))).toEqual({ error: null })
    const [path, init] = mockFetch.mock.calls[0]
    expect(path).toBe('/api/v1/auth/browser/reset-password')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ token: 'a'.repeat(43), newPassword: 'NewPass1' })
  })
})
