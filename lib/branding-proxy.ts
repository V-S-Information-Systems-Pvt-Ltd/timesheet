// lib/branding-proxy.ts
import 'server-only'
import dns from 'node:dns/promises'
import { createHash } from 'node:crypto'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { BlockList, isIP } from 'node:net'
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

const DISALLOWED_IPV4 = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], // This network
  ['10.0.0.0', 8], // Private-use
  ['100.64.0.0', 10], // Shared address space / CGNAT
  ['127.0.0.0', 8], // Loopback
  ['169.254.0.0', 16], // Link-local
  ['172.16.0.0', 12], // Private-use
  ['192.0.0.0', 24], // IETF protocol assignments (public anycast exceptions below)
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // Deprecated 6to4 relay anycast
  ['192.168.0.0', 16], // Private-use
  ['198.18.0.0', 15], // Benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // Multicast
  ['240.0.0.0', 4], // Reserved, including limited broadcast
] as const) {
  DISALLOWED_IPV4.addSubnet(network, prefix, 'ipv4')
}

// These special-purpose anycast addresses are globally reachable even though
// their enclosing ranges are otherwise unsuitable for arbitrary proxy egress.
const PUBLIC_IPV4_EXCEPTIONS = new Set(['192.0.0.9', '192.0.0.10', '192.88.99.2'])

const PUBLIC_IPV6 = new BlockList()
PUBLIC_IPV6.addSubnet('2000::', 3, 'ipv6')

const DISALLOWED_IPV6 = new BlockList()
for (const [network, prefix] of [
  ['2001::', 23], // IETF protocol assignments (public exceptions below)
  ['2001:db8::', 32], // Documentation
  ['2002::', 16], // 6to4; can encode an IPv4 destination
  ['3fff::', 20], // Documentation
] as const) {
  DISALLOWED_IPV6.addSubnet(network, prefix, 'ipv6')
}

const PUBLIC_IPV6_EXCEPTIONS = new BlockList()
for (const [network, prefix] of [
  ['2001:1::1', 128],
  ['2001:1::2', 128],
  ['2001:3::', 32],
  ['2001:4:112::', 48],
  ['2001:20::', 28],
  ['2001:30::', 28],
] as const) {
  PUBLIC_IPV6_EXCEPTIONS.addSubnet(network, prefix, 'ipv6')
}

export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) {
    return !PUBLIC_IPV4_EXCEPTIONS.has(ip) && DISALLOWED_IPV4.check(ip, 'ipv4')
  }
  if (family !== 6) return true
  if (!PUBLIC_IPV6.check(ip, 'ipv6')) return true
  if (PUBLIC_IPV6_EXCEPTIONS.check(ip, 'ipv6')) return false
  return DISALLOWED_IPV6.check(ip, 'ipv6')
}

export interface ValidatedSafeUrl {
  url: URL
  pinnedIp: string
  family: number
}

function normalizeHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function deadlineFromNow(): number {
  return Date.now() + TIMEOUT_MS
}

function timeoutError(): Error {
  return new Error('Request timed out.')
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw timeoutError()
  return remaining
}

function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const clearTimer = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    }

    try {
      timer = setTimeout(() => {
        timer = undefined
        reject(timeoutError())
      }, remainingTime(deadline))
    } catch (error) {
      reject(error)
      return
    }

    promise.then(
      (value) => {
        clearTimer()
        resolve(value)
      },
      (error) => {
        clearTimer()
        reject(error)
      }
    )
  })
}

export async function validateSafeUrl(
  urlString: string,
  deadline = deadlineFromNow()
): Promise<ValidatedSafeUrl> {
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

  const hostname = normalizeHostname(url.hostname.toLowerCase())
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('Localhost/internal domains are not permitted.')
  }

  if (isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error(`Resolved to disallowed IP address: ${hostname}`)
  }

  // Resolve DNS to verify every answer is public, then pin the first answer.
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await withDeadline(dns.lookup(hostname, { all: true }), deadline)
    if (addresses.length === 0) {
      throw new Error('DNS resolution returned no addresses.')
    }
    for (const record of addresses) {
      if (record.family !== isIP(record.address) || isPrivateIp(record.address)) {
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
  target: ValidatedSafeUrl,
  deadline: number
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; buffer: Buffer }> {
  const hostname = normalizeHostname(target.url.hostname)
  const requestTimeout = remainingTime(deadline)

  return new Promise((resolve, reject) => {
    const customLookup: LookupFunction = (_hostname, _options, callback) => {
      callback(null, target.pinnedIp, target.family)
    }

    let req: ClientRequest | undefined
    let response: IncomingMessage | undefined
    let settled = false
    let responseEnded = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let cleanupResponse: (() => void) | undefined

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      cleanupResponse?.()
      if (typeof req?.removeListener === 'function') {
        req.removeListener('timeout', onRequestTimeout)
        req.removeListener('error', onRequestError)
        req.removeListener('close', onRequestClose)
      }
    }

    const settle = (error?: Error, result?: {
      statusCode: number
      headers: Record<string, string | string[] | undefined>
      buffer: Buffer
    }) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(result as { statusCode: number; headers: Record<string, string | string[] | undefined>; buffer: Buffer })
    }

    const cancel = (error: Error) => {
      if (settled) return
      settled = true
      if (typeof response?.destroy === 'function') response.destroy()
      if (typeof req?.destroy === 'function') req.destroy()
      cleanup()
      reject(error)
    }

    const onRequestTimeout = () => cancel(timeoutError())
    const onRequestError = (error: Error) => settle(error)
    const onRequestClose = () => {
      if (!response && !settled) {
        settle(new Error('Upstream request closed before receiving a response.'))
      }
    }

    try {
      req = https.request(
        {
          protocol: 'https:',
          hostname,
          port: target.url.port ? parseInt(target.url.port, 10) : 443,
          path: target.url.pathname + target.url.search,
          method: 'GET',
          headers: {
            Host: target.url.host,
            Accept: 'image/png,image/jpeg,image/webp,image/gif,image/*;q=0.8',
            'User-Agent': 'VSIS-Timesheet-LogoProxy/1.0',
          },
          servername: hostname,
          timeout: requestTimeout,
          lookup: customLookup,
        },
        (res: IncomingMessage) => {
          response = res
          if (Date.now() >= deadline) {
            cancel(timeoutError())
            return
          }

          const statusCode = res.statusCode ?? 500
          const headers = res.headers
          const chunks: Buffer[] = []
          let totalBytes = 0

          const contentLengthHeader = Array.isArray(headers['content-length'])
            ? headers['content-length'][0]
            : headers['content-length']
          const contentLength = Number(contentLengthHeader)
          if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
            cancel(new Error('Response exceeds maximum allowable size (2MB).'))
            return
          }

          const onResponseData = (chunk: Buffer) => {
            if (settled) return
            if (Date.now() >= deadline) {
              cancel(timeoutError())
              return
            }
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            totalBytes += buffer.length
            if (totalBytes > MAX_BYTES) {
              cancel(new Error('Response exceeds maximum allowable size (2MB).'))
              return
            }
            chunks.push(buffer)
          }

          const onResponseEnd = () => {
            if (settled) return
            responseEnded = true
            if (Date.now() >= deadline) {
              cancel(timeoutError())
              return
            }
            settle(undefined, {
              statusCode,
              headers,
              buffer: Buffer.concat(chunks),
            })
          }

          const onResponseAborted = () => cancel(new Error('Upstream response aborted.'))
          const onResponseError = (error: Error) => cancel(error)
          const onResponseClose = () => {
            if (!responseEnded) cancel(new Error('Upstream response closed before completion.'))
          }

          cleanupResponse = () => {
            if (typeof res.removeListener !== 'function') return
            res.removeListener('data', onResponseData)
            res.removeListener('end', onResponseEnd)
            res.removeListener('aborted', onResponseAborted)
            res.removeListener('error', onResponseError)
            res.removeListener('close', onResponseClose)
          }

          res.on('data', onResponseData)
          res.on('end', onResponseEnd)
          res.on('aborted', onResponseAborted)
          res.on('error', onResponseError)
          res.on('close', onResponseClose)
        }
      )

      req.on('timeout', onRequestTimeout)
      req.on('error', onRequestError)
      req.on('close', onRequestClose)
      timer = setTimeout(() => cancel(timeoutError()), requestTimeout)
      req.end()
    } catch (error) {
      cancel(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export async function fetchSafeImage(
  initialUrl: string
): Promise<{ buffer: Buffer; contentType: string; etag: string }> {
  let currentUrl = initialUrl
  let redirects = 0
  const deadline = deadlineFromNow()

  while (redirects <= MAX_REDIRECTS) {
    remainingTime(deadline)
    const validated = await validateSafeUrl(currentUrl, deadline)
    const res = await fetchPinned(validated, deadline)

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
