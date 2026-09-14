// lib/auth/registration-supabase.ts
// Supabase implementation of RegistrationPort using narrow PostgREST queries.

import { getAdminClient } from '@/lib/supabase/admin'
import type {
  RegisterIdentityInput,
  RegisteredIdentity,
  RegistrationPort,
  WhitelistedDomainInfo,
} from './registration'

export class RegistrationUnsupportedError extends Error {
  readonly code = 'UNSUPPORTED'
  constructor(message = 'Native identity registration is disabled in Supabase mode.') {
    super(message)
    this.name = 'RegistrationUnsupportedError'
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

  async registerIdentity(_input: RegisterIdentityInput): Promise<RegisteredIdentity> {
    throw new RegistrationUnsupportedError()
  },
}
