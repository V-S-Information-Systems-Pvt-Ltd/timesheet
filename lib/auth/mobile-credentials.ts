import 'server-only'

import { createClient } from '@supabase/supabase-js'
import { IS_NATIVE } from '@/lib/backend'
import { signIn } from './native'
import type { SessionUser } from './index'

export async function verifyMobileCredentials(
  email: string,
  password: string
): Promise<{ user: SessionUser | null; error: string | null }> {
  if (IS_NATIVE) return signIn(email, password)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Supabase auth is not configured.')

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user) return { user: null, error: 'Invalid email or password.' }
  return {
    user: { id: data.user.id, email: data.user.email ?? email },
    error: null,
  }
}
