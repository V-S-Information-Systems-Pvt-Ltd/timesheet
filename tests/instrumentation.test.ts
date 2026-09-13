import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockValidate, mockIsEnabled, mockDescribe } = vi.hoisted(() => ({
  mockValidate: vi.fn(),
  mockIsEnabled: vi.fn(),
  mockDescribe: vi.fn(),
}))

vi.mock('../lib/ip', () => ({
  validateProxyConfiguration: mockValidate,
}))

vi.mock('../lib/auth/mobile-config', () => ({
  isMobileBearerAuthEnabled: mockIsEnabled,
  describeMobileBearerConfig: mockDescribe,
}))

import { register } from '../instrumentation'

const ENV_KEYS = ['NEXT_RUNTIME', 'NEXT_PHASE', 'MOBILE_BEARER_AUTH_ENABLED'] as const
let savedEnv: Record<string, string | undefined>
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  savedEnv = {}
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  vi.clearAllMocks()
  mockValidate.mockReturnValue({ ok: true })
  mockIsEnabled.mockReturnValue(true)
  mockDescribe.mockReturnValue('backend=native secret=set')
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  warnSpy.mockRestore()
})

describe('instrumentation register()', () => {
  it('refuses startup when proxy configuration is invalid', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    mockValidate.mockReturnValue({ ok: false, error: 'TRUSTED_PROXY_HOPS must be set' })
    await expect(register()).rejects.toThrow('[Startup Validation Failed]')
  })

  it('warns once (no throw) on the local-development escape hatch', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    mockValidate.mockReturnValue({ ok: true, warning: 'untrusted client IP accepted' })
    await register()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('untrusted client IP'))
  })

  it('skips enforcement during the production build phase', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.NEXT_PHASE = 'phase-production-build'
    mockValidate.mockReturnValue({ ok: false, error: 'TRUSTED_PROXY_HOPS must be set' })
    await register()
    expect(mockValidate).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('warns when bearer auth is enabled but misconfigured, stays silent when valid', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    process.env.MOBILE_BEARER_AUTH_ENABLED = 'true'
    mockIsEnabled.mockReturnValue(false)
    mockDescribe.mockReturnValue('backend=native secret=missing-or-short')
    await register()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('misconfigured'))

    warnSpy.mockClear()
    mockIsEnabled.mockReturnValue(true)
    await register()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('does nothing outside the nodejs runtime', async () => {
    delete process.env.NEXT_RUNTIME
    await register()
    expect(mockValidate).not.toHaveBeenCalled()
  })
})
