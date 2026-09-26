// tools/migration/src/providers/supabase.ts
// Supabase-provider inspection plus the Auth Admin adapter.
//
// The Auth endpoint and the PostgreSQL connection are two different network
// surfaces; before any Auth mutation the tool proves they belong to the same
// project by comparing a provider user id and email against `auth.users`.
//
// `apply` uses createUser/deleteUser only. There is deliberately no generic
// update path: field conflict choices must never be implemented by rewriting
// provider credentials or identity ownership.

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
  /** Look up an existing account by exact address; never creates anything. */
  findUserByEmail(email: string): Promise<AuthUserRecord | null>
  /**
   * Provision one incoming account. `id` preserves the approved destination id
   * when the operator kept the source id; no password is ever set here.
   */
  createUser(input: { id: string; email: string; name: string; emailConfirmed: boolean; runId: string }): Promise<AuthUserRecord>
  /** Remove an account this run created (ownership-verified by journal or provider run marker). */
  deleteUser(id: string): Promise<void>
}

/**
 * Supabase Auth errors sometimes arrive with an empty `message` while the detail
 * lives in `status`/`code` (the app's own domain-whitelist trigger does this).
 * Reporting only `.message` produced "failed: {}" and hid the real reason, so
 * the status and code are included whenever the message is missing.
 */
function describeAuthError(error: { message?: string; status?: number; code?: string } | null): string {
  if (!error) return 'unknown error'
  const message = typeof error.message === 'string' ? error.message.trim() : ''
  const details = [error.status !== undefined ? `status ${error.status}` : null, error.code ? `code ${error.code}` : null]
    .filter((item): item is string => item !== null)
    .join(', ')
  if (message && message !== '{}') return details ? `${message} (${details})` : message
  return details || 'no details returned by the Auth API'
}

export function createSupabaseAuthAdmin(target: ResolvedAuthTarget): AuthAdminPort {
  const client = createClient(target.url, target.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return {
    async listUsers({ page, perPage }): Promise<AuthUserRecord[]> {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage })
      if (error) {
        throw new MigrationRunError('E_AUTH_API', `Supabase Auth admin API failed: ${describeAuthError(error)}`)
      }
      return data.users.map((user) => ({
        id: user.id,
        email: user.email ?? null,
        emailConfirmedAt: user.email_confirmed_at ?? null,
      }))
    },

    async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
      // GoTrue has no server-side exact-email filter in this client version, so
      // page through until the address is found or the user list ends.
      const wanted = email.trim().toLowerCase()
      for (let page = 1; page <= 100; page += 1) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) {
          throw new MigrationRunError('E_AUTH_API', `Supabase Auth admin API failed: ${describeAuthError(error)}`)
        }
        const match = data.users.find((user) => (user.email ?? '').toLowerCase() === wanted)
        if (match) {
          return {
            id: match.id,
            email: match.email ?? null,
            emailConfirmedAt: match.email_confirmed_at ?? null,
          }
        }
        if (data.users.length < 1000) return null
      }
      throw new MigrationRunError('E_AUTH_API', 'Supabase Auth user listing exceeded the bounded page limit.')
    },

    async createUser({ id, email, name, emailConfirmed, runId }): Promise<AuthUserRecord> {
      const { data, error } = await client.auth.admin.createUser({
        id,
        email,
        email_confirm: emailConfirmed,
        user_metadata: { name },
        app_metadata: { vsis_migration_run_id: runId },
      })
      if (error) {
        throw new MigrationRunError('E_AUTH_API', `Supabase Auth user creation failed: ${describeAuthError(error)}`)
      }
      return {
        id: data.user.id,
        email: data.user.email ?? null,
        emailConfirmedAt: data.user.email_confirmed_at ?? null,
      }
    },

    async deleteUser(id: string): Promise<void> {
      const { error } = await client.auth.admin.deleteUser(id)
      if (error) {
        throw new MigrationRunError('E_AUTH_API', `Supabase Auth user deletion failed: ${describeAuthError(error)}`)
      }
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
