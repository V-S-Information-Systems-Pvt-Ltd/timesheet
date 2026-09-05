// lib/branding-proxy.ts
import 'server-only'
import dns from 'node:dns/promises'

export const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
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

export async function validateSafeUrl(urlString: string): Promise<URL> {
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
  try {
    const addresses = await dns.lookup(hostname, { all: true })
    if (addresses.length === 0) {
      throw new Error('DNS resolution returned no addresses.')
    }
    for (const record of addresses) {
      if (isPrivateIp(record.address)) {
        throw new Error(`Resolved to disallowed IP address: ${record.address}`)
      }
    }
  } catch (err: any) {
    throw new Error(`DNS validation failed: ${err.message}`)
  }

  return url
}

export async function fetchSafeImage(
  initialUrl: string
): Promise<{ buffer: Buffer; contentType: string; etag: string }> {
  let currentUrl = initialUrl
  let redirects = 0

  while (redirects <= MAX_REDIRECTS) {
    const validatedUrl = await validateSafeUrl(currentUrl)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const res = await fetch(validatedUrl.toString(), {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          Accept: 'image/png,image/jpeg,image/webp,image/svg+xml,image/*;q=0.8',
          'User-Agent': 'VSIS-Timesheet-LogoProxy/1.0',
        },
      })

      clearTimeout(timeoutId)

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) {
          throw new Error('Redirect response missing Location header.')
        }
        currentUrl = new URL(location, validatedUrl).toString()
        redirects++
        continue
      }

      if (!res.ok) {
        throw new Error(`Upstream returned HTTP ${res.status}`)
      }

      const contentTypeHeader = res.headers.get('content-type') || ''
      const contentType = contentTypeHeader.split(';')[0].trim().toLowerCase()
      if (!ALLOWED_MIME_TYPES.has(contentType)) {
        throw new Error(`Disallowed content-type: ${contentType}`)
      }

      const contentLengthHeader = res.headers.get('content-length')
      if (contentLengthHeader && parseInt(contentLengthHeader, 10) > MAX_BYTES) {
        throw new Error('Response exceeds maximum allowable size (2MB).')
      }

      const arrayBuffer = await res.arrayBuffer()
      if (arrayBuffer.byteLength > MAX_BYTES) {
        throw new Error('Response exceeds maximum allowable size (2MB).')
      }

      const buffer = Buffer.from(arrayBuffer)
      const etag = `"${Buffer.from(currentUrl).toString('base64').slice(0, 16)}-${buffer.length}"`

      return { buffer, contentType, etag }
    } catch (err: any) {
      clearTimeout(timeoutId)
      throw err
    }
  }

  throw new Error('Too many redirects.')
}
