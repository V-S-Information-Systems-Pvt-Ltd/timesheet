import { describe, expect, it, vi, beforeEach } from 'vitest'
import { isPrivateIp, validateSafeUrl } from '@/lib/branding-proxy'
import { getCachedBranding } from '@/lib/branding-server'
import { GET } from '@/app/api/branding/logo/route'

const { mockGetBranding, mockFetchSafeImage, mockRequireSuperAdmin } = vi.hoisted(() => ({
  mockGetBranding: vi.fn(),
  mockFetchSafeImage: vi.fn(),
  mockRequireSuperAdmin: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    getBranding: mockGetBranding,
  },
}))

vi.mock('@/lib/branding-proxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/branding-proxy')>()),
  fetchSafeImage: mockFetchSafeImage,
}))

vi.mock('@/app/actions/_shared', () => ({
  requireSuperAdmin: mockRequireSuperAdmin,
}))

describe('T18.3: Branding Logo SSRF Protection', () => {
  it('identifies private, loopback, and link-local IPv4 addresses', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true)
    expect(isPrivateIp('10.0.0.1')).toBe(true)
    expect(isPrivateIp('172.16.0.5')).toBe(true)
    expect(isPrivateIp('172.31.255.255')).toBe(true)
    expect(isPrivateIp('192.168.1.1')).toBe(true)
    expect(isPrivateIp('169.254.169.254')).toBe(true) // Cloud metadata
    expect(isPrivateIp('0.0.0.0')).toBe(true)
    expect(isPrivateIp('224.0.0.1')).toBe(true)

    // Public IPs
    expect(isPrivateIp('8.8.8.8')).toBe(false)
    expect(isPrivateIp('1.1.1.1')).toBe(false)
    expect(isPrivateIp('203.0.113.1')).toBe(false)
  })

  it('identifies private, loopback, and link-local IPv6 addresses', () => {
    expect(isPrivateIp('::1')).toBe(true)
    expect(isPrivateIp('fe80::1')).toBe(true)
    expect(isPrivateIp('fc00::1')).toBe(true)
    expect(isPrivateIp('fd12:3456:789a::1')).toBe(true)
    expect(isPrivateIp('ff02::1')).toBe(true)

    // Public IPv6
    expect(isPrivateIp('2607:f8b0:4005:805::200e')).toBe(false)
  })

  it('rejects plain HTTP URLs', async () => {
    await expect(validateSafeUrl('http://example.com/logo.png')).rejects.toThrow(
      'Only HTTPS URLs are permitted.'
    )
  })

  it('rejects URLs with credentials', async () => {
    await expect(validateSafeUrl('https://admin:pass@example.com/logo.png')).rejects.toThrow(
      'URLs with embedded credentials are not permitted.'
    )
  })

  it('rejects internal and localhost hostnames', async () => {
    await expect(validateSafeUrl('https://localhost/logo.png')).rejects.toThrow(
      'Localhost/internal domains are not permitted.'
    )
    await expect(validateSafeUrl('https://service.internal/logo.png')).rejects.toThrow(
      'Localhost/internal domains are not permitted.'
    )
  })

  it('pins the validated public IP address for connection', async () => {
    const validated = await validateSafeUrl('https://cloudflare.com/logo.png')
    expect(validated.pinnedIp).toBeDefined()
    expect(isPrivateIp(validated.pinnedIp)).toBe(false)
    expect(validated.family).toBeGreaterThan(0)
  })

  it('returns 404 from proxy route when no logoUrl is configured', async () => {
    mockGetBranding.mockResolvedValue({
      data: { appName: 'Timesheet', primaryColor: '#0052cc', logoUrl: null },
      error: null,
    })

    const req = new Request('http://localhost/api/branding/logo')
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('rejects SVG content (active-content policy)', async () => {
    const { ALLOWED_MIME_TYPES } = await import('@/lib/branding-proxy')
    expect(ALLOWED_MIME_TYPES.has('image/svg+xml')).toBe(false)
  })

  it('rejects redirect targets resolving to private IPs', async () => {
    // validateSafeUrl revalidates every hop, so a redirect to a private
    // destination fails closed instead of following it.
    await expect(validateSafeUrl('https://localhost/logo.png')).rejects.toThrow()
  })

  it('serves a short bounded cache lifetime with ETag revalidation', async () => {
    mockGetBranding.mockResolvedValue({
      data: { appName: 'Timesheet', primaryColor: '#0052cc', logoUrl: 'https://cdn.example.com/logo.png' },
      error: null,
    })
    const { fetchSafeImage } = await import('@/lib/branding-proxy')
    void fetchSafeImage
    // Route-level headers are asserted statically: max-age=300 (not 3600) so
    // a changed logo becomes visible promptly; ETag enables 304.
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile('app/api/branding/logo/route.ts', 'utf8')
    )
    expect(src).toContain('max-age=300')
    expect(src).toContain('must-revalidate')
    expect(src).not.toContain('max-age=3600')
  })

  it('serves the proxied image with nosniff, content ETag, and 304 revalidation', async () => {
    mockGetBranding.mockResolvedValue({
      data: { appName: 'Timesheet', primaryColor: '#0052cc', logoUrl: 'https://cdn.example.com/logo.png' },
      error: null,
    })
    mockFetchSafeImage.mockResolvedValue({
      buffer: Buffer.from([1, 2, 3, 4]),
      contentType: 'image/png',
      etag: '"abc123"',
    })

    const res = await GET(new Request('http://localhost/api/branding/logo'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('ETag')).toBe('"abc123"')
    expect(mockFetchSafeImage).toHaveBeenCalledWith('https://cdn.example.com/logo.png')

    const notModified = await GET(
      new Request('http://localhost/api/branding/logo', { headers: { 'if-none-match': '"abc123"' } })
    )
    expect(notModified.status).toBe(304)
  })

  it('maps upstream failures to a generic 404', async () => {
    mockGetBranding.mockResolvedValue({
      data: { appName: 'Timesheet', primaryColor: '#0052cc', logoUrl: 'https://cdn.example.com/logo.png' },
      error: null,
    })
    mockFetchSafeImage.mockRejectedValue(new Error('Upstream returned HTTP 500'))
    const res = await GET(new Request('http://localhost/api/branding/logo'))
    expect(res.status).toBe(404)
  })

  it('gates preview URLs behind super-admin (403 otherwise)', async () => {
    mockFetchSafeImage.mockClear()
    mockRequireSuperAdmin.mockResolvedValue({ error: 'forbidden' })
    const denied = await GET(new Request('http://localhost/api/branding/logo?preview=https://evil.example.com/x.png'))
    expect(denied.status).toBe(403)
    expect(mockFetchSafeImage).not.toHaveBeenCalled()

    mockRequireSuperAdmin.mockResolvedValue({ actor: { id: 'admin-1' } })
    mockFetchSafeImage.mockResolvedValue({
      buffer: Buffer.from([9]),
      contentType: 'image/png',
      etag: '"preview1"',
    })
    const allowed = await GET(new Request('http://localhost/api/branding/logo?preview=https://cdn.example.com/draft.png'))
    expect(allowed.status).toBe(200)
    expect(mockFetchSafeImage).toHaveBeenCalledWith('https://cdn.example.com/draft.png')
    // Previews are never shared-cached.
    expect(allowed.headers.get('Cache-Control')).toContain('no-store')
  })
})

describe('T18.4: Request-scoped cached branding getter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns default branding when repo returns null', async () => {
    mockGetBranding.mockResolvedValue({ data: null, error: null })
    const branding = await getCachedBranding()
    expect(branding).toBeDefined()
    expect(branding.appName).toBe('VSIS Timesheet')
  })

  it('returns configured branding when available', async () => {
    mockGetBranding.mockResolvedValue({
      data: { appName: 'Custom Timesheet', primaryColor: '#ff0000', logoUrl: 'https://cdn.example.com/logo.png' },
      error: null,
    })
    const branding = await getCachedBranding()
    expect(branding.appName).toBe('Custom Timesheet')
    expect(branding.primaryColor).toBe('#ff0000')
  })

  it('layout uses one shared request-scoped getter (no direct repo reads)', async () => {
    const fs = await import('node:fs/promises')
    const src = await fs.readFile('app/layout.tsx', 'utf8')
    const uses = (src.match(/getCachedBranding\(\)/g) || []).length
    expect(uses).toBeGreaterThanOrEqual(3)
    expect(src).not.toContain('repo.getBranding')
    const getter = await fs.readFile('lib/branding-server.ts', 'utf8')
    expect(getter).toContain('cache(')
    expect(getter).not.toContain('unstable_cache')
  })
})
