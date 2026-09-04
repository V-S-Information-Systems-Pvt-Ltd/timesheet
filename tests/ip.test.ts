// tests/ip.test.ts
import { describe, expect, it } from 'vitest'
import { getClientIp, isValidIp } from '@/lib/ip'

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/auth/login', {
    headers: new Headers(headers),
  })
}

describe('isValidIp', () => {
  it('validates IPv4 addresses', () => {
    expect(isValidIp('127.0.0.1')).toBe(true)
    expect(isValidIp('192.168.1.100')).toBe(true)
    expect(isValidIp('10.0.0.1')).toBe(true)
    expect(isValidIp('256.0.0.1')).toBe(false)
    expect(isValidIp('invalid')).toBe(false)
    expect(isValidIp('')).toBe(false)
  })

  it('validates IPv6 addresses', () => {
    expect(isValidIp('::1')).toBe(true)
    expect(isValidIp('2001:db8::1')).toBe(true)
  })
})

describe('getClientIp resolver', () => {
  describe('Vercel deployment', () => {
    it('extracts IP from x-vercel-forwarded-for', () => {
      const req = makeRequest({
        'x-vercel-forwarded-for': '203.0.113.195, 10.0.0.1',
      })
      expect(getClientIp(req, { isVercel: true, nodeEnv: 'production' })).toBe('203.0.113.195')
    })

    it('falls back to x-real-ip on Vercel', () => {
      const req = makeRequest({
        'x-real-ip': '198.51.100.42',
      })
      expect(getClientIp(req, { isVercel: true, nodeEnv: 'production' })).toBe('198.51.100.42')
    })
  })

  describe('Trusted Reverse Proxy (K8s / Nginx Ingress)', () => {
    it('extracts client IP with 1 trusted proxy hop from the right', () => {
      // Ingress receives connection from 203.0.113.50 and appends it to header
      const req = makeRequest({
        'x-forwarded-for': '203.0.113.50',
      })
      expect(getClientIp(req, { trustedHops: 1, nodeEnv: 'production' })).toBe('203.0.113.50')
    })

    it('ignores spoofed leftmost client headers when trustedHops=1', () => {
      // Attacker sends spoofed header: 1.2.3.4.
      // Ingress appends real client IP: 203.0.113.50.
      // Node app receives: 1.2.3.4, 203.0.113.50.
      // With trustedHops=1 (the ingress), the verified client IP is 203.0.113.50.
      const req = makeRequest({
        'x-forwarded-for': '1.2.3.4, 203.0.113.50',
      })
      expect(getClientIp(req, { trustedHops: 1, nodeEnv: 'production' })).toBe('203.0.113.50')
    })

    it('extracts correct IP with 2 trusted proxy hops (Cloudflare + Ingress)', () => {
      // Attacker sends: 1.2.3.4
      // Cloudflare sees real client: 198.51.100.77
      // Ingress sees Cloudflare proxy: 172.68.1.1
      // Node app receives: 1.2.3.4, 198.51.100.77, 172.68.1.1
      // With trustedHops=2, the client IP is 198.51.100.77
      const req = makeRequest({
        'x-forwarded-for': '1.2.3.4, 198.51.100.77, 172.68.1.1',
      })
      expect(getClientIp(req, { trustedHops: 2, nodeEnv: 'production' })).toBe('198.51.100.77')
    })
  })

  describe('Production Direct / Untrusted Proxy', () => {
    it('fails closed to direct-client fallback in production when no trusted proxy policy is set', () => {
      const req = makeRequest({
        'x-forwarded-for': '1.2.3.4',
      })
      expect(getClientIp(req, { trustedHops: 0, nodeEnv: 'production', isVercel: false })).toBe(
        'direct-client'
      )
    })
  })

  // The `direct-client` fallback is a single shared rate-limit key. Once the
  // limiter is backed by shared storage that key is cluster-wide, so every
  // documented deployment topology must resolve a real per-client address.
  // TRUSTED_PROXY_HOPS=1 is set in deploy/configmap.yaml for both the nginx
  // Ingress and the OpenShift Route; Vercel needs no setting.
  describe('documented deployment topologies never share one bucket', () => {
    const cases: Array<{ name: string; headers: Record<string, string>; opts: Parameters<typeof getClientIp>[1]; expected: string }> = [
      {
        name: 'nginx Ingress (TRUSTED_PROXY_HOPS=1)',
        headers: { 'x-forwarded-for': '203.0.113.50' },
        opts: { trustedHops: 1, nodeEnv: 'production', isVercel: false },
        expected: '203.0.113.50',
      },
      {
        name: 'OpenShift Route (TRUSTED_PROXY_HOPS=1)',
        headers: { 'x-forwarded-for': '198.51.100.7' },
        opts: { trustedHops: 1, nodeEnv: 'production', isVercel: false },
        expected: '198.51.100.7',
      },
      {
        name: 'CDN in front of the ingress (TRUSTED_PROXY_HOPS=2)',
        headers: { 'x-forwarded-for': '1.2.3.4, 198.51.100.77, 172.68.1.1' },
        opts: { trustedHops: 2, nodeEnv: 'production', isVercel: false },
        expected: '198.51.100.77',
      },
      {
        name: 'Vercel edge (no hop configuration needed)',
        headers: { 'x-vercel-forwarded-for': '203.0.113.195, 10.0.0.1' },
        opts: { isVercel: true, nodeEnv: 'production' },
        expected: '203.0.113.195',
      },
    ]

    for (const { name, headers, opts, expected } of cases) {
      it(`resolves a real client address: ${name}`, () => {
        const resolved = getClientIp(makeRequest(headers), opts)
        expect(resolved).toBe(expected)
        expect(resolved).not.toBe('direct-client')
      })
    }
  })

  describe('Development / Test Environment', () => {
    it('allows forwarded IP in development/test', () => {
      const req = makeRequest({
        'x-forwarded-for': '192.168.1.50',
      })
      expect(getClientIp(req, { nodeEnv: 'development' })).toBe('192.168.1.50')
    })

    it('defaults to 127.0.0.1 in development/test when no headers present', () => {
      const req = makeRequest()
      expect(getClientIp(req, { nodeEnv: 'development' })).toBe('127.0.0.1')
    })
  })
})
