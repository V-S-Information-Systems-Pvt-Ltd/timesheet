// lib/supabase/public.ts
// Server-only anonymous Supabase client for unauthenticated flows (public
// signup). Uses the anon key — never the service role — and is deliberately
// separate from the cookie-writing server client (lib/supabase/server.ts) and
// the service-role admin client (lib/supabase/admin.ts).

import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export interface PublicAuthSettings {
  disable_signup?: boolean
  mailer_autoconfirm?: boolean
  external?: { email?: boolean }
}

/**
 * Read the provider's public Auth settings before creating an identity.
 * Registration must fail before auth.signUp when ownership confirmation is
 * disabled; deleting an already-created identity cannot protect callers that
 * invoke the public provider endpoint directly.
 */
export async function getPublicAuthSettings(): Promise<PublicAuthSettings> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY for the public Supabase client')
  }

  const response = await fetch(`${url}/auth/v1/settings`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    signal: AbortSignal.timeout(5_000),
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`Supabase Auth settings request failed with status ${response.status}.`)
  }
  return (await response.json()) as PublicAuthSettings
}

/**
 * Anonymous (anon-key) Supabase client for one server-side unauthenticated
 * operation. A new client is created for every call: `persistSession: false`
 * disables durable storage, but Supabase still keeps a returned session in
 * the client's in-memory storage. Sharing one client across requests would
 * share that identity context.
 */
export function getPublicAnonClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY for the public Supabase client')
  }

  return createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
