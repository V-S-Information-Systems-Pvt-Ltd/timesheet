// tests/identity-boundary.test.ts
// Slice 10 evidence: the canonical identity contracts live in @vsis/contracts,
// the lifecycle operations depend only on explicit injected ports, and no
// shared package imports token storage, cookie APIs, password hashes, provider
// clients, native modules or secrets.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { IDENTITY_ERROR_CODES } from '@vsis/contracts'
import { IDENTITY_CAPABILITIES, getIdentityCapabilities } from '@/lib/auth/identity'
import {
  changePasswordForActor,
  completeMobilePasswordChange,
  loginMobileIdentity,
  refreshMobileIdentity,
  revokeAllMobileSessions,
  revokeMobileSession,
  revokeMobileSessionsForPasswordChange,
  revokeOtherMobileSessions,
} from '@/lib/auth/identity-service'
import type {
  LoginIdentityDeps,
  PasswordChangeDeps,
  RefreshIdentityDeps,
  SessionRevocationDeps,
  MobileSessionPasswordChangeDeps,
} from '@/lib/auth/identity'

const principal = { id: 'u1', email: 'u@example.com' }
const actor = {
  id: 'u1',
  email: 'u@example.com',
  role: 'user' as const,
  permission_role: 'user' as const,
  hierarchy_role: 'user' as const,
  isActive: true,
}

describe('canonical identity contracts', () => {
  it('exposes the canonical identity error codes', () => {
    expect(IDENTITY_ERROR_CODES).toContain('INVALID_CREDENTIALS')
    expect(IDENTITY_ERROR_CODES).toContain('SESSION_REVOKED')
    expect(IDENTITY_ERROR_CODES).toContain('PASSWORD_UPDATE_FAILED')
    expect(new Set(IDENTITY_ERROR_CODES).size).toBe(IDENTITY_ERROR_CODES.length)
  })

  it('records provider capability matrices for native and supabase', () => {
    const native = getIdentityCapabilities('native')
    const supabase = getIdentityCapabilities('supabase')
    // Native and Supabase both expose server registration; Supabase recovery
    // remains provider-client-owned because it depends on provider email flows.
    expect(native.passwordRecovery).toBe(true)
    expect(native.signup).toBe(true)
    expect(supabase.passwordRecovery).toBe(false)
    expect(supabase.signup).toBe(true)
    // Shared lifecycle capabilities remain available on both providers.
    for (const key of ['login', 'refresh', 'logout', 'logoutAll', 'changePassword', 'mobileSessions'] as const) {
      expect(native[key]).toBe(true)
      expect(supabase[key]).toBe(true)
    }
    expect(IDENTITY_CAPABILITIES.native.bearerAuth).toBe(true)
    expect(IDENTITY_CAPABILITIES.supabase.bearerAuth).toBe(true)
  })
})

describe('identity service uses explicit injected ports', () => {
  it('login verifies credentials, mints a session, resolves the actor, and never reads cookies', async () => {
    const deps = {
      credentials: { verifyCredentials: vi.fn(async () => ({ user: principal, error: null })) },
      sessions: { create: vi.fn(async () => ({ id: 's1', familyId: 'f1' })) },
      tokens: {
        generateRefreshToken: vi.fn(() => 'refresh-raw'),
        hashRefreshToken: vi.fn((token: string) => `hash:${token}`),
        signMobileAccessToken: vi.fn(async () => 'access-token'),
      },
      actors: { resolve: vi.fn(async () => actor) },
    } as unknown as LoginIdentityDeps

    const outcome = await loginMobileIdentity(
      { email: 'u@example.com', password: 'secret', deviceName: 'Pixel', platform: 'android' },
      deps
    )

    expect(outcome).toEqual({
      ok: true,
      accessToken: 'access-token',
      refreshToken: 'refresh-raw',
      sessionId: 's1',
      actor,
    })
    expect(deps.credentials.verifyCredentials).toHaveBeenCalledWith('u@example.com', 'secret')
    expect(deps.sessions.create).toHaveBeenCalledWith({
      userId: 'u1',
      refreshTokenHash: 'hash:refresh-raw',
      deviceName: 'Pixel',
      platform: 'android',
    })
    expect(deps.tokens.signMobileAccessToken).toHaveBeenCalledWith({
      userId: 'u1',
      sessionId: 's1',
      familyId: 'f1',
    })
  })

  it('login returns a generic failure without minting a session', async () => {
    const deps = {
      credentials: { verifyCredentials: vi.fn(async () => ({ user: null, error: null })) },
      sessions: { create: vi.fn() },
      tokens: { generateRefreshToken: vi.fn(), hashRefreshToken: vi.fn(), signMobileAccessToken: vi.fn() },
      actors: { resolve: vi.fn() },
    } as unknown as LoginIdentityDeps

    const outcome = await loginMobileIdentity({ email: 'u@example.com', password: 'wrong' }, deps)

    expect(outcome).toEqual({ ok: false, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' })
    expect(deps.sessions.create).not.toHaveBeenCalled()
  })

  it('refresh rotates atomically and maps reuse to REFRESH_TOKEN_REUSED', async () => {
    const rotate = vi.fn(
      async (): Promise<
        { status: 'rotated'; session: { id: string; userId: string; familyId: string } } | { status: 'reused' }
      > => ({
        status: 'rotated',
        session: { id: 's2', userId: 'u1', familyId: 'f1' },
      })
    )
    const sign = vi.fn(async () => 'access-token')
    const deps = {
      sessions: { rotate },
      tokens: {
        generateRefreshToken: vi.fn(() => 'replacement'),
        hashRefreshToken: vi.fn((token: string) => `hash:${token}`),
        signMobileAccessToken: sign,
      },
    } as unknown as RefreshIdentityDeps

    const outcome = await refreshMobileIdentity({ refreshToken: 'presented' }, deps)
    expect(outcome).toEqual({ ok: true, accessToken: 'access-token', refreshToken: 'replacement', sessionId: 's2' })
    expect(rotate).toHaveBeenCalledWith({
      presentedTokenHash: 'hash:presented',
      replacementTokenHash: 'hash:replacement',
    })

    rotate.mockResolvedValueOnce({ status: 'reused' })
    sign.mockClear()
    const reused = await refreshMobileIdentity({ refreshToken: 'stale' }, deps)
    expect(reused).toEqual({
      ok: false,
      code: 'REFRESH_TOKEN_REUSED',
      message: 'The refresh session is no longer valid. Please sign in again.',
    })
    expect(sign).not.toHaveBeenCalled()
  })

  it('revokes one session, all sessions, and drives the two-phase web revocation', async () => {
    const sessions = {
      revokeSession: vi.fn(async () => {}),
      revokeAll: vi.fn(async () => {}),
      beginPasswordChange: vi.fn(async () => {}),
      completePasswordChange: vi.fn(async () => {}),
    }
    const deps = { sessions } as unknown as SessionRevocationDeps

    await revokeMobileSession('s1', deps)
    await revokeAllMobileSessions('u1', deps)
    await revokeMobileSessionsForPasswordChange('u1', { complete: false }, deps)
    await revokeMobileSessionsForPasswordChange('u1', { complete: true }, deps)

    expect(sessions.revokeSession).toHaveBeenCalledWith('s1')
    expect(sessions.revokeAll).toHaveBeenCalledWith('u1')
    expect(sessions.beginPasswordChange).toHaveBeenCalledWith('u1')
    expect(sessions.completePasswordChange).toHaveBeenCalledWith('u1', null)
  })

  it('surfaces the revoke-other conflict before any provider write and completes the guard', async () => {
    const sessions = {
      revokeOtherSessions: vi.fn(async () => 'conflict' as const),
      completePasswordChange: vi.fn(async () => {}),
    }
    const deps = { sessions } as unknown as MobileSessionPasswordChangeDeps

    await expect(revokeOtherMobileSessions('u1', 's1', deps)).resolves.toBe('conflict')
    await completeMobilePasswordChange('u1', 's1', deps)
    expect(sessions.revokeOtherSessions).toHaveBeenCalledWith('u1', 's1')
    expect(sessions.completePasswordChange).toHaveBeenCalledWith('u1', 's1')
  })

  it('delegates the provider password write through the injected port', async () => {
    const passwords = {
      changePassword: vi.fn(async () => ({ outcome: 'success' as const, error: null, sessionVersion: 1 })),
    }
    const deps = { passwords } as unknown as PasswordChangeDeps

    const result = await changePasswordForActor(
      'u1',
      { currentPassword: 'old', newPassword: 'new' },
      { expectedSessionVersion: 2 },
      deps
    )

    expect(result).toEqual({ outcome: 'success', error: null, sessionVersion: 1 })
    expect(passwords.changePassword).toHaveBeenCalledWith('u1', 'old', 'new', { expectedSessionVersion: 2 })
  })
})

describe('shared-package dependency boundary', () => {
  const forbidden: Array<{ name: string; pattern: RegExp }> = [
    { name: 'next/headers', pattern: /from\s+['"]next\// },
    { name: 'supabase client', pattern: /from\s+['"]@supabase/ },
    { name: 'node builtin', pattern: /from\s+['"]node:/ },
    { name: 'server-only', pattern: /from\s+['"]server-only['"]/ },
    { name: 'application import', pattern: /from\s+['"]@\// },
    { name: 'react-native', pattern: /from\s+['"]react-native/ },
    { name: 'env secret', pattern: /process\.env/ },
    { name: 'cookie API', pattern: /cookies\s*\(/ },
    { name: 'password hash', pattern: /\b(scrypt|bcrypt)\b/ },
    { name: 'provider client', pattern: /\bcreateClient\b/ },
  ]

  function collectSources(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...collectSources(full))
      else if (entry.name.endsWith('.ts')) out.push(full)
    }
    return out
  }

  it('no packages/** source imports an identity implementation detail', () => {
    const files = collectSources(join(process.cwd(), 'packages'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const rule of forbidden) {
        expect(`${file}: ${rule.name}: ${rule.pattern.test(source)}`).toBe(`${file}: ${rule.name}: false`)
      }
    }
  })

  it('the identity boundary modules import only types, never runtime infrastructure', () => {
    for (const file of ['lib/auth/identity.ts', 'lib/auth/identity-service.ts']) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      for (const line of source.split('\n')) {
        if (line.startsWith('import ')) {
          expect(`${file}: ${line}`).toMatch(/^lib\/auth\/[a-z-]+\.ts: import type /)
        }
      }
      expect(source).not.toMatch(/\bcreateClient\b/)
      expect(source).not.toMatch(/process\.env/)
      expect(source).not.toMatch(/from\s+['"]next\//)
    }
  })

  it('public Supabase registration never force-confirms or uses the service role for identity creation', () => {
    const source = readFileSync(join(process.cwd(), 'lib/auth/registration-supabase.ts'), 'utf8')
    // Identity creation must go through anonymous auth.signUp, never the
    // service-role Admin API, and must never pre-confirm a caller-chosen email.
    expect(source).not.toMatch(/auth\.admin\.createUser/)
    expect(source).not.toMatch(/email_confirm:\s*true/)
    expect(source).not.toMatch(/auth\.admin\.generateLink/)
    expect(source).toMatch(/auth\.signUp/)
    // The anonymous signUp result must be the source of the confirmation flag;
    // no provider session/token may be returned from the port.
    expect(source).toMatch(/requiresEmailConfirmation:\s*!data\.session/)
    expect(source).not.toMatch(/return\s*\{[^}]*access_token/)
  })
})
