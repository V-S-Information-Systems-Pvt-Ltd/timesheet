// lib/migration/identity.ts
// Destination identity provisioning for `apply`.
//
// Supabase Auth provisioning and the app-data transaction are NOT one
// transaction, so every provider-side outcome is journaled immediately in its
// own small transaction. That journal is what makes a lost API response
// reconcilable and lets a failed merge clean up only identities this run
// created — never a pre-existing account.
//
// No password, hash, session or recovery token ever crosses this boundary, and
// no verification state is fabricated: new accounts enroll through the
// destination provider's own flow.

import { MigrationRunError } from './journal'
import type { ProviderName } from './format'
import type { AuthAdminPort } from './providers/supabase'
import type { WriteSession } from './providers/session'

export interface IdentityProvisionRequest {
  id: string
  email: string
  name: string
  /** Source-side verification fact, recorded for review — never applied. */
  sourceEmailConfirmed: boolean | null
}

export interface IdentityProvisionOutcome {
  id: string
  email: string
  action: 'created' | 'adopted' | 'skipped'
  detail: string | null
}

export interface ProvisionDependencies {
  runId: string
  provider: ProviderName
  requests: IdentityProvisionRequest[]
  session: WriteSession
  auth: AuthAdminPort | null
}

function normalize(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Create or adopt every planned incoming account.
 *
 * - an existing account with the planned id and the same email is adopted;
 * - an id collision with a different email, or an address already owned by
 *   another account, blocks the run (unresolved ownership must be reviewed);
 * - native deployments have no separate provider identity, so their profiles
 *   are created — without credentials — inside the app-data transaction.
 */
export async function provisionIdentities(
  deps: ProvisionDependencies
): Promise<IdentityProvisionOutcome[]> {
  if (deps.provider !== 'supabase') {
    // Native credentials live in the profile row itself; nothing to provision
    // before the app-data transaction.
    return deps.requests.map((request) => ({
      id: request.id,
      email: request.email,
      action: 'skipped' as const,
      detail: 'native identity is created inside the app-data transaction without credentials',
    }))
  }
  if (!deps.auth) {
    throw new MigrationRunError(
      'E_AUTH_REQUIRED',
      'Supabase provisioning requires the Auth Admin credentials bound to this project.'
    )
  }
  const auth = deps.auth

  const outcomes: IdentityProvisionOutcome[] = []
  for (const request of deps.requests) {
    const byId = await findAuthUserById(deps.session, request.id)
    if (byId) {
      if (byId.email && normalize(byId.email) !== normalize(request.email)) {
        throw new MigrationRunError(
          'E_IDENTITY_MISMATCH',
          `Destination account ${request.id} already belongs to ${byId.email}, not ${request.email}.`
        )
      }
      await journalIdentity(deps.session, deps.runId, request.id, 'adopted')
      outcomes.push({ id: request.id, email: request.email, action: 'adopted', detail: 'existing account reused' })
      continue
    }

    const byEmail = await findAuthUserByEmail(deps.session, request.email)
    if (byEmail && byEmail.id !== request.id) {
      throw new MigrationRunError(
        'E_EMAIL_OWNED',
        `Email ${request.email} already belongs to destination account ${byEmail.id}; unresolved email ownership blocks creation.`
      )
    }

    try {
      const created = await auth.createUser({
        id: request.id,
        email: request.email,
        name: request.name,
        // Never fabricate verification: the account enrolls on the destination.
        emailConfirmed: false,
      })
      await journalIdentity(deps.session, deps.runId, created.id, 'created')
      outcomes.push({
        id: created.id,
        email: created.email ?? request.email,
        action: 'created',
        detail:
          request.sourceEmailConfirmed === true
            ? 'source account was verified; destination enrollment re-verifies'
            : null,
      })
    } catch (error) {
      // The request may have succeeded before the response was lost. Re-check
      // the planned id once before treating this as a failure.
      const reconciled = await findAuthUserById(deps.session, request.id)
      if (reconciled) {
        await journalIdentity(deps.session, deps.runId, request.id, 'created')
        outcomes.push({
          id: request.id,
          email: reconciled.email ?? request.email,
          action: 'created',
          detail: 'creation confirmed after a failed response',
        })
        continue
      }
      throw error
    }
  }
  return outcomes
}

async function findAuthUserById(
  session: WriteSession,
  id: string
): Promise<{ id: string; email: string | null } | null> {
  const rows = await session.query<{ id: string; email: string | null }>(
    'select id::text as id, email from auth.users where id = $1::uuid',
    [id]
  )
  return rows[0] ?? null
}

async function findAuthUserByEmail(
  session: WriteSession,
  email: string
): Promise<{ id: string; email: string | null } | null> {
  const rows = await session.query<{ id: string; email: string | null }>(
    'select id::text as id, email from auth.users where lower(email) = lower($1)',
    [email]
  )
  return rows[0] ?? null
}

async function journalIdentity(
  session: WriteSession,
  runId: string,
  destinationId: string,
  action: 'created' | 'adopted'
): Promise<void> {
  await session.transaction(async (tx) => {
    await tx.query(
      `insert into public.migration_identity_journal (run_id, destination_id, action)
       values ($1, $2, $3)
       on conflict (run_id, destination_id) do update set action = excluded.action`,
      [runId, destinationId, action]
    )
  })
}

/**
 * Delete only the provider identities proven to belong to this run. Used when a
 * merge failed before commit or when an operator abandons a run; a pre-existing
 * account is never a candidate because it is journaled as `adopted`.
 */
export async function cleanupRunIdentities(deps: {
  runId: string
  session: WriteSession
  auth: AuthAdminPort | null
}): Promise<{ deleted: string[]; errors: string[] }> {
  const deleted: string[] = []
  const errors: string[] = []
  const rows = await deps.session.query<{ destination_id: string; action: string }>(
    'select destination_id, action from public.migration_identity_journal where run_id = $1 order by destination_id',
    [deps.runId]
  )
  const created = rows.filter((row) => row.action === 'created')
  if (created.length > 0 && !deps.auth) {
    return { deleted, errors: ['Auth Admin credentials are required to clean up run-created identities.'] }
  }
  for (const row of created) {
    if (!deps.auth) break
    try {
      await deps.auth.deleteUser(row.destination_id)
      await deps.session.transaction(async (tx) => {
        await tx.query('delete from public.migration_identity_journal where run_id = $1 and destination_id = $2', [
          deps.runId,
          row.destination_id,
        ])
      })
      deleted.push(row.destination_id)
    } catch (error) {
      errors.push(`${row.destination_id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { deleted, errors }
}
