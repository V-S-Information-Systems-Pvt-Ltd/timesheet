import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nextConfig from '../next.config'

describe('next.config CSP headers', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('allows http and ws connect-src when NEXT_PUBLIC_SUPABASE_URL uses http protocol', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    ;(process.env as { NODE_ENV?: string }).NODE_ENV = 'production'

    const headers = await nextConfig.headers!()
    const rootRoute = headers.find((h) => h.source === '/(.*)')
    expect(rootRoute).toBeDefined()

    const cspHeader = rootRoute?.headers.find((h) => h.key === 'Content-Security-Policy')
    expect(cspHeader).toBeDefined()
    expect(cspHeader?.value).toContain('connect-src \'self\' http://127.0.0.1:54321 ws://127.0.0.1:54321')
    expect(cspHeader?.value).toContain('http://localhost:54321 ws://localhost:54321')
    expect(cspHeader?.value).not.toContain('https://127.0.0.1:54321')
  })

  it('enforces https and wss connect-src when NEXT_PUBLIC_SUPABASE_URL uses https protocol', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://app-xyz.supabase.co'
    ;(process.env as { NODE_ENV?: string }).NODE_ENV = 'production'

    const headers = await nextConfig.headers!()
    const rootRoute = headers.find((h) => h.source === '/(.*)')
    const cspHeader = rootRoute?.headers.find((h) => h.key === 'Content-Security-Policy')

    expect(cspHeader?.value).toContain('connect-src \'self\' https://app-xyz.supabase.co wss://app-xyz.supabase.co')
    expect(cspHeader?.value).not.toContain('http://app-xyz.supabase.co')
  })

  it('defaults to self connect-src when NEXT_PUBLIC_SUPABASE_URL is not set', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    ;(process.env as { NODE_ENV?: string }).NODE_ENV = 'production'

    const headers = await nextConfig.headers!()
    const rootRoute = headers.find((h) => h.source === '/(.*)')
    const cspHeader = rootRoute?.headers.find((h) => h.key === 'Content-Security-Policy')

    expect(cspHeader?.value).toContain('connect-src \'self\';')
  })
})
