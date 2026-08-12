import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// Server-only admin client (service role). Never import this from a client
// component; the `import 'server-only'` above makes such an import a build
// error, so the service-role key can never ship to the browser.
let adminClient: SupabaseClient<Database> | null = null

export function getAdminClient(): SupabaseClient<Database> {
  if (adminClient) return adminClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured. Add it to .env.local to use admin features.'
    )
  }

  adminClient = createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  return adminClient
}
