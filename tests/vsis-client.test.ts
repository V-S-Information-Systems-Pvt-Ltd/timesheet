import { describe, expect, it, vi } from 'vitest'
import { ApiClientError, createApiClient } from '@vsis/client'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

describe('@vsis/client createApiClient', () => {
  it('joins the base URL and parses the { data, error } envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true }, error: null }))
    const client = createApiClient({ baseUrl: 'https://api.example.com/', fetch: fetchMock })

    const result = await client.request<{ ok: boolean }>('/things')
    expect(result.data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/things', expect.any(Object))
    expect(client.baseUrl).toBe('https://api.example.com')
  })

  it('injects the bearer token from getAuth and per-call overrides', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: null, error: null }))
    const client = createApiClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchMock,
      getAuth: async () => 'token-a',
    })

    await client.request('/a')
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.example.com/a',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-a' }) })
    )

    await client.request('/b', undefined, 'token-b')
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.example.com/b',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-b' }) })
    )
  })

  it('omits the Authorization header when no auth is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: null, error: null }))
    const client = createApiClient({ baseUrl: 'https://api.example.com', fetch: fetchMock })

    await client.request('/cookie-only')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('throws ApiClientError with the server message and code on an error envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: null, error: { code: 'FORBIDDEN', message: 'Nope.' } }, 403)
    )
    const client = createApiClient({ baseUrl: 'https://api.example.com', fetch: fetchMock })

    await expect(client.request('/x')).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 403,
      message: 'Nope.',
      code: 'FORBIDDEN',
    })
    await expect(client.request('/x')).rejects.toBeInstanceOf(ApiClientError)
  })

  it('retries once with a refreshed token after a 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: null, error: { message: 'expired' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ data: { retried: true }, error: null }))
    const refresh = vi.fn().mockResolvedValue('token-new')
    const client = createApiClient({
      baseUrl: 'https://api.example.com',
      fetch: fetchMock,
      getAuth: () => 'token-old',
      refresh,
    })

    const result = await client.request<{ retried: boolean }>('/secure')
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith('token-old')
    expect(result.data).toEqual({ retried: true })
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.example.com/secure',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-new' }) })
    )
  })

  it('runs onUnauthorized when a 401 cannot be recovered', async () => {
    const onUnauthorized = vi.fn()
    const unauthorized = { ok: false, status: 401, json: async () => ({ data: null, error: { message: 'no' } }) } as Response
    const client = createApiClient({
      baseUrl: 'https://api.example.com',
      fetch: vi.fn().mockResolvedValue(unauthorized),
      onUnauthorized,
    })

    await expect(client.request('/secure')).rejects.toBeInstanceOf(ApiClientError)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('rejects responses that are not the expected envelope', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.example.com',
      fetch: vi.fn().mockResolvedValue(jsonResponse({ unexpected: true })),
    })
    await expect(client.request('/x')).rejects.toBeInstanceOf(ApiClientError)
  })

  it('requires a base URL', () => {
    expect(() => createApiClient({ baseUrl: '   ' })).toThrow(/base URL/i)
  })

  it('keeps the 15 second default timeout for raw transport calls', async () => {
    vi.useFakeTimers()
    try {
      const client = createApiClient({
        baseUrl: 'https://api.example.com',
        fetch: vi.fn(() => new Promise<Response>(() => {})),
      })
      const pending = client.send('/slow')
      const rejection = expect(pending).rejects.toMatchObject({
        name: 'TimeoutError',
        message: 'Request timed out after 15000ms.',
      })
      await vi.advanceTimersByTimeAsync(14999)
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('allows a raw transport call to override its timeout without changing the client default', async () => {
    vi.useFakeTimers()
    try {
      const client = createApiClient({
        baseUrl: 'https://api.example.com',
        fetch: vi.fn(() => new Promise<Response>(() => {})),
      })
      const pending = client.send('/long-operation', undefined, { timeoutMs: 120000 })
      const rejection = expect(pending).rejects.toMatchObject({
        name: 'TimeoutError',
        message: 'Request timed out after 120000ms.',
      })
      await vi.advanceTimersByTimeAsync(119999)
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes the explicit failed token to a synchronous refresh handler', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: null, error: { message: 'expired' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true }, error: null }))
    const refresh = vi.fn(() => 'token-new')
    const client = createApiClient({ baseUrl: 'https://api.example.com', fetch: fetchMock, getAuth: () => 'default-token', refresh })
    await client.request('/secure', undefined, 'explicit-token')
    expect(refresh).toHaveBeenCalledWith('explicit-token')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token-new')
  })

  it('preserves compatibility with a no-argument refresh handler', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: null, error: { message: 'expired' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true }, error: null }))
    const client = createApiClient({ baseUrl: 'https://api.example.com', fetch: fetchMock, refresh: async () => 'token-new' })
    await expect(client.request('/secure', undefined, 'token-old')).resolves.toEqual({ data: { ok: true }, error: null })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retains the original refresh handler when it is replaced during an in-flight request', async () => {
    let release!: (response: Response) => void
    const originalRefresh = vi.fn(async () => 'original-new-token')
    const replacementRefresh = vi.fn(async () => 'replacement-token')
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve }))
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true }, error: null }))
    const client = createApiClient({ baseUrl: 'https://api.example.com', fetch: fetchMock, refresh: originalRefresh })
    const pending = client.request('/secure', undefined, 'original-token')
    await Promise.resolve()
    client.setRefreshHandler(replacementRefresh)
    release(jsonResponse({ data: null, error: { message: 'expired' } }, 401))
    await pending
    expect(originalRefresh).toHaveBeenCalledWith('original-token')
    expect(replacementRefresh).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer original-new-token')
  })

  it('does not attach a newly registered refresh handler to an in-flight request', async () => {
    let release!: (response: Response) => void
    const refresh = vi.fn(async () => 'new-token')
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve }))
    const client = createApiClient({ baseUrl: 'https://api.example.com', fetch: fetchMock })
    const pending = client.request('/secure', undefined, 'old-token')
    const rejection = expect(pending).rejects.toMatchObject({ status: 401, message: 'expired' })
    await Promise.resolve()
    client.setRefreshHandler(refresh)
    release(jsonResponse({ data: null, error: { message: 'expired' } }, 401))
    await rejection
    expect(refresh).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry an old account mutation with the current account after owner rejection', async () => {
    let currentToken = 'account-a'
    let release!: (response: Response) => void
    const refresh = vi.fn(async (failedToken?: string) => {
      if (failedToken !== currentToken) throw new Error('Session ownership changed')
      return 'account-b-refreshed'
    })
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve }))
    const originalError = { data: null, error: { code: 'UNAUTHORIZED', message: 'Account A expired' } }
    const client = createApiClient({ baseUrl: 'https://api.example.com', fetch: fetchMock, getAuth: () => currentToken, refresh })
    const pending = client.request('/mutation', { method: 'POST', body: '{}' })
    const rejection = expect(pending).rejects.toMatchObject({ status: 401, message: 'Account A expired', code: 'UNAUTHORIZED' })
    await Promise.resolve()
    await Promise.resolve()
    currentToken = 'account-b'
    release(jsonResponse(originalError, 401))
    await rejection
    expect(refresh).toHaveBeenCalledWith('account-a')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not refresh successful or anonymous requests, and retries at most once', async () => {
    const refresh = vi.fn(async () => 'new-token')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: true, error: null }))
      .mockResolvedValue(jsonResponse({ data: null, error: { message: 'expired' } }, 401))
    const client = createApiClient({ baseUrl: 'https://api.example.com', fetch: fetchMock, refresh })
    await client.request('/success', undefined, 'old-token')
    await expect(client.request('/anonymous')).rejects.toMatchObject({ status: 401 })
    expect(refresh).not.toHaveBeenCalled()
    await expect(client.request('/secure', undefined, 'old-token')).rejects.toMatchObject({ status: 401 })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it.each(['request', 'send'] as const)('times out a stalled response body in %s', async (method) => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const client = createApiClient({
        baseUrl: 'https://api.example.com',
        timeoutMs: 50,
        fetch: async (_url, init) => {
          signal = init?.signal ?? undefined
          return { ok: true, status: 200, json: () => new Promise(() => {}) } as Response
        },
      })
      const pending = client[method]('/slow-body')
      const rejection = expect(pending).rejects.toMatchObject({
        name: 'TimeoutError', message: 'Request timed out after 50ms.',
      })
      await vi.advanceTimersByTimeAsync(49)
      expect(signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await rejection
      expect(signal?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('allows timely body consumption and clears its deadline', async () => {
    vi.useFakeTimers()
    try {
      let signal: AbortSignal | undefined
      const client = createApiClient({
        baseUrl: 'https://api.example.com', timeoutMs: 50,
        fetch: async (_url, init) => {
          signal = init?.signal ?? undefined
          return { ok: true, status: 200, json: () => new Promise((resolve) => {
            setTimeout(() => resolve({ data: { ok: true }, error: null }), 20)
          }) } as Response
        },
      })
      const pending = client.request('/timely-body')
      await vi.advanceTimersByTimeAsync(20)
      await expect(pending).resolves.toEqual({ data: { ok: true }, error: null })
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(100)
      expect(signal?.aborted).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the remaining deadline after headers arrive instead of restarting it', async () => {
    vi.useFakeTimers()
    try {
      const client = createApiClient({
        baseUrl: 'https://api.example.com', timeoutMs: 50,
        fetch: () => new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true, status: 200, json: () => new Promise(() => {}) } as Response), 30)
        }),
      })
      const pending = client.request('/slow-headers-and-body')
      const rejection = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
      await vi.advanceTimersByTimeAsync(30)
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(20)
      await rejection
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies a per-call timeout override to body consumption', async () => {
    vi.useFakeTimers()
    try {
      const client = createApiClient({
        baseUrl: 'https://api.example.com', timeoutMs: 50,
        fetch: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }) as Response,
      })
      const pending = client.send('/slow-body', undefined, { timeoutMs: 100 })
      const rejection = expect(pending).rejects.toMatchObject({
        name: 'TimeoutError', message: 'Request timed out after 100ms.',
      })
      await vi.advanceTimersByTimeAsync(50)
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(50)
      await rejection
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves invalid JSON handling and clears the deadline', async () => {
    vi.useFakeTimers()
    try {
      const client = createApiClient({
        baseUrl: 'https://api.example.com',
        fetch: async () => new Response('Invalid JSON', { status: 200 }),
      })
      await expect(client.request('/invalid')).rejects.toMatchObject({
        name: 'ApiClientError', status: 200, message: 'The server returned an invalid response.',
      })
      await expect(client.send('/invalid')).resolves.toEqual({ status: 200, ok: true, body: null })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cleans up after fetch rejection', async () => {
    vi.useFakeTimers()
    try {
      const failure = new Error('Network unavailable')
      const client = createApiClient({ baseUrl: 'https://api.example.com', fetch: async () => { throw failure } })
      await expect(client.send('/offline')).rejects.toBe(failure)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('handles a body rejection arriving after timeout without an unhandled rejection', async () => {
    vi.useFakeTimers()
    try {
      let rejectBody!: (reason: Error) => void
      const client = createApiClient({
        baseUrl: 'https://api.example.com', timeoutMs: 50,
        fetch: async () => ({ ok: true, status: 200, json: () => new Promise((_resolve, reject) => {
          rejectBody = reject
        }) }) as Response,
      })
      const pending = client.send('/late-body')
      const rejection = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
      await vi.advanceTimersByTimeAsync(50)
      await rejection
      rejectBody(new Error('Late body failure'))
      await vi.advanceTimersByTimeAsync(0)
      expect(vi.getTimerCount()).toBe(0)
      // Vitest fails the suite if the late rejection escapes the transport.
    } finally {
      vi.useRealTimers()
    }
  })
})
