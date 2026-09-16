import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  validateSupabaseAuthSettings,
  verifySupabaseAuthConfig,
} from '@/scripts/verify-supabase-auth-config.mjs'

const safeSettings = {
  disable_signup: false,
  mailer_autoconfirm: false,
  external: { email: true },
}

describe('Supabase Auth deployment configuration gate', () => {
  it('accepts email signup only when ownership confirmation is required', () => {
    expect(validateSupabaseAuthSettings(safeSettings)).toEqual([])
  })

  it.each([
    [{ ...safeSettings, mailer_autoconfirm: true }, 'email ownership confirmation is disabled'],
    [{ ...safeSettings, disable_signup: true }, 'email signup is disabled'],
    [{ ...safeSettings, external: { email: false } }, 'the email provider is disabled'],
  ])('rejects unsafe settings %#', (settings, expected) => {
    expect(validateSupabaseAuthSettings(settings)).toContain(expected)
  })

  it('queries the configured provider and fails the build on unsafe settings', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ...safeSettings, mailer_autoconfirm: true }), { status: 200 })
    )

    await expect(
      verifySupabaseAuthConfig({
        env: {
          NODE_ENV: 'test',
          NEXT_PUBLIC_BACKEND: 'supabase',
          NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co/',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        },
        fetchImpl,
      })
    ).rejects.toThrow(/ownership confirmation is disabled/)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/settings',
      expect.objectContaining({
        headers: expect.objectContaining({ apikey: 'anon-key' }),
      })
    )
  })

  it('skips native builds without requiring Supabase configuration', async () => {
    await expect(
      verifySupabaseAuthConfig({
        env: { NODE_ENV: 'test', NEXT_PUBLIC_BACKEND: 'native' },
        fetchImpl: vi.fn(),
      })
    ).resolves.toEqual({ skipped: true, reason: 'native backend' })
  })

  it('is mandatory for the standard production build command', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    ) as { scripts?: Record<string, string> }
    expect(packageJson.scripts?.prebuild).toBe('node scripts/verify-supabase-auth-config.mjs')
  })
})
