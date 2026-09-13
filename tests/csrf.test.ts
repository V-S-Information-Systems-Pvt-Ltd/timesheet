import { describe, expect, it, vi } from 'vitest'
import { originCheck } from '../app/api/_http'

describe('CSRF origin protection', () => {
  it('allows safe HTTP methods (GET, HEAD, OPTIONS)', () => {
    const req = new Request('http://localhost:3000/api/data/leaves', { method: 'GET' })
    expect(originCheck(req)).toBeNull()
  })

  it('allows same-origin POST requests matching host', () => {
    const req = new Request('http://localhost:3000/api/data/leaves', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
      },
    })
    expect(originCheck(req)).toBeNull()
  })

  it('allows same-origin requests using Referer header', () => {
    const req = new Request('http://localhost:3000/api/data/leaves', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        referer: 'http://localhost:3000/dashboard',
      },
    })
    expect(originCheck(req)).toBeNull()
  })

  it('allows same-origin POST requests with case-insensitive host matching', () => {
    const req = new Request('http://localhost:3000/api/data/leaves', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://LOCALHOST:3000',
      },
    })
    expect(originCheck(req)).toBeNull()
  })

  it('rejects cross-origin POST requests', async () => {
    const req = new Request('http://localhost:3000/api/data/leaves', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://evil.com',
      },
    })
    const res = originCheck(req)
    expect(res).not.toBeNull()
    expect(res?.status).toBe(403)
    const body = await res?.json()
    expect(body.error).toContain('Cross-origin')
  })

  it('rejects requests from a different port on the same hostname', () => {
    const req = new Request('https://app.example:3000/api/data/leaves', {
      method: 'POST',
      headers: {
        host: 'app.example:3000',
        origin: 'https://app.example:8443',
      },
    })
    expect(originCheck(req)?.status).toBe(403)
  })

  it('does not trust a forged forwarded host without an explicit proxy policy', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('TRUSTED_PROXY_HOPS', '')
    try {
      const req = new Request('https://app.example/api/data/leaves', {
        method: 'POST',
        headers: {
          host: 'app.example',
          origin: 'https://evil.example',
          'x-forwarded-host': 'evil.example',
        },
      })
      expect(originCheck(req)?.status).toBe(403)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('uses the forwarded host behind an explicitly configured proxy', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL', '')
    vi.stubEnv('TRUSTED_PROXY_HOPS', '1')
    try {
      const req = new Request('http://internal-app:3000/api/data/leaves', {
        method: 'POST',
        headers: {
          host: 'internal-app:3000',
          origin: 'https://app.example',
          'x-forwarded-host': 'app.example',
        },
      })
      expect(originCheck(req)).toBeNull()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('rejects requests missing Origin and Referer headers in production mode', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const req = new Request('http://localhost:3000/api/data/leaves', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
        },
      })
      const res = originCheck(req)
      expect(res).not.toBeNull()
      expect(res?.status).toBe(403)
      const body = await res?.json()
      expect(body.error).toContain('Missing Origin or Referer')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
