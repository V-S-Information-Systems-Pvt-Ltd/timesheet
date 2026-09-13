// lib/supabase/bearer.ts
// Request-scoped Supabase client binding for mobile bearer tokens under RLS.
// Does NOT use browser cookies or service_role credentials.
import 'server-only'

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { AsyncLocalStorage } from 'node:async_hooks'

const bearerClientStorage = new AsyncLocalStorage<SupabaseClient<Database>>()

export function getMobileSupabaseClient(): SupabaseClient<Database> | undefined {
  return bearerClientStorage.getStore()
}

export function runWithMobileSupabaseClient<T>(
  client: SupabaseClient<Database>,
  fn: () => Promise<T>
): Promise<T> {
  return bearerClientStorage.run(client, fn)
}

/**
 * Creates a request-scoped Supabase client using publishable/anon key and the mobile bearer token.
 * PostgREST will evaluate RLS using the principal claims from this token.
 */
export function createMobileBearerClient(token: string): SupabaseClient<Database> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY for mobile bearer client')
  }

  return createSupabaseClient<Database>(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    accessToken: async () => token,
  })
}
