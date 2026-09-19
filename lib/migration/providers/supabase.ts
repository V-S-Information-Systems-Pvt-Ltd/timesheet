// lib/migration/providers/supabase.ts
// Supabase-provider inspection plus the read-only Auth Admin adapter.
//
// The Auth endpoint and the PostgreSQL connection are two different network
// surfaces; before any Auth mutation the tool proves they belong to the same
// project by comparing a provider user id and email against `auth.users`.

import { createClient } from '@supabase/supabase-js'
import type { ResolvedAuthTarget } from '../connections'
import { MigrationRunError } from '../journal'
import type { DatabaseSession } from './session'

export interface AuthUserRecord {
  id: string
  email: string | null
  emailConfirmedAt: string | null
}

export interface AuthAdminPort {
  listUsers(input: { page: number; perPage: number }): Promise<AuthUserRecord[]>
}

export function createSupabaseAuthAdmin(target: ResolvedAuthTarget): AuthAdminPort {
  const client = createClient(target.url, target.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return {
    async listUsers({ page, perPage }): Promise<AuthUserRecord[]> {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage })
      if (error) {
        throw new MigrationRunError('E_AUTH_API', `Supabase Auth admin API failed: ${error.message}`)
      }
      return data.users.map((user) => ({
        id: user.id,
        email: user.email ?? null,
        emailConfirmedAt: user.email_confirmed_at ?? null,
      }))
    },
  }
}

export interface AuthBindingEvidence {
  verified: boolean
  detail: string
}

/**
 * Read-only proof that the Auth Admin endpoint and the SQL connection address
 * the same project: one provider user must exist in `auth.users` with the same
 * email. A project with no users cannot be proven and reports unverified.
 */
export async function verifyAuthDatabaseConsistency(
  session: DatabaseSession,
  auth: AuthAdminPort
): Promise<AuthBindingEvidence> {
  const users = await auth.listUsers({ page: 1, perPage: 1 })
  if (users.length === 0) {
    return { verified: false, detail: 'Auth project has no users yet; binding relies on URL identity only.' }
  }
  const [user] = users
  const rows = await session.query<{ id: string; email: string | null }>(
    'select id::text as id, email from auth.users where id = $1::uuid',
    [user.id]
  )
  if (rows.length === 0) {
    throw new MigrationRunError(
      'E_AUTH_DB_MISMATCH',
      'Supabase Auth endpoint returned a user that does not exist in this database; the Auth credentials do not belong to this project.'
    )
  }
  if ((rows[0].email ?? null) !== (user.email ?? null)) {
    throw new MigrationRunError(
      'E_AUTH_DB_MISMATCH',
      'Supabase Auth endpoint and database disagree about the same user id; refusing to bind them.'
    )
  }
  return { verified: true, detail: 'Auth user id and email agree between the Auth API and auth.users.' }
}
