import 'server-only'
import type { Actor } from '@/lib/db/repository'
import { isAdminActor } from '@/lib/roles'

/**
 * Super-admin policy: the single active account matching SUPER_ADMIN_EMAIL with admin role.
 * Restricts destructive and global workspace mutations: branding, default layouts, db reset.
 */
export function isSuperAdmin(actor: Actor | null | undefined): boolean {
  if (!actor || !actor.isActive) return false
  const configured = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase()
  if (!configured) return false
  return isAdminActor(actor) && actor.email.trim().toLowerCase() === configured
}
