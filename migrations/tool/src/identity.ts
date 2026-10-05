// migrations/tool/src/identity.ts
// Destination identity provisioning for `apply`.
//
// Supabase Auth provisioning and the app-data transaction are NOT one
// transaction, so every provider-side outcome is journaled immediately in its
// own small transaction. That journal makes a lost API response reconcilable;
// the provider run marker is the fallback ownership proof if journaling fails.
// Together they let a failed merge clean up only identities this run created —
// never a pre-existing account.
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
 * Journal a created account, or remove it again. If both operations fail, the
 * provider run marker keeps the account discoverable by a later cleanup pass.
 */
async function journalCreatedOrRemove(
  deps: ProvisionDependencies,
  auth: AuthAdminPort,
  destinationId: string
): Promise<void> {
  try {
    await journalIdentity(deps.session, deps.runId, destinationId, 'created')
  } catch (journalError) {
    const removed = await auth.deleteUser(destinationId).then(() => true).catch(() => false)
    throw new MigrationRunError(
      'E_IDENTITY_JOURNAL',
      `Destination account ${destinationId} was created but its journal entry could not be written (${
        journalError instanceof Error ? journalError.message : String(journalError)
      }).${
        removed
          ? ' The account was removed again.'
          : ' The account could not be removed; inspect the destination before retrying.'
      }`
    )
  }
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
      if (!byId.email || normalize(byId.email) !== normalize(request.email)) {
        throw new MigrationRunError(
          'E_IDENTITY_MISMATCH',
          `Destination account ${request.id} does not have the reviewed email ${request.email}.`
        )
      }
      const createdByRun = byId.migrationRunId === deps.runId
      await journalIdentity(deps.session, deps.runId, request.id, createdByRun ? 'created' : 'adopted')
      outcomes.push({ id: request.id, email: request.email, action: createdByRun ? 'created' : 'adopted', detail: 'existing account reused' })
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
        runId: deps.runId,
        // Never fabricate verification: the account enrolls on the destination.
        emailConfirmed: false,
      })
      if (created.id !== request.id || !created.email || normalize(created.email) !== normalize(request.email)) {
        throw new MigrationRunError('E_IDENTITY_MISMATCH', 'Auth creation returned a different account than the reviewed plan.')
      }
      await journalCreatedOrRemove(deps, auth, created.id)
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
      if (reconciled?.migrationRunId === deps.runId && reconciled.email && normalize(reconciled.email) === normalize(request.email)) {
        await journalCreatedOrRemove(deps, auth, request.id)
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
): Promise<{ id: string; email: string | null; migrationRunId: string | null } | null> {
  const rows = await session.query<{ id: string; email: string | null; migration_run_id: string | null }>(
    "select id::text as id, email, raw_app_meta_data ->> 'vsis_migration_run_id' as migration_run_id from auth.users where id = $1::uuid",
    [id]
  )
  const row = rows[0]
  return row ? { id: row.id, email: row.email, migrationRunId: row.migration_run_id } : null
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
 * Delete only the provider identities proven to belong to this run. The normal
 * proof is a `created` journal entry; the provider run marker is the recovery
 * proof when account creation succeeded but journaling did not. Used when a
 * merge failed before commit or when an operator abandons a run; a pre-existing
 * account is never a candidate because it is journaled as `adopted` and has no
 * marker for this run.
 */
export async function cleanupRunIdentities(deps: {
  runId: string
  session: WriteSession
  auth: AuthAdminPort | null
}): Promise<{ deleted: string[]; errors: string[] }> {
  const deleted: string[] = []
  const errors: string[] = []
  const receipts = await deps.session.query<{ run_id: string }>(
    'select run_id from public.migration_runs where run_id = $1',
    [deps.runId]
  )
  if (receipts.length > 0) {
    return { deleted, errors: ['A durable import receipt exists; identity cleanup after app-data commit is forbidden.'] }
  }
  const rows = await deps.session.query<{ destination_id: string; action: string }>(
    'select destination_id, action from public.migration_identity_journal where run_id = $1 order by destination_id',
    [deps.runId]
  )
  const created = rows.filter((row) => row.action === 'created')
  // Cleanup must not depend on a journal row that may never have been written:
  // a creation whose journal write failed still carries the run marker the
  // provider set, so sweep for it as well.
  const candidates = new Set(created.map((row) => row.destination_id))
  if (deps.session.provider === 'supabase') {
    try {
      const marked = await deps.session.query<{ id: string }>(
        "select id::text as id from auth.users where raw_app_meta_data ->> 'vsis_migration_run_id' = $1 order by id",
        [deps.runId]
      )
      for (const row of marked) candidates.add(row.id)
    } catch (error) {
      errors.push(`run-marker sweep failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (candidates.size > 0 && !deps.auth) {
    errors.push('Auth Admin credentials are required to clean up run-created identities.')
    return { deleted, errors }
  }
  for (const destinationId of [...candidates].sort()) {
    if (!deps.auth) break
    try {
      const current = await findAuthUserById(deps.session, destinationId)
      if (current && current.migrationRunId !== deps.runId) {
        errors.push(`${destinationId}: Auth identity is not marked as created by this run; refusing cleanup.`)
        continue
      }
      // A previous cleanup may have deleted Auth successfully and then lost
      // the journal transaction. Treat an already-absent identity as the
      // recoverable completion of that attempt instead of calling delete again
      // and getting stuck on a provider-level "user not found" response.
      if (current) await deps.auth.deleteUser(destinationId)
      await deps.session.transaction(async (tx) => {
        await tx.query('delete from public.migration_identity_journal where run_id = $1 and destination_id = $2', [
          deps.runId,
          destinationId,
        ])
      })
      deleted.push(destinationId)
    } catch (error) {
      errors.push(`${destinationId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { deleted, errors }
}
