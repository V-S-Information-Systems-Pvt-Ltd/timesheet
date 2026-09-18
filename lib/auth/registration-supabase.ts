// lib/auth/registration-supabase.ts
// Supabase implementation of RegistrationPort using narrow PostgREST queries.
//
// Identity creation goes through the anonymous public client (`auth.signUp`),
// never the service-role Admin API: email ownership must be verified by the
// provider, so the server cannot pre-confirm a caller-chosen address. The
// service role remains limited to the narrow whitelist/profile reads below
// plus cleanup of a just-created identity when provider configuration is
// unsafe.

import { getAdminClient } from '@/lib/supabase/admin'
import { getPublicAnonClient, getPublicAuthSettings } from '@/lib/supabase/public'
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

export class RegistrationConfigurationError extends Error {
  readonly code = 'CONFIGURATION'
  constructor(message = 'Supabase email confirmation must be enabled for public registration.') {
    super(message)
    this.name = 'RegistrationConfigurationError'
  }
}

export class RegistrationOutcomeUncertainError extends Error {
  readonly code = 'UNCERTAIN'
  constructor() {
    super('Supabase signup outcome could not be verified.')
    this.name = 'RegistrationOutcomeUncertainError'
  }
}

export class RegistrationInputError extends Error {
  readonly code = 'VALIDATION_ERROR'
  constructor(message: string) {
    super(message)
    this.name = 'RegistrationInputError'
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
    // This provider endpoint is public, so post-creation cleanup is not a
    // security boundary: a caller could invoke GoTrue directly. Refuse to
    // create the identity unless the provider currently requires ownership
    // confirmation. The build gate performs the same check for deployments.
    let settings
    try {
      settings = await getPublicAuthSettings()
    } catch {
      throw new RegistrationConfigurationError('Unable to verify Supabase email confirmation settings.')
    }
    if (
      settings.disable_signup === true ||
      settings.external?.email !== true ||
      settings.mailer_autoconfirm !== false
    ) {
      throw new RegistrationConfigurationError()
    }

    // Anonymous signUp: Supabase verifies email ownership and only returns a
    // session when confirmation is disabled. No email_confirm override exists
    // here by design, and no session/token is ever surfaced to the caller.
    const client = getPublicAnonClient()
    let signupResult: Awaited<ReturnType<typeof client.auth.signUp>>
    try {
      signupResult = await client.auth.signUp({
        email: input.email,
        password: input.password,
        options: { data: { name: input.name } },
      })
    } catch {
      // The request may have committed before the response was lost.
      throw new RegistrationOutcomeUncertainError()
    }
    const { data, error } = signupResult
    if (error) {
      if (isGoTrueEmailConflict(error)) throw new RegistrationConflictError()
      // GoTrue's explicit client rejections are definite failures. Fetch,
      // server, timeout, and malformed-response failures cannot prove whether
      // the identity was created; do not tell the caller to retry immediately.
      if (
        typeof error.status === 'number' &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429
      ) {
        if (error.code === 'email_address_invalid') {
          throw new RegistrationInputError('Please enter a valid email address.')
        }
        if (error.code === 'weak_password') {
          throw new RegistrationInputError('Password does not meet complexity requirements.')
        }
        throw new Error(error.message)
      }
      throw new RegistrationOutcomeUncertainError()
    }
    if (!data?.user) throw new RegistrationOutcomeUncertainError()

    if (data.session) {
      // Defense in depth for a configuration change between the preflight and
      // signUp: never return the session, and remove the new identity/profile.
      try {
        await client.auth.signOut()
      } catch {
        // The client is request-local; administrative deletion below is the
        // authoritative cleanup and must still run if signOut is unavailable.
      }
      const { error: cleanupError } = await getAdminClient().auth.admin.deleteUser(data.user.id)
      if (cleanupError) {
        throw new Error(
          `Supabase email confirmation is disabled and cleanup failed: ${cleanupError.message}`
        )
      }
      throw new RegistrationConfigurationError()
    }

    // A confirmed duplicate can produce an obfuscated user with no profile.
    // An unconfirmed duplicate can return the real, already-persisted user;
    // that pending flow has the same truthful response as a new signup below.
    // The profile read also gives us the actual activation state. Never delete
    // on an inconclusive read: Auth may already have created the real user.
    let profile: { id: string; is_active: boolean } | null
    try {
      const result = await getAdminClient()
        .from('profiles')
        .select('id, is_active')
        .eq('id', data.user.id)
        .eq('email', input.email)
        .maybeSingle()
      if (result.error) throw result.error
      profile = result.data
    } catch {
      throw new RegistrationOutcomeUncertainError()
    }
    if (!profile) throw new RegistrationConflictError()

    return {
      id: data.user.id,
      email: data.user.email ?? input.email,
      isActive: profile.is_active,
      requiresEmailConfirmation: !data.session,
    }
  },
}
