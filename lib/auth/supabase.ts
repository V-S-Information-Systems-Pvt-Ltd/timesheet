// lib/auth/supabase.ts
// Supabase implementation of the server-side Auth facade. Identity comes from
// the Supabase session (cookie-backed via @supabase/ssr); role/active flags
// come from the profiles table.

import { createClient } from '@/lib/supabase/server'
import type { Actor } from '@/lib/db/repository'
import type { Auth, SessionUser } from './index'

export const supabaseAuth: Auth = {
  async getSessionUser(): Promise<SessionUser | null> {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    return { id: user.id, email: user.email ?? '' }
  },

  async getActor(): Promise<Actor | null> {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
    if (!profile) return null

    return {
      id: user.id,
      email: user.email ?? '',
      role: profile.role,
      isActive: profile.is_active,
    }
  },
}
