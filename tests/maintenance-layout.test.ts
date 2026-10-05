import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RootLayout, { generateMetadata, generateViewport } from '@/app/layout'
import MaintenancePage from '@/app/maintenance/page'
import { DEFAULT_BRANDING } from '@/lib/branding'

const { getCachedBranding, connection } = vi.hoisted(() => ({
  getCachedBranding: vi.fn(), connection: vi.fn(),
}))
vi.mock('@/lib/branding-server', () => ({ getCachedBranding }))
vi.mock('next/font/local', () => ({ default: () => ({ variable: 'test-font' }) }))
vi.mock('next/server', () => ({ connection }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))

describe('maintenance rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    connection.mockResolvedValue(undefined)
    vi.stubEnv('MAINTENANCE_MODE', 'true')
    getCachedBranding.mockRejectedValue(new Error('Database unavailable'))
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['native', 'supabase'])('skips database branding in all layout entry points in %s mode', async backend => {
    vi.stubEnv('NEXT_PUBLIC_BACKEND', backend)
    expect((await generateMetadata()).title).toBe(DEFAULT_BRANDING.appName)
    expect((await generateViewport()).themeColor).toBe(DEFAULT_BRANDING.primaryColor)
    const html = renderToStaticMarkup(await RootLayout({ children: createElement(MaintenancePage) }))
    expect(html).toContain(`--primary-600:${DEFAULT_BRANDING.primaryColor}`)
    expect(html).toContain('Maintenance in progress')
    expect(getCachedBranding).not.toHaveBeenCalled()
    expect(connection).toHaveBeenCalledTimes(3)
  })

  it('keeps normal branding when disabled and observes both runtime transitions', async () => {
    getCachedBranding.mockResolvedValue({ appName: 'Custom workspace', primaryColor: '#123456', logoUrl: null })
    vi.stubEnv('MAINTENANCE_MODE', 'false')
    expect((await generateMetadata()).title).toBe('Custom workspace')
    expect((await generateViewport()).themeColor).toBe('#123456')
    expect(renderToStaticMarkup(await RootLayout({ children: 'normal' }))).toContain('--primary-600:#123456')
    expect(getCachedBranding).toHaveBeenCalledTimes(3)
    vi.stubEnv('MAINTENANCE_MODE', 'true')
    expect((await generateMetadata()).title).toBe(DEFAULT_BRANDING.appName)
    expect(getCachedBranding).toHaveBeenCalledTimes(3)
    vi.stubEnv('MAINTENANCE_MODE', 'false')
    expect((await generateMetadata()).title).toBe('Custom workspace')
    expect(getCachedBranding).toHaveBeenCalledTimes(4)
  })

  it('waits for the request boundary before evaluating the runtime flag', async () => {
    vi.stubEnv('MAINTENANCE_MODE', 'false')
    connection.mockImplementationOnce(async () => { vi.stubEnv('MAINTENANCE_MODE', 'true') })
    expect((await generateMetadata()).title).toBe(DEFAULT_BRANDING.appName)
    expect(getCachedBranding).not.toHaveBeenCalled()
  })

  it('provides the skip-link target and a plain home retry link without prefetch', () => {
    const html = renderToStaticMarkup(createElement(MaintenancePage))
    expect(html).toContain('<main id="main-content"')
    expect(html).toContain('<h1')
    expect(html).toContain('href="/"')
    expect(html).toContain('Try again')
  })
})
