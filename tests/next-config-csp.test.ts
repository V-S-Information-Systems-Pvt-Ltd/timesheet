import { describe, it, expect, vi } from 'vitest'
import nextConfig from '../next.config'

describe('next.config CSP headers', () => {
  it('scopes connect-src to same-origin in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const headers = await nextConfig.headers!()
    const rootRoute = headers.find((h) => h.source === '/(.*)')
    const cspHeader = rootRoute?.headers.find((h) => h.key === 'Content-Security-Policy')

    expect(cspHeader?.value).toContain("connect-src 'self';")
    vi.unstubAllEnvs()
  })
})
