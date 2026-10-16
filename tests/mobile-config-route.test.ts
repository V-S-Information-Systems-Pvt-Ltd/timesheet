import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET } from '@/app/api/v1/config/route'
import { APP_VERSION } from '@/lib/version'

describe('GET /api/v1/config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('respects version precedence: APP_VERSION env > npm_package_version > lib/version default', async () => {
    delete process.env.APP_VERSION
    delete process.env.npm_package_version
    let res = await GET()
    let body = await res.json()
    expect(body.data.appVersion).toBe(APP_VERSION)

    vi.stubEnv('npm_package_version', '1.0.9-pkg')
    res = await GET()
    body = await res.json()
    expect(body.data.appVersion).toBe('1.0.9-pkg')

    vi.stubEnv('APP_VERSION', '2.0.0-override')
    res = await GET()
    body = await res.json()
    expect(body.data.appVersion).toBe('2.0.0-override')
  })
})
