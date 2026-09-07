// lib/branding-proxy.ts
import 'server-only'
import dns from 'node:dns/promises'
import { createHash } from 'node:crypto'
import type { LookupFunction } from 'node:net'
import https from 'node:https'

export const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  // NOTE: `image/svg+xml` is intentionally rejected. SVG is active content
  // (scripts/event handlers) and safe handling would require script stripping
  // plus a verified restrictive CSP on every serve path. Until that is proven,
  // remote SVG logos fail closed and the bundled fallback renders instead.
])

export const MAX_BYTES = 2 * 1024 * 1024 // 2MB
export const TIMEOUT_MS = 5000
export const MAX_REDIRECTS = 3

export function isPrivateIp(ip: string): boolean {
  // IPv4 checks
  if (ip.includes('.')) {
    const parts = ip.split('.').map(Number)
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true
    const [a, b] = parts
    if (a === 0) return true // 0.0.0.0/8
    if (a === 127) return true // 127.0.0.0/8 Loopback
    if (a === 10) return true // 10.0.0.0/8 Private
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 Private
    if (a === 192 && b === 168) return true // 192.168.0.0/16 Private
    if (a === 169 && b === 254) return true // 169.254.0.0/16 Link-local
    if (a >= 224) return true // Multicast & reserved
    return false
  }

  // IPv6 checks
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true // Link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // Unique local address (ULA)
  if (lower.startsWith('ff')) return true // Multicast
  return false
}

export interface ValidatedSafeUrl {
  url: URL
  pinnedIp: string
  family: number
}

export async function validateSafeUrl(urlString: string): Promise<ValidatedSafeUrl> {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    throw new Error('Invalid URL.')
  }

  if (url.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are permitted.')
  }

  if (url.username || url.password) {
    throw new Error('URLs with embedded credentials are not permitted.')
  }

  const hostname = url.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('Localhost/internal domains are not permitted.')
  }

  // Resolve DNS to verify no private/loopback/link-local address
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await dns.lookup(hostname, { all: true })
    if (addresses.length === 0) {
      throw new Error('DNS resolution returned no addresses.')
    }
    for (const record of addresses) {
      if (isPrivateIp(record.address)) {
        throw new Error(`Resolved to disallowed IP address: ${record.address}`)
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`DNS validation failed: ${msg}`)
  }

  return { url, pinnedIp: addresses[0].address, family: addresses[0].family }
}

function fetchPinned(
  target: ValidatedSafeUrl
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const customLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, target.pinnedIp, target.family)
    }

    const req = https.request(
      {
        protocol: 'https:',
        hostname: target.url.hostname,
        port: target.url.port ? parseInt(target.url.port, 10) : 443,
        path: target.url.pathname + target.url.search,
        method: 'GET',
        headers: {
          Host: target.url.host,
          Accept: 'image/png,image/jpeg,image/webp,image/gif,image/*;q=0.8',
          'User-Agent': 'VSIS-Timesheet-LogoProxy/1.0',
        },
        servername: target.url.hostname,
        timeout: TIMEOUT_MS,
        lookup: customLookup,
      },
      (res) => {
        const statusCode = res.statusCode ?? 500
        const headers = res.headers
        const chunks: Buffer[] = []
        let totalBytes = 0

        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length
          if (totalBytes > MAX_BYTES) {
            req.destroy(new Error('Response exceeds maximum allowable size (2MB).'))
            return
          }
          chunks.push(chunk)
        })

        res.on('end', () => {
          resolve({
            statusCode,
            headers,
            buffer: Buffer.concat(chunks),
          })
        })
      }
    )

    req.on('timeout', () => {
      req.destroy(new Error('Request timed out.'))
    })

    req.on('error', (err) => {
      reject(err)
    })

    req.end()
  })
}

export async function fetchSafeImage(
  initialUrl: string
): Promise<{ buffer: Buffer; contentType: string; etag: string }> {
  let currentUrl = initialUrl
  let redirects = 0

  while (redirects <= MAX_REDIRECTS) {
    const validated = await validateSafeUrl(currentUrl)
    const res = await fetchPinned(validated)

    if (res.statusCode >= 300 && res.statusCode < 400) {
      const location = res.headers['location']
      const locationStr = Array.isArray(location) ? location[0] : location
      if (!locationStr) {
        throw new Error('Redirect response missing Location header.')
      }
      currentUrl = new URL(locationStr, validated.url).toString()
      redirects++
      continue
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Upstream returned HTTP ${res.statusCode}`)
    }

    const contentTypeHeader = (Array.isArray(res.headers['content-type']) ? res.headers['content-type'][0] : res.headers['content-type']) || ''
    const contentType = contentTypeHeader.split(';')[0].trim().toLowerCase()
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      throw new Error(`Disallowed content-type: ${contentType}`)
    }

    const buffer = res.buffer
    if (buffer.length > MAX_BYTES) {
      throw new Error('Response exceeds maximum allowable size (2MB).')
    }

    // ETag binds the served bytes, not just the URL+length: same-URL
    // content swaps invalidate instead of colliding within the cache window.
    const etag = `"${createHash('sha256').update(buffer).digest('hex').slice(0, 32)}"`
    return { buffer, contentType, etag }
  }

  throw new Error('Too many redirects.')
}
