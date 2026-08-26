import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

import { withRequestLogging } from '@/app/api/v1/_observability'

describe('withRequestLogging', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stamps X-Request-Id and emits one structured access line', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const handler = vi.fn(async () => NextResponse.json({ data: { ok: true }, error: null }))
    const wrapped = withRequestLogging('GET /api/v1/test', handler)

    const response = await wrapped(new Request('http://localhost/api/v1/test'))
    const requestId = response.headers.get('x-request-id')
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)

    expect(infoSpy).toHaveBeenCalledTimes(1)
    const line = JSON.parse(infoSpy.mock.calls[0]?.[0] as string)
    expect(line).toMatchObject({ route: 'GET /api/v1/test', method: 'GET', status: 200 })
    expect(line.requestId).toBe(requestId)
    // No credential-shaped values in access logs.
    expect(JSON.stringify(line).toLowerCase()).not.toContain('authorization')
  })

  it('reports failures at error level without leaking error text', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const secret = 'super-secret-token-value'
    const wrapped = withRequestLogging('POST /api/v1/test', async () => {
      throw new Error(`boom ${secret}`)
    })

    await expect(
      wrapped(new Request('http://localhost/api/v1/test', { method: 'POST' })),
    ).rejects.toThrow()

    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(errSpy.mock.calls[0]?.[0]).not.toContain(secret)
    expect(infoSpy).not.toHaveBeenCalled()
  })

  it('passes through non-Response results untouched (route-test doubles)', async () => {
    const double = { body: { data: null, error: null }, status: 200 }
    const wrapped = withRequestLogging('POST /api/v1/test', async () => double as unknown as Response)

    await expect(wrapped(new Request('http://localhost/api/v1/test', { method: 'POST' }))).resolves.toBe(double)
  })
})
