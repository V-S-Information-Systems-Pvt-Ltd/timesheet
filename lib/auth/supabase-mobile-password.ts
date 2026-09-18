// lib/auth/supabase-mobile-password.ts
// Supabase implementation of the provider password-change port used by the
// mobile transport (`POST /api/v1/auth/change-password`).
//
// The provider client, its credentials and all provider-side ordering live
// here. The transport only sequences the returned step results together with
// the application session guard, so Request parsing and HTTP response writing
// stay in the adapter while provider mechanics stay in infrastructure.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  IdentityMobileProviderPasswordPort,
  IdentityProviderStepResult,
} from './identity'

export interface SupabaseMobilePasswordConfig {
  url: string
  anonKey: string
}

/**
 * Builds a request-scoped port over an ephemeral Supabase client. The client is
 * never persisted and never auto-refreshes; it exists only to verify the
 * current password and apply the provider password write under the caller's own
 * credentials.
 */
export function createSupabaseMobilePasswordPort(
  config: SupabaseMobilePasswordConfig
): IdentityMobileProviderPasswordPort {
  const client: SupabaseClient = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let authenticated = false

  async function revokeScope(scope: 'others' | 'local'): Promise<IdentityProviderStepResult> {
    try {
      const { error } = await client.auth.signOut({ scope })
      return error ? { ok: false, kind: 'provider_error', message: error.message } : { ok: true }
    } catch {
      return { ok: false, kind: 'request_failed', message: 'the provider revocation request failed' }
    }
  }

  return {
    async authenticate({ email, currentPassword }) {
      const { error } = await client.auth.signInWithPassword({ email, password: currentPassword })
      if (error) return { ok: false, message: 'Current password is incorrect.' }
      authenticated = true
      return { ok: true }
    },

    async updatePassword({ currentPassword, newPassword }) {
      try {
        const { error } = await client.auth.updateUser({
          password: newPassword,
          current_password: currentPassword,
        })
        return error ? { ok: false, kind: 'provider_error', message: error.message } : { ok: true }
      } catch {
        return { ok: false, kind: 'request_failed', message: 'the provider update request failed' }
      }
    },

    revokeOtherProviderSessions() {
      return revokeScope('others')
    },

    async cleanup() {
      if (!authenticated) return null
      try {
        const result = await client.auth.signOut({ scope: 'local' })
        return result?.error?.message ?? null
      } catch {
        return 'the provider cleanup request failed'
      }
    },
  }
}
