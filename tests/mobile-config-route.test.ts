import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET } from '@/app/api/v1/config/route'

describe('GET /api/v1/config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns public mobile bootstrap metadata without credentials', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'false')
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body.error).toBeNull()
    expect(body.data).toMatchObject({
      apiVersion: 1,
      backend: 'supabase',
      capabilities: { bearerAuth: false, mobileApi: true },
    })
    expect(JSON.stringify(body)).not.toMatch(/secret|key|password/i)
  })

  it('only advertises bearer auth when the explicit rollout gate is enabled with valid secret', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'true')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', 'a'.repeat(32))
    vi.stubEnv('MOBILE_AUTH_SECRET', 'a'.repeat(32))

    const response = await GET()
    const body = await response.json()

    expect(body.data.capabilities.bearerAuth).toBe(true)
  })

  it('keeps bearer auth disabled when the signing secret is missing or too short', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'true')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', '')
    vi.stubEnv('SUPABASE_JWT_SECRET', '')
    vi.stubEnv('MOBILE_AUTH_SECRET', '')

    const response = await GET()
    const body = await response.json()

    expect(body.data.capabilities.bearerAuth).toBe(false)

    // Short secret (< 32 chars) must also keep bearerAuth disabled
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', 'short-secret')
    vi.stubEnv('MOBILE_AUTH_SECRET', 'short-secret')
    const shortRes = await GET()
    const shortBody = await shortRes.json()
    expect(shortBody.data.capabilities.bearerAuth).toBe(false)
  })

  it('validates kid and algorithm requirements in Supabase mode', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'true')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', 'a'.repeat(32))
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY_ID', '')
    vi.stubEnv('SUPABASE_JWT_KEY_ID', '')

    // Missing kid disables bearerAuth
    let res = await GET()
    let body = await res.json()
    expect(body.data.capabilities.bearerAuth).toBe(false)

    // Invalid algorithm disables bearerAuth
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY_ID', 'key-1')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_ALG', 'NONE')
    res = await GET()
    body = await res.json()
    expect(body.data.capabilities.bearerAuth).toBe(false)

    // Non-PEM key fails for asymmetric algorithm
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_ALG', 'ES256')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', 'not-a-pem')
    res = await GET()
    body = await res.json()
    expect(body.data.capabilities.bearerAuth).toBe(false)

    // Fake PEM string fails validation
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', '-----BEGIN EC PRIVATE KEY-----\nMIG...\n-----END EC PRIVATE KEY-----')
    res = await GET()
    body = await res.json()
    expect(body.data.capabilities.bearerAuth).toBe(false)

    // Unsupported curve for ES256 fails validation
    const { generateKeyPairSync } = await import('node:crypto')
    const { privateKey: wrongCurveKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', wrongCurveKey.export({ type: 'pkcs8', format: 'pem' }).toString())
    res = await GET()
    body = await res.json()
    expect(body.data.capabilities.bearerAuth).toBe(false)

    // Valid prime256v1 curve enables bearerAuth
    const { privateKey: validEcKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', validEcKey.export({ type: 'pkcs8', format: 'pem' }).toString())
    res = await GET()
    body = await res.json()
    expect(body.data.capabilities.bearerAuth).toBe(true)

    // RSA < 2048 bits fails validation
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_ALG', 'RS256')
    const { privateKey: shortRsaKey } = generateKeyPairSync('rsa', { modulusLength: 1024 })
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', shortRsaKey.export({ type: 'pkcs8', format: 'pem' }).toString())
    res = await GET()
    body = await res.json()
    expect(body.data.capabilities.bearerAuth).toBe(false)

    // RSA >= 2048 bits passes validation
    const { privateKey: validRsaKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', validRsaKey.export({ type: 'pkcs8', format: 'pem' }).toString())
    res = await GET()
    body = await res.json()
    expect(body.data.capabilities.bearerAuth).toBe(true)
  })

  it('keeps bearer auth disabled when NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing or invalid', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'true')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', 'a'.repeat(32))
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY_ID', 'key-1')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_ALG', 'HS256')

    // Invalid URL scheme
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'ftp://invalid-url')
    let res = await GET()
    let body = await res.json()
    expect(body.data.capabilities.bearerAuth).toBe(false)

    // Missing URL
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    res = await GET()
    body = await res.json()
    expect(body.data.capabilities.bearerAuth).toBe(false)

    // Valid URL but missing anon key
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
    res = await GET()
    body = await res.json()
    expect(body.data.capabilities.bearerAuth).toBe(false)

    // Both valid
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-123')
    res = await GET()
    body = await res.json()
    expect(body.data.capabilities.bearerAuth).toBe(true)
  })

  it('accepts SUPABASE_MOBILE_SIGNING_KEY_KEY and SUPABASE_MOBILE_SIGNING_KEY_ALG aliases', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'true')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-123')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', '')
    vi.stubEnv('SUPABASE_JWT_SECRET', '')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY_KEY', 'a'.repeat(32))
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_ALG', '')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY_ALG', 'HS256')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY_ID', 'key-1')

    const res = await GET()
    const body = await res.json()
    expect(body.data.capabilities.bearerAuth).toBe(true)
  })

  it('accepts SUPABASE_MOBILE_SIGNING_KID alias when SUPABASE_MOBILE_SIGNING_KEY_ID is unset', async () => {
    vi.stubEnv('MOBILE_BEARER_AUTH_ENABLED', 'true')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-123')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY', 'a'.repeat(32))
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KEY_ID', '')
    vi.stubEnv('SUPABASE_JWT_KEY_ID', '')
    vi.stubEnv('SUPABASE_MOBILE_SIGNING_KID', 'positive-kid-1')

    const res = await GET()
    const body = await res.json()
    expect(body.data.capabilities.bearerAuth).toBe(true)
  })
})
