// lib/auth/index.ts
// Server-side auth facade. `getSessionUser`/`getActor` resolve the current
// authenticated identity for the active backend; callers use these instead of
// reaching into Supabase or cookie logic directly.

import { IS_NATIVE } from '@/lib/backend'
import type { Actor } from '@/lib/db/repository'
import { nativeAuth } from './native'
import { supabaseAuth } from './supabase'

export interface SessionUser {
  id: string
  email: string
}

export interface Auth {
  /** Resolve the current session identity, or null when signed out. */
  getSessionUser(): Promise<SessionUser | null>
  /** Resolve the current actor (identity + role + active flag), or null. */
  getActor(): Promise<Actor | null>
}

export const auth: Auth = IS_NATIVE ? nativeAuth : supabaseAuth

export function getSessionUser(): Promise<SessionUser | null> {
  return auth.getSessionUser()
}

export function getActor(): Promise<Actor | null> {
  return auth.getActor()
}
