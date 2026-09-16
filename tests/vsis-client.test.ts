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
})
