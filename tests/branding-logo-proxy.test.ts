import { describe, expect, it, vi, beforeEach } from 'vitest'
import { isPrivateIp, validateSafeUrl } from '@/lib/branding-proxy'
import { getCachedBranding } from '@/lib/branding-server'
import { GET } from '@/app/api/branding/logo/route'

const { mockGetBranding } = vi.hoisted(() => ({
  mockGetBranding: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  repo: {
    getBranding: mockGetBranding,
  },
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

  it('returns 404 from proxy route when no logoUrl is configured', async () => {
    mockGetBranding.mockResolvedValue({
      data: { appName: 'Timesheet', primaryColor: '#0052cc', logoUrl: null },
      error: null,
    })

    const req = new Request('http://localhost/api/branding/logo')
    const res = await GET(req)
    expect(res.status).toBe(404)
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
})
