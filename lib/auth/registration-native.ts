// lib/auth/registration-native.ts
// Native implementation of RegistrationPort using parameterized PostgreSQL queries.

import { issueEmailVerificationToken } from '@/lib/db/email-verification'
import { query } from '@/lib/db/pool'
import { sendEmailVerificationEmail } from '@/lib/email/password-reset'
import { extractError, logger } from '@/lib/logger'
import type {
  RegisterIdentityInput,
  RegisteredIdentity,
  RegistrationPort,
  WhitelistedDomainInfo,
} from './registration'

export class RegistrationConflictError extends Error {
  readonly code = 'CONFLICT'
  constructor(message = 'An account with that email already exists.') {
    super(message)
    this.name = 'RegistrationConflictError'
  }
}

export const nativeRegistrationPort: RegistrationPort = {
  async findWhitelistedDomain(domain: string): Promise<WhitelistedDomainInfo | null> {
    const clean = domain.trim().toLowerCase().replace(/^@/, '')
    const rows = await query<{
      id: string
      domain: string
      auto_activate: boolean
    }>(
      'select id, domain, auto_activate from public.whitelisted_domains where lower(domain) = $1 limit 1',
      [clean]
    )
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      domain: row.domain,
      autoActivate: Boolean(row.auto_activate),
    }
  },

  async accountExists(email: string): Promise<boolean> {
    const clean = email.trim().toLowerCase()
    const rows = await query<{ id: string }>(
      'select id from public.profiles where lower(email) = $1 limit 1',
      [clean]
    )
    return rows.length > 0
  },

  async registerIdentity(input: RegisterIdentityInput): Promise<RegisteredIdentity> {
    let row: { id: string; email: string } | undefined
    try {
      // Self-signup proves nothing about mailbox ownership, so the account
      // starts inactive and unverified whatever input.isActive says. The
      // domain's auto-activate policy is applied when the emailed link is
      // consumed (markEmailVerified), never at insert time.
      const rows = await query<{ id: string; email: string }>(
        `insert into public.profiles (email, name, password_hash, is_active, email_verified_at, permission_role, hierarchy_role)
         values ($1, $2, $3, false, null, 'user', 'user')
         returning id, email`,
        [input.email, input.name, input.passwordHash]
      )
      row = rows[0]
      if (!row) {
        throw new Error('Failed to create user profile.')
      }
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === '23505'
      ) {
        throw new RegistrationConflictError()
      }
      throw err
    }

    // Delivery is best-effort: the account exists either way, and the
    // password-reset flow also verifies the address, so it doubles as resend.
    try {
      const issued = await issueEmailVerificationToken(row.id)
      await sendEmailVerificationEmail({ to: row.email, token: issued.token, expiresAt: issued.expiresAt })
    } catch (err) {
      logger.error('email verification delivery failed', { userId: row.id, error: extractError(err) })
    }
    return { id: row.id, email: row.email, isActive: false, requiresEmailConfirmation: true }
  },
}
