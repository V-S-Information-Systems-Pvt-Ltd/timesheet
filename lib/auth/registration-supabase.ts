// lib/auth/registration-supabase.ts
// Supabase implementation of RegistrationPort using narrow PostgREST queries.

import { getAdminClient } from '@/lib/supabase/admin'
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

export const supabaseRegistrationPort: RegistrationPort = {
  async findWhitelistedDomain(domain: string): Promise<WhitelistedDomainInfo | null> {
    const clean = domain.trim().toLowerCase().replace(/^@/, '')
    const { data, error } = await getAdminClient()
      .from('whitelisted_domains')
      .select('id, domain, auto_activate')
      .eq('domain', clean)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    return {
      id: data.id,
      domain: data.domain,
      autoActivate: Boolean(data.auto_activate),
    }
  },

  async accountExists(email: string): Promise<boolean> {
    const clean = email.trim().toLowerCase()
    const { data, error } = await getAdminClient()
      .from('profiles')
      .select('id')
      .eq('email', clean)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return Boolean(data)
  },

  async registerIdentity(input: RegisterIdentityInput): Promise<RegisteredIdentity> {
    const { data, error } = await getAdminClient().auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.name },
    })
    if (error || !data.user) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : ''
      const message = error?.message ?? 'Failed to create Supabase identity.'
      if (code === 'email_exists' || /already exists|already registered/i.test(message)) {
        throw new RegistrationConflictError()
      }
      throw new Error(message)
    }

    return {
      id: data.user.id,
      email: data.user.email ?? input.email,
      isActive: input.isActive,
    }
  },
}
