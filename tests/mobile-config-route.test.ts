import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET } from '@/app/api/v1/config/route'

describe('GET /api/v1/config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns public mobile bootstrap metadata without credentials', async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body.error).toBeNull()
    expect(body.data).toMatchObject({
      apiVersion: 1,
      backend: 'supabase',
      capabilities: { bearerAuth: false, mobileApi: true },
    })
    expect(JSON.stringify(body)).not.toMatch(/secret|key|password/i)
  })

  it('only advertises bearer auth when the explicit rollout gate is enabled', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'true')
    vi.stubEnv('MOBILE_AUTH_SECRET', 'test-secret')

    const response = await GET()
    const body = await response.json()

    expect(body.data.capabilities.bearerAuth).toBe(true)
  })

  it('keeps bearer auth disabled when the signing secret is missing', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'true')
    vi.stubEnv('MOBILE_AUTH_SECRET', '')

    const response = await GET()
    const body = await response.json()

    expect(body.data.capabilities.bearerAuth).toBe(false)
  })
})
