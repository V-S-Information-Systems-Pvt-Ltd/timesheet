import 'server-only'

/**
 * Super-admin policy: the single active account matching SUPER_ADMIN_EMAIL with admin role.
 * Restricts destructive and global workspace mutations: branding, default layouts, db reset.
 * Single source of truth is the pure `isSuperAdminActor` predicate in lib/roles.ts.
 */
export { isSuperAdminActor as isSuperAdmin } from '@/lib/roles'
