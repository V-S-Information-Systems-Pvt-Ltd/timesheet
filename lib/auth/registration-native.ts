// lib/auth/registration-native.ts
// Native implementation of RegistrationPort using parameterized PostgreSQL queries.

import { query } from '@/lib/db/pool'
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
    try {
      const rows = await query<{ id: string; email: string; is_active: boolean }>(
        `insert into public.profiles (email, name, password_hash, is_active, permission_role, hierarchy_role)
         values ($1, $2, $3, $4, 'user', 'user')
         returning id, email, is_active`,
        [input.email, input.name, input.passwordHash, input.isActive]
      )
      const row = rows[0]
      if (!row) {
        throw new Error('Failed to create user profile.')
      }
      return {
        id: row.id,
        email: row.email,
        isActive: Boolean(row.is_active),
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
  },
}
