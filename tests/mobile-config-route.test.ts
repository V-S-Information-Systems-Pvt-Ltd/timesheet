import { describe, expect, it } from 'vitest'

import { GET } from '@/app/api/v1/config/route'

describe('GET /api/v1/config', () => {
  it('returns public mobile bootstrap metadata without credentials', async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body.error).toBeNull()
    expect(body.data).toMatchObject({
      apiVersion: 1,
      backend: 'supabase',
      capabilities: { bearerAuth: true, mobileApi: true },
    })
    expect(JSON.stringify(body)).not.toMatch(/secret|key|password/i)
  })
})
