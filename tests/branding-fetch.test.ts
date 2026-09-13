import { describe, it, expect, vi, beforeEach } from 'vitest'

// Failure-path coverage for fetchSafeImage: oversized / timeout / non-image /
// redirect-to-private / DNS-rebinding pinning / content-bound ETag. Transport
// (node:https) and DNS (node:dns/promises) are mocked; SSRF validation logic
// runs for real.

const { mockRequestImpl, mockLookup, scenarios, capturedLookups } = vi.hoisted(() => ({
  mockRequestImpl: vi.fn(),
  mockLookup: vi.fn(),
  scenarios: [] as Array<
    | { kind: 'response'; status: number; headers: Record<string, string>; chunks: Buffer[] }
    | { kind: 'response-aborted'; status: number; headers: Record<string, string> }
    | { kind: 'response-error'; status: number; headers: Record<string, string>; error: Error }
    | { kind: 'response-close'; status: number; headers: Record<string, string> }
    | { kind: 'pending-response'; status: number; headers: Record<string, string> }
    | { kind: 'timeout' }
    | { kind: 'error'; error: Error }
  >,
  capturedLookups: [] as Array<(...args: unknown[]) => void>,
}))

vi.mock('node:https', () => ({
  default: { request: (...args: unknown[]) => mockRequestImpl(...args) },
}))

vi.mock('node:dns/promises', () => ({
  default: { lookup: (...args: unknown[]) => mockLookup(...args) },
}))

import { fetchSafeImage } from '@/lib/branding-proxy'

type ResHandlers = {
  data?: (c: Buffer) => void
  end?: () => void
  aborted?: () => void
  error?: (error: Error) => void
  close?: () => void
}

function driveScenario(
  options: Record<string, unknown>,
  resCb: (res: { statusCode: number; headers: Record<string, string>; on: (e: string, h: (a?: unknown) => void) => void }) => void,
  reqHandlers: { error?: (e: Error) => void; timeout?: () => void },
  isDestroyed: () => boolean
) {
  const scenario = scenarios.shift()
  if (!scenario) throw new Error('no scenario queued')
  if (scenario.kind === 'error') {
    queueMicrotask(() => reqHandlers.error?.(scenario.error))
    return
  }
  if (scenario.kind === 'timeout') {
    queueMicrotask(() => reqHandlers.timeout?.())
    return
  }
  const handlers: ResHandlers = {}
  const res = {
    statusCode: scenario.status,
    headers: scenario.headers,
    on: (evt: string, h: (a?: unknown) => void) => {
      if (evt === 'data') handlers.data = h as (c: Buffer) => void
      if (evt === 'end') handlers.end = h as () => void
      if (evt === 'aborted') handlers.aborted = h as () => void
      if (evt === 'error') handlers.error = h as (error: Error) => void
      if (evt === 'close') handlers.close = h as () => void
    },
  }
  queueMicrotask(() => {
    resCb(res)
    if (scenario.kind === 'response-aborted') {
      handlers.aborted?.()
      return
    }
    if (scenario.kind === 'response-error') {
      handlers.error?.(scenario.error)
      return
    }
    if (scenario.kind === 'response-close') {
      handlers.close?.()
      return
    }
    if (scenario.kind === 'pending-response') return
    for (const chunk of scenario.chunks) {
      if (isDestroyed()) return
      handlers.data?.(chunk)
    }
    if (!isDestroyed()) handlers.end?.()
  })
}

beforeEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  scenarios.length = 0
  capturedLookups.length = 0
  // Default DNS: every hostname resolves to a public IP unless overridden.
  mockLookup.mockImplementation(async () => [{ address: '93.184.216.34', family: 4 }])
  mockRequestImpl.mockImplementation((options: Record<string, unknown>, resCb: unknown) => {
    if (typeof options.lookup === 'function') {
      capturedLookups.push(options.lookup as (...args: unknown[]) => void)
    }
    const reqHandlers: { error?: (e: Error) => void; timeout?: () => void } = {}
    let destroyed: Error | null = null
    const req = {
      on: (evt: string, h: (a?: unknown) => void) => {
        if (evt === 'error') reqHandlers.error = h as (e: Error) => void
        if (evt === 'timeout') reqHandlers.timeout = h as () => void
        return req
      },
      destroy: (err?: Error) => {
        destroyed = err ?? new Error('destroyed')
        queueMicrotask(() => reqHandlers.error?.(destroyed as Error))
        return req
      },
      end: () => {
        driveScenario(options, resCb as never, reqHandlers, () => destroyed !== null)
        return req
      },
    }
    return req
  })
})

const PNG = { 'content-type': 'image/png' }

describe('fetchSafeImage failure paths', () => {
  it('rejects non-image content types', async () => {
    scenarios.push({ kind: 'response', status: 200, headers: { 'content-type': 'text/html' }, chunks: [Buffer.from('<html>')] })
    await expect(fetchSafeImage('https://cdn.example.com/logo.png')).rejects.toThrow(/disallowed content-type/i)
  })

  it('rejects SVG even when served (active-content policy)', async () => {
    scenarios.push({ kind: 'response', status: 200, headers: { 'content-type': 'image/svg+xml' }, chunks: [Buffer.from('<svg>')] })
    await expect(fetchSafeImage('https://cdn.example.com/logo.svg')).rejects.toThrow(/disallowed content-type/i)
  })

  it('rejects oversized bodies mid-stream', async () => {
    const big = Buffer.alloc(1024 * 1024, 0x41)
    scenarios.push({ kind: 'response', status: 200, headers: PNG, chunks: [big, big, big] })
    await expect(fetchSafeImage('https://cdn.example.com/big.png')).rejects.toThrow(/exceeds maximum/i)
  })

  it('rejects on transport timeout', async () => {
    scenarios.push({ kind: 'timeout' })
    await expect(fetchSafeImage('https://cdn.example.com/slow.png')).rejects.toThrow(/timed out/i)
  })

  it('enforces the total deadline while a response body remains open', async () => {
    vi.useFakeTimers()
    try {
      scenarios.push({ kind: 'pending-response', status: 200, headers: PNG })
      const pending = fetchSafeImage('https://cdn.example.com/hanging.png')
      const rejection = pending.then(
        () => undefined,
        (error: unknown) => error
      )
      await vi.advanceTimersByTimeAsync(5001)
      expect(await rejection).toEqual(expect.objectContaining({ message: expect.stringMatching(/timed out/i) }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects aborted upstream responses', async () => {
    scenarios.push({ kind: 'response-aborted', status: 200, headers: PNG })
    await expect(fetchSafeImage('https://cdn.example.com/aborted.png')).rejects.toThrow(/aborted/i)
  })

  it('rejects upstream response errors', async () => {
    scenarios.push({ kind: 'response-error', status: 200, headers: PNG, error: new Error('body failed') })
    await expect(fetchSafeImage('https://cdn.example.com/error.png')).rejects.toThrow('body failed')
  })

  it('rejects responses that close before end', async () => {
    scenarios.push({ kind: 'response-close', status: 200, headers: PNG })
    await expect(fetchSafeImage('https://cdn.example.com/closed.png')).rejects.toThrow(/closed before completion/i)
  })

  it('rejects redirect chains landing on private IPs', async () => {
    scenarios.push({ kind: 'response', status: 302, headers: { location: 'https://10.0.0.1/evil.png' }, chunks: [] })
    mockLookup.mockImplementation(async (hostname: string) => {
      if (hostname === '10.0.0.1') return [{ address: '10.0.0.1', family: 4 }]
      return [{ address: '93.184.216.34', family: 4 }]
    })
    await expect(fetchSafeImage('https://cdn.example.com/go.png')).rejects.toThrow(/disallowed ip|private/i)
    expect(mockRequestImpl).toHaveBeenCalledTimes(1)
  })

  it('pins connections to the validated IP (rebinding-proof)', async () => {
    scenarios.push({ kind: 'response', status: 200, headers: PNG, chunks: [Buffer.from([1, 2, 3])] })
    await fetchSafeImage('https://cdn.example.com/logo.png')
    expect(capturedLookups).toHaveLength(1)
    // The socket lookup must resolve to the DNS-validated address even if
    // system DNS later returns something else (e.g. a private IP).
    const result = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      capturedLookups[0]('cdn.example.com', {}, (err: unknown, address: string, family: number) => {
        if (err) reject(err)
        else resolve({ address, family })
      })
    })
    expect(result.address).toBe('93.184.216.34')
  })

  it('binds the ETag to content bytes, not URL+length', async () => {
    const a = await (async () => {
      scenarios.push({ kind: 'response', status: 200, headers: PNG, chunks: [Buffer.from('aaaa')] })
      return fetchSafeImage('https://cdn.example.com/logo.png')
    })()
    const b = await (async () => {
      scenarios.push({ kind: 'response', status: 200, headers: PNG, chunks: [Buffer.from('bbbb')] })
      return fetchSafeImage('https://cdn.example.com/logo.png')
    })()
    const a2 = await (async () => {
      scenarios.push({ kind: 'response', status: 200, headers: PNG, chunks: [Buffer.from('aaaa')] })
      return fetchSafeImage('https://cdn.example.com/logo.png')
    })()
    expect(a.etag).not.toBe(b.etag)
    expect(a.etag).toBe(a2.etag)
  })
})
