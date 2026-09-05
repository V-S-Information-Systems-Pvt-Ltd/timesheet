// lib/ip.ts
// Proxy-aware client IP resolver for native authentication and rate limiting.
// Enforces explicit deployment policies to prevent IP spoofing and rate-limit bypass.

export interface ClientIpOptions {
  /**
   * Number of trusted reverse proxy hops (e.g. 1 behind an Nginx Ingress or AWS ALB).
   * Extracts the client IP by counting `hops` from the rightmost proxy in `x-forwarded-for`.
   */
  trustedHops?: number
  /**
   * Environment flag: true if running on Vercel platform.
   */
  isVercel?: boolean
  /**
   * Node environment (defaults to process.env.NODE_ENV).
   */
  nodeEnv?: string
}

/** Basic IPv4 and IPv6 format validation. */
const IPV4_REGEX = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/
const IPV6_REGEX = /^[0-9a-fA-F:]+$/

export function isValidIp(ip: string): boolean {
  if (!ip) return false
  if (IPV4_REGEX.test(ip)) {
    return ip.split('.').every((octet) => {
      const num = Number(octet)
      return num >= 0 && num <= 255
    })
  }
  return IPV6_REGEX.test(ip)
}

/**
 * Resolves the client IP for rate limiting from request headers according to deployment topology.
 *
 * Supported topologies:
 * 1. Vercel: Uses `x-vercel-forwarded-for` (or `x-real-ip`) guaranteed by the platform edge.
 * 2. Trusted Reverse Proxy (K8s / Nginx / ALB): Configured via `TRUSTED_PROXY_HOPS` (e.g., 1).
 *    Extracts the IP from the right side of `x-forwarded-for` to ignore client-injected headers.
 * 3. Direct / Local / Unknown Proxy: In production without trusted proxy configuration, untrusted
 *    `x-forwarded-for` headers are ignored to fail safe and prevent spoofing; a conservative fallback
 *    `'direct-client'` is used.
 */
export function getClientIp(req: Request, options?: ClientIpOptions): string {
  const isVercel = options?.isVercel ?? Boolean(process.env.VERCEL)
  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV ?? 'development'
  const trustedHops =
    options?.trustedHops ??
    (process.env.TRUSTED_PROXY_HOPS ? parseInt(process.env.TRUSTED_PROXY_HOPS, 10) : 0)

  // 1. Vercel Edge deployment
  if (isVercel) {
    const vercelForwarded = req.headers.get('x-vercel-forwarded-for')
    if (vercelForwarded) {
      const first = vercelForwarded.split(',')[0].trim()
      if (isValidIp(first)) return first
    }
    const realIp = req.headers.get('x-real-ip')
    if (realIp && isValidIp(realIp.trim())) {
      return realIp.trim()
    }
  }

  // 2. Configured trusted proxy chain (e.g. Nginx ingress in Kubernetes)
  const xForwardedFor = req.headers.get('x-forwarded-for')
  if (trustedHops > 0 && xForwardedFor) {
    const parts = xForwardedFor
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)

    if (parts.length >= trustedHops) {
      // Pick the IP immediately before the trusted proxy hops
      const targetIndex = parts.length - trustedHops
      const candidate = parts[targetIndex]
      if (isValidIp(candidate)) {
        return candidate
      }
    }
  }

  // 3. Direct x-real-ip if provided and we are not in untrusted production mode
  const realIp = req.headers.get('x-real-ip')
  if (realIp && isValidIp(realIp.trim())) {
    if (trustedHops > 0 || nodeEnv !== 'production') {
      return realIp.trim()
    }
  }

  // 4. In development / test, allow first x-forwarded-for or local fallback for convenience
  if (nodeEnv !== 'production') {
    if (xForwardedFor) {
      const first = xForwardedFor.split(',')[0].trim()
      if (isValidIp(first)) return first
    }
    return '127.0.0.1'
  }

  // 5. Fail-closed fallback in production when no trusted proxy policy matches
  return 'direct-client'
}

export function validateProxyConfiguration(env: {
  isVercel?: boolean
  nodeEnv?: string
  trustedProxyHops?: string
  allowUntrustedClientIp?: string
} = {}): { ok: boolean; warning?: string; error?: string } {
  const isVercel = env.isVercel ?? Boolean(process.env.VERCEL)
  const nodeEnv = env.nodeEnv ?? process.env.NODE_ENV ?? 'development'
  const hopsStr = env.trustedProxyHops ?? process.env.TRUSTED_PROXY_HOPS
  const allowUntrusted = (env.allowUntrustedClientIp ?? process.env.ALLOW_UNTRUSTED_CLIENT_IP) === 'true'

  if (isVercel || nodeEnv !== 'production') {
    return { ok: true }
  }

  // Self-hosted production requires exact positive-integer TRUSTED_PROXY_HOPS or explicit opt-in
  if (!hopsStr || !/^[1-9]\d*$/.test(hopsStr.trim())) {
    if (allowUntrusted) {
      return {
        ok: true,
        warning:
          'SECURITY WARNING: ALLOW_UNTRUSTED_CLIENT_IP=true is active in production. ' +
          'Requests will share the direct-client rate limit bucket and forwarded IPs will not be trusted.',
      }
    }
    return {
      ok: false,
      error:
        'Production deployment requires positive-integer TRUSTED_PROXY_HOPS (e.g. 1 behind ingress/ALB) ' +
        'or explicit ALLOW_UNTRUSTED_CLIENT_IP=true to acknowledge direct exposure.',
    }
  }

  return { ok: true }
}

