import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
// Next 16.3.8 still exports this name despite the bundled Proxy docs' new name.
import { unstable_doesMiddlewareMatch as doesProxyMatch } from 'next/experimental/testing/server'
import { config, proxy } from '@/proxy'

const ORIGIN = 'https://timesheet.example'
const reads = ['GET', 'HEAD']
const writes = ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
const assets = [
  '/favicon.ico', '/icon.png',
  '/brand/vsis-logo.jpg', '/brand/vsis-logo-compact.jpg',
  '/fonts/WorkSans-Variable.ttf', '/fonts/GeistMono-Variable.woff2', '/fonts/Geist-Variable.woff2',
  '/file.svg', '/globe.svg', '/next.svg', '/vercel.svg', '/window.svg',
  '/_next/static/chunks/app.js', '/_next/static/css/app.css', '/_next/image?url=%2Ficon.png&w=64&q=75',
]
const readExemptions = ['/maintenance', '/api/health', '/api/health/live', ...assets]

function request(path: string, method = 'GET', headers?: Record<string, string>) {
  return new NextRequest(new URL(path, ORIGIN), { method, headers })
}

function expectUnavailable(response: Response) {
  expect(response.status).toBe(503)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('Retry-After')).toBe('60')
  expect(response.headers.get('Content-Type')).toContain('application/json')
  expect(response.headers.has('Location')).toBe(false)
  expect(response.headers.has('x-middleware-next')).toBe(false)
}

describe('maintenance ingress', () => {
  beforeEach(() => vi.stubEnv('MAINTENANCE_MODE', 'true'))
  afterEach(() => vi.unstubAllEnvs())

  it.each([undefined, '', 'false', 'TRUE', '1', ' true', 'true '])('stays disabled for %s', value => {
    vi.stubEnv('MAINTENANCE_MODE', value)
    for (const path of ['/', '/dashboard', '/api/v1/timesheets', '/maintenance']) {
      for (const method of ['GET', 'HEAD', 'POST']) {
        const response = proxy(request(path, method))
        expect(response.headers.get('x-middleware-next')).toBe('1')
        expect(response.headers.has('Location')).toBe(false)
        expect(response.headers.has('Retry-After')).toBe(false)
      }
    }
  })

  it.each(reads)('temporarily redirects %s pages without the original query', method => {
    for (const path of ['/', '/dashboard', '/auth/confirm', '/reports/export.csv', '/apiary']) {
      const response = proxy(request(`${path}?token=secret&next=%2Fdashboard`, method))
      expect(response.status).toBe(307)
      expect(response.headers.get('Location')).toBe(`${ORIGIN}/maintenance`)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
  })

  it.each(reads)('allows exact %s maintenance, health and asset reads', method => {
    for (const path of readExemptions) {
      const response = proxy(request(path, method))
      expect(response.headers.get('x-middleware-next'), path).toBe('1')
      if (path === '/maintenance') expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
  })

  it.each(reads)('rejects %s APIs, including dotted paths and exemption lookalikes', async method => {
    for (const path of [
      '/api', '/api/data/timesheets', '/api/data/report.csv', '/api/data/icon.png',
      '/api/auth/login', '/api/health/export', '/api/health/live/details', '/api/health/live.json',
      '/api/healthcheck', '/api/health/',
    ]) {
      const response = proxy(request(path, method))
      expectUnavailable(response)
      expect(await response.json()).toEqual({ error: expect.stringContaining('maintenance') })
    }
  })

  it('preserves the versioned client error contract with bounded /api/v1 matching', async () => {
    for (const path of ['/api/v1', '/api/v1/timesheets', '/api/v1/report.csv']) {
      for (const method of [...reads, ...writes]) {
        const response = proxy(request(path, method))
        expectUnavailable(response)
        expect(await response.json()).toEqual({
          data: null, error: { code: 'MAINTENANCE_MODE', message: expect.stringContaining('maintenance') },
        })
      }
    }
    expect(await proxy(request('/api/v10/timesheets')).json()).toEqual({ error: expect.any(String) })
  })

  it.each(writes)('blocks %s including page actions and every read exemption', async method => {
    for (const path of ['/', '/dashboard', '/api/auth/login', ...readExemptions]) {
      const response = proxy(request(path, method, { 'Next-Action': 'example-action' }))
      expectUnavailable(response)
      expect(await response.json()).toEqual({ error: expect.stringContaining('maintenance') })
    }
  })

  it('does not exempt arbitrary files, descendants, or framework lookalikes', () => {
    for (const path of [
      '/maintenance/child', '/maintenance.html', '/maintenance/', '/brand/unknown.jpg',
      '/brand/vsis-logo.jpg/child', '/fonts/unknown.woff2', '/favicon.ico/child', '/icon.png/child',
      '/_next/static-api/file.js', '/_next/image/child', '/_next/data/build/dashboard.json',
    ]) {
      expect(proxy(request(path)).status, path).toBe(307)
    }
  })

  it('restricts development assets to read requests in development', () => {
    for (const path of ['/_next/webpack-hmr', '/__nextjs_source-map']) {
      vi.stubEnv('NODE_ENV', 'development')
      for (const method of reads) expect(proxy(request(path, method)).headers.get('x-middleware-next')).toBe('1')
      for (const method of writes) expectUnavailable(proxy(request(path, method)))
      expect(proxy(request(`${path}/child`)).status).toBe(307)
      vi.stubEnv('NODE_ENV', 'production')
      expect(proxy(request(path)).status).toBe(307)
    }
  })

  it('does not bypass for credentials, administrator hints, IPs or prefetch headers', () => {
    const response = proxy(request('/dashboard', 'GET', {
      Authorization: 'Bearer example', Cookie: 'session=example; role=admin',
      'X-Forwarded-For': '127.0.0.1', 'Next-Router-Prefetch': '1', Purpose: 'prefetch',
    }))
    expect(response.status).toBe(307)
  })

  it.each(['native', 'supabase'])('reads runtime toggles without module reload in %s mode', backend => {
    vi.stubEnv('NEXT_PUBLIC_BACKEND', backend)
    vi.stubEnv('MAINTENANCE_MODE', 'false')
    expect(proxy(request('/api/v1/timesheets', 'POST')).headers.get('x-middleware-next')).toBe('1')
    vi.stubEnv('MAINTENANCE_MODE', 'true')
    expectUnavailable(proxy(request('/api/v1/timesheets', 'POST')))
    vi.stubEnv('MAINTENANCE_MODE', 'false')
    expect(proxy(request('/api/v1/timesheets', 'POST')).headers.get('x-middleware-next')).toBe('1')
  })

  it('matches all routes, including exemptions, prefetches, dotted APIs, and Server Action targets', () => {
    for (const url of ['/', '/dashboard', '/api', '/api/v1/timesheets', '/api/report.csv', ...readExemptions]) {
      expect(doesProxyMatch({ config, nextConfig: {}, url }), url).toBe(true)
      expect(doesProxyMatch({
        config, nextConfig: {}, url,
        headers: { 'next-action': 'example', 'next-router-prefetch': '1', purpose: 'prefetch' },
      }), url).toBe(true)
    }
  })
})
