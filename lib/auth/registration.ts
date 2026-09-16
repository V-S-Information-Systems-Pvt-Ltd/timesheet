// lib/auth/registration.ts
// Explicit, narrow registration port for unauthenticated signup operations.
//
// These unauthenticated operations isolate pre-auth domain checking and
// identity registration from the broad `Repository` facade. Neither operation
// fabricates an Actor or exposes whole-profile records.

import { IS_NATIVE } from '@/lib/backend/config'
import { nativeRegistrationPort } from './registration-native'
import { supabaseRegistrationPort } from './registration-supabase'

export interface WhitelistedDomainInfo {
  id: string
  domain: string
  autoActivate: boolean
}

export interface RegisterIdentityInput {
  email: string
  name: string
  /** Plaintext is consumed only by provider Auth; native persistence uses the hash. */
  password: string
  passwordHash: string
  isActive: boolean
}

export interface RegisteredIdentity {
  id: string
  email: string
  isActive: boolean
}

export interface RegistrationPort {
  /** Find an exact whitelisted domain record by lowercase domain name. */
  findWhitelistedDomain(domain: string): Promise<WhitelistedDomainInfo | null>

  /** Check whether an account exists for this exact email (non-enumerating, narrow read). */
  accountExists(email: string): Promise<boolean>

  /** Register an identity row in the underlying store. */
  registerIdentity(input: RegisterIdentityInput): Promise<RegisteredIdentity>
}

export const registrationPort: RegistrationPort = IS_NATIVE
  ? nativeRegistrationPort
  : supabaseRegistrationPort
