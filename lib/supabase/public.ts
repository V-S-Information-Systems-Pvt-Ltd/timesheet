// lib/supabase/public.ts
// Server-only anonymous Supabase client for unauthenticated flows (public
// signup). Uses the anon key — never the service role — and is deliberately
// separate from the cookie-writing server client (lib/supabase/server.ts) and
// the service-role admin client (lib/supabase/admin.ts).

import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

let publicAnonClient: SupabaseClient<Database> | null = null

/**
 * Anonymous (anon-key) Supabase client for server-side unauthenticated
 * operations. Refresh and persistence are disabled: no session is ever stored
 * or refreshed on the server, so no provider token can leak into a response.
 */
export function getPublicAnonClient(): SupabaseClient<Database> {
  if (publicAnonClient) return publicAnonClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY for the public Supabase client')
  }

  publicAnonClient = createClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return publicAnonClient
}
