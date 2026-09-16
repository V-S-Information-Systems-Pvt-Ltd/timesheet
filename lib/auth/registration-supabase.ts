// lib/auth/registration-supabase.ts
// Supabase implementation of RegistrationPort using narrow PostgREST queries.
//
// Identity creation goes through the anonymous public client (`auth.signUp`),
// never the service-role Admin API: email ownership must be verified by the
// provider, so the server cannot pre-confirm a caller-chosen address. The
// service role remains limited to the narrow whitelist/profile reads below.

import { getAdminClient } from '@/lib/supabase/admin'
import { getPublicAnonClient } from '@/lib/supabase/public'
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

function isGoTrueEmailConflict(error: { code?: unknown; message?: string } | null): boolean {
  if (!error) return false
  const code = typeof error.code === 'string' ? error.code : ''
  if (code === 'email_exists' || code === 'user_already_exists') return true
  return /already exists|already registered/i.test(error.message ?? '')
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
    // Anonymous signUp: Supabase verifies email ownership and only returns a
    // session when confirmation is disabled. No email_confirm override exists
    // here by design, and no session/token is ever surfaced to the caller.
    const { data, error } = await getPublicAnonClient().auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { name: input.name } },
    })
    if (error || !data.user) {
      if (isGoTrueEmailConflict(error)) throw new RegistrationConflictError()
      const message = error?.message ?? 'Failed to create Supabase identity.'
      throw new Error(message)
    }

    return {
      id: data.user.id,
      email: data.user.email ?? input.email,
      isActive: input.isActive,
      requiresEmailConfirmation: !data.session,
    }
  },
}
