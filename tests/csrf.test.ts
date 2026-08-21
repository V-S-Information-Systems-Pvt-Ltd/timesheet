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
