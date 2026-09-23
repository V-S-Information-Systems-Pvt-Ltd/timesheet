// lib/idempotency.ts
import 'server-only'
import { createHash } from 'node:crypto'
import { query } from '@/lib/db/pool'
import { IS_NATIVE } from '@/lib/backend/config'
import { getAdminClient } from '@/lib/supabase/admin'
import { logger, extractError } from '@/lib/logger'
import {
  runWithIdempotencyScope,
  isStampedOperation,
  DuplicateDeliveryError,
  UnrecoverableDeliveryError,
  IdempotencyConflictError,
} from '@/lib/idempotency-key'
import { canonicalEffectPayload } from '@/lib/idempotency-effect'
import { admitsFreshKey, cleanupExpiredFreshKeys } from '@/lib/idempotency-fresh-key'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

/**
 * Order-independent fingerprint so the same logical payload maps to the same
 * key regardless of JSON key ordering (clients/servers may serialize differently).
 */
export function computePayloadFingerprint(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(payload ?? {}))).digest('hex')
}

export type IdempotencyClaimResult =
  | { state: 'claimed' }
  | { state: 'replay'; record: { status: number; payload: unknown } }
  | { state: 'in_flight' }
  | { state: 'conflict' }
  | { state: 'committed_unknown' }

/**
 * Stale-claim takeover window: a claim stuck at response_status = 0 older than
 * this may be atomically reclaimed by a same-key/same-payload retry instead of
 * conflicting until the 97-day retention cleanup. Crashes between a committed
 * mutation and the ledger commit would otherwise poison the key.
 */
export const STALE_CLAIM_TAKEOVER_MINUTES = 5

function staleClaimCutoffIso(now: number = Date.now()): string {
  return new Date(now - STALE_CLAIM_TAKEOVER_MINUTES * 60 * 1000).toISOString()
}

interface IdempotencyRow {
  payload_fingerprint: string
  response_status: number
  response_payload: unknown
  claimed_at?: string
  committed_unknown?: boolean
}

export async function claimIdempotencyKey(
  key: string,
  actorId: string,
  operation: string,
  fingerprint: string
): Promise<IdempotencyClaimResult> {
  if (IS_NATIVE) {
    const inserted = await query<{ key: string }>(
      `insert into public.idempotency_keys
         (key, actor_id, operation, payload_fingerprint, response_status, response_payload)
       values ($1, $2, $3, $4, 0, '{}'::jsonb)
       on conflict (key, actor_id, operation) do nothing
       returning key`,
      [key, actorId, operation, fingerprint]
    )

    if (inserted.length > 0) {
      return { state: 'claimed' }
    }

    // Existing record: serialize concurrent checks
    const rows = await query<IdempotencyRow>(
      `select payload_fingerprint, response_status, response_payload, claimed_at, committed_unknown
       from public.idempotency_keys
       where key = $1 and actor_id = $2 and operation = $3
       limit 1`,
      [key, actorId, operation]
    )
    const record = rows[0]
    if (!record) return { state: 'claimed' }

    if (record.committed_unknown) {
      return { state: 'committed_unknown' }
    }

    if (record.payload_fingerprint !== fingerprint) {
      return { state: 'conflict' }
    }

    if (record.response_status > 0) {
      return {
        state: 'replay',
        record: { status: record.response_status, payload: record.response_payload },
      }
    }

    // Native business writes and the ledger use separate autocommit queries.
    // A stale zero-status row can therefore mean the write committed just
    // before the process failed. Without immutable effect evidence we must
    // park it for review instead of permitting a duplicate mutation.
    if (record.claimed_at && record.claimed_at < staleClaimCutoffIso()) {
      return { state: 'committed_unknown' }
    }
    return { state: 'in_flight' }
  } else {
    const admin = getAdminClient() as unknown as {
      from: (table: string) => {
        insert: (row: Record<string, unknown>) => Promise<{ error: { code?: string; message?: string } | null }>
        select: (columns: string) => {
          eq: (col: string, val: string | number | boolean) => {
            eq: (col: string, val: string | number | boolean) => {
              eq: (col: string, val: string | number | boolean) => {
                maybeSingle: () => Promise<{ data: IdempotencyRow | null; error: { message?: string } | null }>
              }
            }
          }
        }
        update: (vals: Record<string, unknown>) => {
          eq: (col: string, val: unknown) => {
            eq: (col: string, val: unknown) => {
              eq: (col: string, val: unknown) => {
                eq: (col: string, val: unknown) => Promise<{ error: { message?: string } | null }>
              }
            }
          }
        }
      }
    }

    const { error: insErr } = await admin.from('idempotency_keys').insert({
      key,
      actor_id: actorId,
      operation,
      payload_fingerprint: fingerprint,
      response_status: 0,
      response_payload: {},
      claimed_at: new Date().toISOString(),
      committed_unknown: false,
    })

    if (!insErr) {
      return { state: 'claimed' }
    }

    // 23505 is PostgreSQL unique_violation code
    if (insErr.code && insErr.code !== '23505') {
      throw new Error(`Failed to claim idempotency key: ${insErr.message || insErr.code}`)
    }

    // On conflict, inspect existing row
    const { data, error: selErr } = await admin
      .from('idempotency_keys')
      .select('payload_fingerprint, response_status, response_payload, claimed_at, committed_unknown')
      .eq('key', key)
      .eq('actor_id', actorId)
      .eq('operation', operation)
      .maybeSingle()

    if (selErr) {
      throw new Error(`Failed to inspect idempotency key: ${selErr.message}`)
    }

    if (!data) return { state: 'claimed' }

    if (data.committed_unknown) {
      return { state: 'committed_unknown' }
    }

    if (data.payload_fingerprint !== fingerprint) {
      return { state: 'conflict' }
    }

    if (data.response_status > 0) {
      return {
        state: 'replay',
        record: { status: data.response_status, payload: data.response_payload },
      }
    }

    // In flight — in Supabase mode, the ledger commit is separate from the
    // business write. Only the eight queued operations have an immutable
    // database effect record written by the same transaction as the mutation;
    // they can safely reclaim a stale claim and let the adapter prove/replay
    // that effect. Ledger-only operations (batch/duplicate) must remain
    // committed-unknown rather than being executed again after the cutoff.
    const isStale = Boolean(data.claimed_at && data.claimed_at < staleClaimCutoffIso())
    if (isStale && isStampedOperation(operation)) {
      return { state: 'claimed' }
    }
    if (isStale) return { state: 'committed_unknown' }

    return { state: 'in_flight' }
  }
}

export async function commitIdempotencyKey(
  key: string,
  actorId: string,
  operation: string,
  status: number,
  payload: unknown
): Promise<void> {
  if (IS_NATIVE) {
    await query(
      `update public.idempotency_keys
       set response_status = $1, response_payload = $2, committed_unknown = false
       where key = $3 and actor_id = $4 and operation = $5`,
      [status, JSON.stringify(payload), key, actorId, operation]
    )
  } else {
    const admin = getAdminClient() as unknown as {
      from: (table: string) => {
        update: (vals: Record<string, unknown>) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => {
              eq: (col: string, val: string) => Promise<{ error: { message?: string } | null }>
            }
          }
        }
      }
    }
    const { error } = await admin
      .from('idempotency_keys')
      .update({
        response_status: status,
        response_payload: payload,
        committed_unknown: false,
      })
      .eq('key', key)
      .eq('actor_id', actorId)
      .eq('operation', operation)

    if (error) {
      throw new Error(`Failed to commit idempotency key: ${error.message}`)
    }
  }
}

export async function markIdempotencyCommittedUnknown(
  key: string,
  actorId: string,
  operation: string
): Promise<void> {
  if (IS_NATIVE) {
    await query(
      `update public.idempotency_keys
       set committed_unknown = true
       where key = $1 and actor_id = $2 and operation = $3`,
      [key, actorId, operation]
    )
  } else {
    const admin = getAdminClient() as unknown as {
      from: (table: string) => {
        update: (vals: Record<string, unknown>) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => {
              eq: (col: string, val: string) => Promise<{ error: { message?: string } | null }>
            }
          }
        }
      }
    }
    const { error } = await admin
      .from('idempotency_keys')
      .update({ committed_unknown: true })
      .eq('key', key)
      .eq('actor_id', actorId)
      .eq('operation', operation)

    if (error) {
      logger.error('Failed to mark idempotency key committed_unknown', {
        error: error.message,
        idempotencyKey: key,
      })
    }
  }
}

export async function releaseIdempotencyKey(
  key: string,
  actorId: string,
  operation: string
): Promise<void> {
  if (IS_NATIVE) {
    try {
      await query(
        `delete from public.idempotency_keys
         where key = $1 and actor_id = $2 and operation = $3 and response_status = 0 and committed_unknown = false`,
        [key, actorId, operation]
      )
    } catch {
      // non-blocking cleanup
    }
  } else {
    try {
      const admin = getAdminClient() as unknown as {
        from: (table: string) => {
          delete: () => {
            eq: (col: string, val: string | number | boolean) => {
              eq: (col: string, val: string | number | boolean) => {
                eq: (col: string, val: string | number | boolean) => {
                  eq: (col: string, val: string | number | boolean) => {
                    eq: (col: string, val: string | number | boolean) => Promise<{ error: unknown }>
                  }
                }
              }
            }
          }
        }
      }
      await admin
        .from('idempotency_keys')
        .delete()
        .eq('key', key)
        .eq('actor_id', actorId)
        .eq('operation', operation)
        .eq('response_status', 0)
        .eq('committed_unknown', false)
    } catch {
      // non-blocking cleanup
    }
  }
}

export async function cleanupIdempotencyKeys(retentionDays = 97): Promise<number> {
  // Retention = OFFLINE_REPLAY_MAX_AGE_DAYS (90, mobile sync-engine) + 7-day
  // grace. Change the queue, ledger, and Supabase effect retention together if
  // product extends offline life.
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const cleanupTickets = async () => {
    try {
      await cleanupExpiredFreshKeys()
    } catch (error) {
      // A mixed-version deployment may run cleanup before the additive table
      // migration. Never let ticket pruning disable ordinary ledger cleanup.
      logger.error('Failed to cleanup expired fresh keys', { error: extractError(error) })
    }
  }
  if (IS_NATIVE) {
    const res = await query<{ count: string }>(
      `with deleted as (
         delete from public.idempotency_keys
         where created_at < $1
         returning 1
       )
       select count(*)::text as count from deleted`,
      [cutoff.toISOString()]
    )
    await cleanupTickets()
    return parseInt(res[0]?.count || '0', 10)
  } else {
    const admin = getAdminClient() as unknown as {
      from: (table: string) => {
        delete: (opts?: { count?: string }) => {
          lt: (col: string, val: string) => Promise<{ count: number | null; error: { message?: string } | null }>
        }
      }
    }
    const { error: effectError } = await admin
      .from('idempotency_effects')
      .delete()
      .lt('created_at', cutoff.toISOString())
    if (effectError) {
      logger.error('Failed to cleanup idempotency effects', { error: effectError.message })
      // Keep the ledger while immutable evidence remains. Otherwise a reused
      // key outside the retention window could be mistaken for an old effect.
      return 0
    }

    const { count, error } = await admin
      .from('idempotency_keys')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff.toISOString())
    if (error) {
      logger.error('Failed to cleanup idempotency keys', { error: error.message })
      return 0
    }
    await cleanupTickets()
    return count ?? 0
  }
}

export interface IdempotencyOptions {
  /**
   * Success status for a stamp-recovered replay. Must match the route's own
   * success status (201 for creates, 200 otherwise) so a recovered delivery
   * is indistinguishable from the original. The body is always the canonical
   * queued-operation envelope { data: { success: true }, error: null },
   * which matches every queued mutation route.
   */
  successStatus?: number
  /**
   * Optional reauthorization re-check invoked before a stored response is
   * returned to a replay (never before the first execution). Return an error
   * Response (e.g. 403) to deny access to the stored data, or null to allow.
   * T19.2 requires reauthentication/authorization before returning stored data.
   */
  reauthorize?: (
    stored: { status: number; payload: unknown } | { responseStatus: number } | null
  ) => Promise<Response | null>
}

/** Canonical queued-operation success envelope for recovered stamped replays. */
const STAMPED_SUCCESS_BODY = { data: { success: true }, error: null }

interface IdempotencyEffectRow {
  response_status: number
  effect_fingerprint: string | null
  resource_id: string | null
}

interface LegacyStampedLedgerRow {
  payload_fingerprint: string
  response_status: number
  committed_unknown: boolean
  claimed_at?: string
}

interface PortableRetryRow {
  source_namespace: string
  source_actor_id: string
  outcome: 'committed' | 'uncertain'
  response_status: number
  fingerprint_kind: 'request-json-v1' | 'effect-v1'
  fingerprint: string | null
}

interface PortableMapRow {
  entity: string
  source_id: string
  destination_id: string
}

const PORTABLE_OPERATIONS = new Set([
  'create_timesheet', 'update_timesheet', 'delete_timesheet',
  'create_leave', 'delete_leave',
  'create_reminder', 'update_reminder', 'delete_reminder',
])

async function readPortableRetryRows(
  key: string,
  actorId: string,
  operation: string
): Promise<PortableRetryRow[]> {
  if (IS_NATIVE) {
    return query<PortableRetryRow>(
      `select source_namespace, source_actor_id, outcome, response_status,
              fingerprint_kind, fingerprint
         from public.migration_retry_history
        where key = $1 and destination_actor_id = $2 and operation = $3
        order by source_namespace, source_actor_id`,
      [key, actorId, operation]
    )
  }
  const admin = getAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            eq: (column: string, value: string) => Promise<{
              data: PortableRetryRow[] | null
              error: { message?: string } | null
            }>
          }
        }
      }
    }
  }
  const { data, error } = await admin
    .from('migration_retry_history')
    .select('source_namespace, source_actor_id, outcome, response_status, fingerprint_kind, fingerprint')
    .eq('key', key)
    .eq('destination_actor_id', actorId)
    .eq('operation', operation)
  if (error) throw new Error(`Portable idempotency history lookup failed: ${error.message}`)
  return Array.isArray(data) ? data : []
}

function portablePayloadIds(operation: string, payload: unknown): Array<{ entity: string; id: string }> {
  const p = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}
  const found: Array<{ entity: string; id: string }> = []
  const add = (entity: string, value: unknown) => {
    if (typeof value === 'string' && value.length > 0) found.push({ entity, id: value })
  }
  if (operation === 'create_timesheet' || operation === 'update_timesheet') {
    add('profiles', p.userId)
    add('projects', p.projectId)
    add('activity_types', p.activityTypeId)
  }
  if (operation === 'update_timesheet' || operation === 'delete_timesheet') add('timesheets', p.id)
  if (operation === 'delete_leave') add('leaves', p.id)
  if (operation === 'update_reminder' || operation === 'delete_reminder') add('reminders', p.id)
  if (operation === 'create_leave') {
    const rows = Array.isArray(p.rows) ? p.rows : Array.isArray(payload) ? payload : []
    for (const row of rows) {
      if (row && typeof row === 'object') add('profiles', (row as Record<string, unknown>).userId)
    }
  }
  return found
}

async function readPortableSourceActors(actorId: string): Promise<Array<{ source_namespace: string; source_id: string }>> {
  if (IS_NATIVE) {
    return query(
      `select source_namespace, source_id
         from public.migration_record_map
        where entity = 'profiles' and destination_id = $1
        order by source_namespace`,
      [actorId]
    )
  }
  const admin = getAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => Promise<{
            data: Array<{ source_namespace: string; source_id: string }> | null
            error: { message?: string } | null
          }>
        }
      }
    }
  }
  const { data, error } = await admin
    .from('migration_record_map')
    .select('source_namespace, source_id')
    .eq('entity', 'profiles')
    .eq('destination_id', actorId)
  if (error) throw new Error(`Portable actor mapping lookup failed: ${error.message}`)
  return Array.isArray(data) ? data : []
}

async function readForwardPortableMappings(
  sourceNamespace: string,
  wanted: Array<{ entity: string; id: string }>
): Promise<PortableMapRow[]> {
  const ids = [...new Set(wanted.map((item) => item.id))]
  if (ids.length === 0) return []
  if (IS_NATIVE) {
    return query<PortableMapRow>(
      `select entity, source_id, destination_id
         from public.migration_record_map
        where source_namespace = $1 and source_id = any($2::text[])`,
      [sourceNamespace, ids]
    )
  }
  const admin = getAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          in: (column: string, values: string[]) => Promise<{
            data: PortableMapRow[] | null
            error: { message?: string } | null
          }>
        }
      }
    }
  }
  const { data, error } = await admin
    .from('migration_record_map')
    .select('entity, source_id, destination_id')
    .eq('source_namespace', sourceNamespace)
    .in('source_id', ids)
  if (error) throw new Error(`Portable source mapping lookup failed: ${error.message}`)
  return data ?? []
}

/**
 * Adopted rule for a queued payload that reached no source history (C06A
 * contract §1a): classify it by what resolves.
 *
 * - every referenced id is a source id of this actor's deployment and was
 *   remapped -> the payload is source-era: translate it and execute translated;
 * - none of them is such a source id -> the payload is destination-era: execute
 *   it unchanged — unless it carries no mapping evidence at all
 *   (`unresolved`), which for a remapped actor is manual review (C06A §2 rule 3);
 * - a mix, an id that is simultaneously a source id and another record's
 *   destination id, or more than one mapped namespace -> manual review.
 *
 * Pure so the decision can be tested without a database; the caller supplies the
 * map rows it already reads.
 */
export type PortablePayloadOutcome = 'destination-era' | 'translate' | 'review'

export interface PortablePayloadDecision {
  outcome: PortablePayloadOutcome
  /** source id -> destination id, for the ids this payload references. */
  translation: Record<string, string>
  reason?: string
  /**
   * destination-era only: the payload carries no mapping evidence — at least
   * one referenced id is unknown to the mapping table in both directions, or
   * the operation references no ids at all. For a remapped actor such a
   * payload cannot be proven post-cutover and must not execute as fresh work.
   */
  unresolved?: boolean
}

export function decidePortablePayload(
  wanted: Array<{ entity: string; id: string }>,
  forwardRows: PortableMapRow[],
  reverseRows: PortableMapRow[],
  namespaceCount: number
): PortablePayloadDecision {
  if (namespaceCount > 1) {
    return { outcome: 'review', translation: {}, reason: 'the actor is mapped from more than one deployment' }
  }
  if (wanted.length === 0) return { outcome: 'destination-era', translation: {}, unresolved: true }

  // Keyed by entity and id: the same uuid may name records of different types,
  // and only the field's own entity may decide what it refers to.
  const forward = new Map(forwardRows.map((row) => [`${row.entity}:${row.source_id}`, row.destination_id]))
  const isDestinationOfRemapped = new Set(
    reverseRows.filter((row) => row.source_id !== row.destination_id).map((row) => `${row.entity}:${row.destination_id}`)
  )
  // Every destination id the mapping table knows about, stable or moved: an id
  // found here belongs to the merged namespace even when it needs no rewrite.
  const knownDestinationIds = new Set(reverseRows.map((row) => `${row.entity}:${row.destination_id}`))

  const translation: Record<string, string> = {}
  const distinct = new Set(wanted.map((item) => `${item.entity}:${item.id}`))
  for (const item of wanted) {
    const key = `${item.entity}:${item.id}`
    const destination = forward.get(key)
    if (destination === undefined || destination === item.id) continue
    // The id is a source id that moved, and it also names another record on the
    // destination side: translating or leaving it would both be a guess.
    if (isDestinationOfRemapped.has(key)) {
      return { outcome: 'review', translation: {}, reason: `id ${item.id} exists on both sides of the mapping` }
    }
    translation[key] = destination
  }

  const remapped = Object.keys(translation)
  if (remapped.length === 0) {
    const unresolved = !wanted.every(
      (item) => forward.has(`${item.entity}:${item.id}`) || knownDestinationIds.has(`${item.entity}:${item.id}`)
    )
    return { outcome: 'destination-era', translation: {}, unresolved }
  }
  if (remapped.length !== distinct.size) {
    return {
      outcome: 'review',
      translation: {},
      reason: 'the payload mixes source-era and destination-era identifiers',
    }
  }
  return { outcome: 'translate', translation }
}

/**
 * Rewrite the payload's identifiers in place. Routes hand the same object to the
 * fingerprint and to their execute closure, so the mutation reaches the write
 * that runs; nothing else in the request is touched.
 */
export function applyPortableTranslation(
  operation: string,
  payload: unknown,
  translation: Record<string, string>
): void {
  const replace = (target: Record<string, unknown>, entity: string, field: string) => {
    const value = target[field]
    if (typeof value !== 'string') return
    const destination = translation[`${entity}:${value}`]
    if (destination) target[field] = destination
  }
  const root = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null
  if (!root) return
  if (operation === 'create_timesheet' || operation === 'update_timesheet') {
    replace(root, 'profiles', 'userId')
    replace(root, 'projects', 'projectId')
    replace(root, 'activity_types', 'activityTypeId')
  }
  if (operation === 'update_timesheet' || operation === 'delete_timesheet') replace(root, 'timesheets', 'id')
  if (operation === 'delete_leave') replace(root, 'leaves', 'id')
  if (operation === 'update_reminder' || operation === 'delete_reminder') replace(root, 'reminders', 'id')
  if (operation === 'create_leave') {
    const rows = Array.isArray(root.rows) ? root.rows : Array.isArray(payload) ? (payload as unknown[]) : []
    for (const row of rows) {
      if (row && typeof row === 'object') replace(row as Record<string, unknown>, 'profiles', 'userId')
    }
  }
}

async function classifyPortablePayload(
  actorId: string,
  operation: string,
  payload: unknown
): Promise<PortablePayloadDecision & { actorRemapped: boolean }> {
  if (!PORTABLE_OPERATIONS.has(operation)) {
    return { outcome: 'destination-era', translation: {}, actorRemapped: false }
  }
  const actors = await readPortableSourceActors(actorId)
  if (actors.length === 0) {
    return { outcome: 'destination-era', translation: {}, actorRemapped: false }
  }
  const wanted = portablePayloadIds(operation, payload)
  if (wanted.length === 0) {
    // A remapped actor's reference-free payload (a queued create) cannot be
    // proven post-cutover: nothing about it ties the key to either deployment.
    return { outcome: 'destination-era', translation: {}, unresolved: true, actorRemapped: true }
  }
  const namespace = actors[0].source_namespace
  const forward = await readForwardPortableMappings(namespace, wanted)
  const reverse = await readPortableMappings(namespace, wanted)
  return { ...decidePortablePayload(wanted, forward, reverse, actors.length), actorRemapped: true }
}

async function readPortableMappings(
  sourceNamespace: string,
  wanted: Array<{ entity: string; id: string }>
): Promise<PortableMapRow[]> {
  const ids = [...new Set(wanted.map((item) => item.id))]
  if (ids.length === 0) return []
  if (IS_NATIVE) {
    return query<PortableMapRow>(
      `select entity, source_id, destination_id
         from public.migration_record_map
        where source_namespace = $1 and destination_id = any($2::text[])`,
      [sourceNamespace, ids]
    )
  }
  const admin = getAdminClient() as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          in: (column: string, values: string[]) => Promise<{
            data: PortableMapRow[] | null
            error: { message?: string } | null
          }>
        }
      }
    }
  }
  const { data, error } = await admin
    .from('migration_record_map')
    .select('entity, source_id, destination_id')
    .eq('source_namespace', sourceNamespace)
    .in('destination_id', ids)
  if (error) throw new Error(`Portable idempotency mapping lookup failed: ${error.message}`)
  return data ?? []
}

async function remapPortablePayload(
  sourceNamespace: string,
  operation: string,
  payload: unknown
): Promise<unknown> {
  const wanted = portablePayloadIds(operation, payload)
  const mappings = await readPortableMappings(sourceNamespace, wanted)
  const reverse = new Map(mappings.map((row) => [`${row.entity}\u0000${row.destination_id}`, row.source_id]))
  const sourceId = (entity: string, value: unknown) =>
    typeof value === 'string' ? reverse.get(`${entity}\u0000${value}`) ?? value : value
  if (!payload || typeof payload !== 'object') return payload
  if (Array.isArray(payload)) {
    if (operation !== 'create_leave') return payload
    return payload.map((row) => row && typeof row === 'object'
      ? { ...row, userId: sourceId('profiles', (row as Record<string, unknown>).userId) }
      : row)
  }
  const p = payload as Record<string, unknown>
  const copy: Record<string, unknown> = { ...p }
  if (operation === 'create_timesheet' || operation === 'update_timesheet') {
    copy.userId = sourceId('profiles', p.userId)
    copy.projectId = sourceId('projects', p.projectId)
    copy.activityTypeId = sourceId('activity_types', p.activityTypeId)
  }
  if (operation === 'update_timesheet' || operation === 'delete_timesheet') copy.id = sourceId('timesheets', p.id)
  if (operation === 'delete_leave') copy.id = sourceId('leaves', p.id)
  if (operation === 'update_reminder' || operation === 'delete_reminder') copy.id = sourceId('reminders', p.id)
  if (operation === 'create_leave' && Array.isArray(p.rows)) {
    copy.rows = p.rows.map((row) => row && typeof row === 'object'
      ? { ...row, userId: sourceId('profiles', (row as Record<string, unknown>).userId) }
      : row)
  }
  return copy
}

async function computePortableEffectFingerprint(operation: string, payload: unknown): Promise<string> {
  if (!IS_NATIVE) return computeEffectFingerprintViaAdmin(operation, payload)
  const rows = await query<{ fingerprint: string }>(
    'select public.idempotency_effect_fingerprint($1, $2::jsonb) as fingerprint',
    [operation, JSON.stringify(payload)]
  )
  const fingerprint = rows[0]?.fingerprint
  if (!fingerprint) throw new Error('Portable idempotency fingerprint returned no value.')
  return fingerprint
}

type LocalPortableState = 'none' | 'match' | 'conflict' | 'in_flight' | 'uncertain'

async function localPortableState(
  key: string,
  actorId: string,
  operation: string,
  payload: unknown
): Promise<LocalPortableState> {
  if (IS_NATIVE) {
    const rows = await query<IdempotencyRow>(
      `select payload_fingerprint, response_status, response_payload, claimed_at, committed_unknown
         from public.idempotency_keys
        where key = $1 and actor_id = $2 and operation = $3 limit 1`,
      [key, actorId, operation]
    )
    const row = rows[0]
    if (!row) return 'none'
    if (row.committed_unknown) return 'uncertain'
    if (row.response_status <= 0) return 'in_flight'
    return row.payload_fingerprint === computePayloadFingerprint(payload) ? 'match' : 'conflict'
  }
  const effect = await readIdempotencyEffectRow(key, actorId, operation)
  if (effect) {
    if (effect.response_status <= 0 || !effect.effect_fingerprint) return 'uncertain'
    const incoming = await computeEffectFingerprintViaAdmin(
      operation,
      canonicalEffectPayload(operation, payload, actorId)
    )
    return incoming === effect.effect_fingerprint ? 'match' : 'conflict'
  }
  const legacy = await readLegacyStampedLedger(key, actorId, operation)
  if (!legacy) return 'none'
  if (legacy.committed_unknown) return 'uncertain'
  if (legacy.response_status <= 0) return 'in_flight'
  return legacy.payload_fingerprint === computePayloadFingerprint(payload) ? 'match' : 'conflict'
}

/**
 * Resolve imported histories before claiming a destination-local key. Because
 * requests carry no deployment namespace, every source history and the local
 * history participate; exactly one committed fingerprint may match.
 */
async function resolvePortableRetry(
  key: string,
  actorId: string,
  operation: string,
  payload: unknown,
  opts?: IdempotencyOptions
): Promise<Response | 'local' | null> {
  if (!PORTABLE_OPERATIONS.has(operation)) return null
  const imported = await readPortableRetryRows(key, actorId, operation)
  const matches: PortableRetryRow[] = []
  for (const row of imported) {
    if (row.outcome !== 'committed' || !row.fingerprint) continue
    const sourcePayload = await remapPortablePayload(row.source_namespace, operation, payload)
    const incoming = row.fingerprint_kind === 'request-json-v1'
      ? computePayloadFingerprint(sourcePayload)
      : await computePortableEffectFingerprint(
          operation,
          canonicalEffectPayload(operation, sourcePayload, row.source_actor_id)
        )
    if (incoming === row.fingerprint) matches.push(row)
  }
  const localState = await localPortableState(key, actorId, operation, payload)
  if (localState === 'uncertain') return commitUnknownResponse()
  if (localState === 'in_flight') {
    return busyResponse(
      'IDEMPOTENCY_IN_FLIGHT',
      'A request with this idempotency key is already in progress. Retry with the same key.'
    )
  }
  const localMatch = localState === 'match'
  const matchCount = matches.length + (localMatch ? 1 : 0)
  if (matchCount > 1) {
    return busyResponse(
      'IDEMPOTENCY_NAMESPACE_AMBIGUOUS',
      'The idempotency key matches histories from multiple deployment namespaces.'
    )
  }
  if (localMatch) return 'local'
  if (imported.length === 0) {
    // No portable source candidate exists. A durable destination-local
    // outcome still owns this key and must replay even if its issuance ticket
    // has since expired or the fence generation has changed. Only a key with
    // no local history reaches fresh-admission classification below.
    if (localState === 'conflict') {
      return busyResponse('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with different payload.')
    }
    return null
  }
  const match = matches[0]
  if (!match) {
    if (imported.some((row) => row.outcome === 'uncertain')) return commitUnknownResponse()
    return busyResponse('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with different payload.')
  }
  const denied = await reauthorizeOrDeny(opts, { responseStatus: match.response_status })
  if (denied) return denied
  return stampedSuccessResponse(match.response_status)
}

/**
 * Read the immutable Supabase effect evidence for one keyed delivery. The
 * effect is written by the DB trigger in the same transaction as the business
 * write, so its existence proves the mutation committed (even when the target
 * row was later deleted). Service-role read here is scoped by the exact
 * (key, actor, operation) primary key; the trigger's own data is server-authoritative.
 */
async function readIdempotencyEffectRow(
  key: string,
  actorId: string,
  operation: string
): Promise<IdempotencyEffectRow | null> {
  const admin = getAdminClient() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            eq: (c: string, v: string) => {
              maybeSingle: () => Promise<{
                data: IdempotencyEffectRow | null
                error: { message?: string } | null
              }>
            }
          }
        }
      }
    }
  }
  const { data, error } = await admin
    .from('idempotency_effects')
    .select('response_status, effect_fingerprint, resource_id')
    .eq('key', key)
    .eq('actor_id', actorId)
    .eq('operation', operation)
    .maybeSingle()
  if (error) {
    throw new Error(`Idempotency effect lookup failed: ${error.message}`)
  }
  return data
}

/**
 * Ask Postgres for the canonical fingerprint of the incoming request. The DB
 * hashes the stored row with the same function, so a mismatch proves the reused
 * key carries a different payload (DB-2) and must not replay as success.
 */
async function computeEffectFingerprintViaAdmin(operation: string, payload: unknown): Promise<string> {
  const admin = getAdminClient() as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message?: string } | null }>
  }
  const { data, error } = await admin.rpc('idempotency_effect_fingerprint', {
    p_operation: operation,
    p_payload: payload,
  })
  if (error) {
    throw new Error(`Idempotency fingerprint failed: ${error.message}`)
  }
  if (typeof data !== 'string' || data.length === 0) {
    throw new Error('Idempotency fingerprint returned no value.')
  }
  return data
}

/**
 * Legacy `idempotency_keys` row that may exist from deployments predating the
 * atomic trigger design (claim+write+commit are now all inside the business
 * write). New stamped deliveries never consult it except to absorb pre-existing
 * rows during the migration window.
 */
async function readLegacyStampedLedger(
  key: string,
  actorId: string,
  operation: string
): Promise<LegacyStampedLedgerRow | null> {
  const admin = getAdminClient() as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            eq: (c: string, v: string) => {
              maybeSingle: () => Promise<{
                data: LegacyStampedLedgerRow | null
                error: { message?: string } | null
              }>
            }
          }
        }
      }
    }
  }
  const { data, error } = await admin
    .from('idempotency_keys')
    .select('response_status, committed_unknown, payload_fingerprint, claimed_at')
    .eq('key', key)
    .eq('actor_id', actorId)
    .eq('operation', operation)
    .maybeSingle()
  if (error) {
    // A lookup failure must not fail open: returning null here would let an old
    // committed ledger row (from pre-trigger deployments) slip past undetected
    // and the mutation execute a second time. Surface a retryable error
    // instead, exactly as readIdempotencyEffectRow does.
    throw new Error(`Idempotency ledger lookup failed: ${error.message}`)
  }
  return data
}

async function reauthorizeOrDeny(
  opts: IdempotencyOptions | undefined,
  stored: { status: number; payload: unknown } | { responseStatus: number } | null
): Promise<Response | null> {
  if (!opts?.reauthorize) return null
  return opts.reauthorize(stored)
}

function stampedSuccessResponse(status: number): Response {
  return Response.json(STAMPED_SUCCESS_BODY, { status })
}

function replayResponse(record: { status: number; payload: unknown }): Response {
  return Response.json(record.payload, { status: record.status })
}

function busyResponse(
  code:
    | 'IDEMPOTENCY_IN_FLIGHT'
    | 'IDEMPOTENCY_CONFLICT'
    | 'IDEMPOTENCY_NAMESPACE_AMBIGUOUS'
    | 'IDEMPOTENCY_REVIEW_REQUIRED',
  message: string
): Response {
  return Response.json({ data: null, error: { code, message } }, { status: 409 })
}

function commitUnknownResponse(): Response {
  return Response.json(
    {
      data: null,
      error: {
        code: 'IDEMPOTENCY_COMMIT_UNKNOWN',
        message: 'The operation already completed but its outcome could not be recorded. Do not re-run this mutation.',
      },
    },
    { status: 409 }
  )
}

/**
 * Bounded ledger commit shared by the normal and recovery paths. Returns null
 * once the outcome is recorded, or a 409 committed-unknown response when the
 * outcome cannot be recorded (the key stays parked for manual review and can
 * never be taken over for re-execution).
 */
async function commitLedger(
  key: string,
  actorId: string,
  operation: string,
  status: number,
  body: unknown
): Promise<Response | null> {
  let lastCommitErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await commitIdempotencyKey(key, actorId, operation, status, body)
      return null
    } catch (commitErr) {
      lastCommitErr = commitErr
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 50))
      }
    }
  }
  logger.error('Failed to commit idempotency key after successful mutation', {
    error: extractError(lastCommitErr),
    idempotencyKey: key,
  })
  try {
    await markIdempotencyCommittedUnknown(key, actorId, operation)
  } catch (markErr) {
    logger.error('Failed to mark idempotency key as committed_unknown', {
      error: extractError(markErr),
      idempotencyKey: key,
    })
  }
  return commitUnknownResponse()
}

/**
 * Complete a delivery proven applied by immutable effect evidence: record the
 * canonical queued-operation success in the ledger so this and future
 * retries replay without re-executing (no double budget/audit charge).
 */
async function completeDuplicateRecovery(
  key: string,
  actorId: string,
  operation: string,
  opts?: IdempotencyOptions
): Promise<Response> {
  const status = opts?.successStatus ?? 200
  const body = { data: { success: true }, error: null }
  const denied = await reauthorizeOrDeny(opts, { status, payload: body })
  if (denied) return denied
  const unknown = await commitLedger(key, actorId, operation, status, body)
  if (unknown) return unknown
  return Response.json(body, { status })
}

export async function withIdempotency(
  request: Request,
  actorId: string,
  operation: string,
  fingerprintPayload: unknown,
  execute: () => Promise<Response>,
  opts?: IdempotencyOptions
): Promise<Response> {
  const idempotencyKey = request.headers.get('idempotency-key') || request.headers.get('x-idempotency-key')
  if (!idempotencyKey) {
    return execute()
  }

  const portable = await resolvePortableRetry(idempotencyKey, actorId, operation, fingerprintPayload, opts)
  if (portable instanceof Response) return portable
  // C06A §1a: a queued item that reached no history is classified by what its
  // identifiers resolve to. Translation is applied to the payload object the
  // route shares with its execute closure, so an executed request carries the
  // destination ids; an unresolvable or mixed payload is refused for review.
  const classification = portable === 'local'
    ? { outcome: 'destination-era' as const, translation: {}, actorRemapped: false }
    : await classifyPortablePayload(actorId, operation, fingerprintPayload)
  if (classification.outcome === 'review') {
    return busyResponse(
      'IDEMPOTENCY_NAMESPACE_AMBIGUOUS',
      `This queued operation requires manual review: ${classification.reason ?? 'its identifiers cannot be resolved safely'}.`
    )
  }
  if (classification.outcome === 'translate') {
    applyPortableTranslation(operation, fingerprintPayload, classification.translation)
  }
  if (classification.outcome === 'destination-era' && classification.actorRemapped && classification.unresolved) {
    // Reference-free creates cannot prove their queue era from payload IDs.
    // A key issued by this destination for the current admitted generation can
    // prove it instead. Never bless an old caller-selected key on retry.
    const referenceFreeCreate =
      (operation === 'create_reminder' || operation === 'create_leave') &&
      portablePayloadIds(operation, fingerprintPayload).length === 0
    const admitted = referenceFreeCreate &&
      await admitsFreshKey(idempotencyKey, actorId, operation)
    if (!admitted) {
      // A remapped actor's legacy key without mapping evidence cannot be
      // proven post-cutover. The payload remains available for manual review.
      return busyResponse(
        'IDEMPOTENCY_REVIEW_REQUIRED',
        'This queued operation predates the migration or cannot be proven current. It was not executed and requires manual review.'
      )
    }
    // Continue through the ordinary atomic idempotency claim below.
  }

  const fingerprint = computePayloadFingerprint(fingerprintPayload)

  if (IS_NATIVE) {
    return runWithIdempotencyScope({ key: idempotencyKey, operation }, async () => {
      const claim = await claimIdempotencyKey(idempotencyKey, actorId, operation, fingerprint)
      if (claim.state === 'replay') {
        const denied = await reauthorizeOrDeny(opts, claim.record)
        if (denied) return denied
        return replayResponse(claim.record)
      }
      if (claim.state === 'committed_unknown') {
        return commitUnknownResponse()
      }
      if (claim.state === 'in_flight') {
        return busyResponse(
          'IDEMPOTENCY_IN_FLIGHT',
          'A request with this idempotency key is already in progress. Retry with the same key.'
        )
      }
      if (claim.state === 'conflict') {
        return busyResponse('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with different payload.')
      }

      let response: Response
      try {
        response = await execute()
      } catch (err) {
        await releaseIdempotencyKey(idempotencyKey, actorId, operation)
        throw err
      }

      if (response.ok) {
        let body: unknown = {}
        try {
          body = await response.clone().json()
        } catch {
          body = {}
        }
        const unknown = await commitLedger(idempotencyKey, actorId, operation, response.status, body)
        if (unknown) return unknown
      } else {
        await releaseIdempotencyKey(idempotencyKey, actorId, operation)
      }
      return response
    })
  }

  // Supabase: the eight queued operations are effect-idempotent. Claim, write,
  // and response commit all run inside the business write's DB transaction via
  // the idempotency triggers; no separate claim/commit requests are made here.
  if (isStampedOperation(operation)) {
    return runSupabaseStampedDelivery(
      idempotencyKey,
      actorId,
      operation,
      fingerprintPayload,
      execute,
      opts
    )
  }

  // Ledger-only operations (batch/duplicate) keep the explicit claim/commit
  // path; they are not part of the eight queued offline mutations.
  const claim = await claimIdempotencyKey(idempotencyKey, actorId, operation, fingerprint)
  if (claim.state === 'replay') {
    const denied = await reauthorizeOrDeny(opts, claim.record)
    if (denied) return denied
    return replayResponse(claim.record)
  }
  if (claim.state === 'committed_unknown') {
    return commitUnknownResponse()
  }
  if (claim.state === 'in_flight') {
    return busyResponse(
      'IDEMPOTENCY_IN_FLIGHT',
      'A request with this idempotency key is already in progress. Retry with the same key.'
    )
  }
  if (claim.state === 'conflict') {
    return busyResponse('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with different payload.')
  }

  let mutationCommitted = false
  try {
    const response = await runWithIdempotencyScope(
      { key: idempotencyKey, operation },
      execute
    )
    if (response.ok) {
      mutationCommitted = true
      let body: unknown = {}
      try {
        body = await response.clone().json()
      } catch {
        body = {}
      }
      const unknown = await commitLedger(idempotencyKey, actorId, operation, response.status, body)
      if (unknown) return unknown
    } else {
      await releaseIdempotencyKey(idempotencyKey, actorId, operation)
    }
    return response
  } catch (err) {
    if (err instanceof DuplicateDeliveryError) {
      return completeDuplicateRecovery(idempotencyKey, actorId, operation, opts)
    }
    if (err instanceof UnrecoverableDeliveryError) {
      return commitUnknownResponse()
    }
    if (!mutationCommitted) {
      await releaseIdempotencyKey(idempotencyKey, actorId, operation)
    }
    throw err
  }
}

/**
 * Supabase stamped delivery: the DB triggers own the idempotency semantics
 * inside the write's transaction. This wrapper only (a) absorbs legacy ledger
 * rows from pre-trigger deployments, (b) maps a NOT_FOUND after a committed
 * effect to the replayed success (the deleted-resource case), and (c) translates
 * trigger-raised outcomes into the v1 error envelope.
 */
async function runSupabaseStampedDelivery(
  key: string,
  actorId: string,
  operation: string,
  fingerprintPayload: unknown,
  execute: () => Promise<Response>,
  opts?: IdempotencyOptions
): Promise<Response> {
  // Legacy rows written by pre-atomic deployments. New stamped deliveries
  // never create these; absorb them until retention cleanup. A legacy row is
  // only treated as committed when its payload fingerprint matches the incoming
  // canonical request AND it carries a positive response status (a zero status
  // means the mutation never provably committed — reporting success would make
  // the client dequeue work that did not run).
  const legacy = await readLegacyStampedLedger(key, actorId, operation)
  if (legacy) {
    if (legacy.committed_unknown) {
      const effect = await readIdempotencyEffectRow(key, actorId, operation)
      if (!effect) return commitUnknownResponse()
      // Effect evidence proves the mutation committed, but a committed effect
      // only replays the SAME canonical request (DB-2). Compare fingerprints
      // before reporting success, otherwise a reused key carrying a changed
      // payload would silently dequeue a different mutation. The
      // committed_unknown ledger row has no usable status (the commit was
      // lost), so the effect's own response_status is authoritative here.
      if (effect.effect_fingerprint) {
        const incoming = await computeEffectFingerprintViaAdmin(
          operation,
          canonicalEffectPayload(operation, fingerprintPayload, actorId)
        )
        if (incoming !== effect.effect_fingerprint) {
          return busyResponse('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with different payload.')
        }
      }
      const denied = await reauthorizeOrDeny(opts, { responseStatus: effect.response_status })
      if (denied) return denied
      return stampedSuccessResponse(
        effect.response_status > 0 ? effect.response_status : (opts?.successStatus ?? 200)
      )
    }
    if (legacy.payload_fingerprint !== computePayloadFingerprint(fingerprintPayload)) {
      return busyResponse('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with different payload.')
    }
    if (legacy.response_status <= 0) {
      // A stale in-flight legacy claim may have crashed between mutation commit
      // and ledger commit. Let the stamp-guarded mutation prove whether the
      // effect already applied; otherwise the claim is still live. Rows with no
      // claimed_at timestamp are treated as stale so they cannot poison the key
      // indefinitely.
      const isStale = !legacy.claimed_at || legacy.claimed_at < staleClaimCutoffIso()
      if (!isStale) {
        return busyResponse(
          'IDEMPOTENCY_IN_FLIGHT',
          'A request with this idempotency key is already in progress. Retry with the same key.'
        )
      }
    } else {
      const denied = await reauthorizeOrDeny(opts, { responseStatus: legacy.response_status })
      if (denied) return denied
      return stampedSuccessResponse(
        legacy.response_status > 0 ? legacy.response_status : (opts?.successStatus ?? 200)
      )
    }
  }

  // Probe immutable effect evidence BEFORE the domain/service layer runs.
  // Business validation (daily totals, backfill windows) can legitimately fail
  // on a retry even though the mutation already committed; the lost-response
  // retry would otherwise be reported as a failure. A committed effect with the
  // same canonical fingerprint is the proof — replay it without re-executing.
  const effect = await readIdempotencyEffectRow(key, actorId, operation)
  if (effect) {
    if (effect.effect_fingerprint) {
      const incoming = await computeEffectFingerprintViaAdmin(
        operation,
        canonicalEffectPayload(operation, fingerprintPayload, actorId)
      )
      if (incoming !== effect.effect_fingerprint) {
        return busyResponse('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with different payload.')
      }
    }
    const denied = await reauthorizeOrDeny(opts, { responseStatus: effect.response_status })
    if (denied) return denied
    return stampedSuccessResponse(
      effect.response_status > 0 ? effect.response_status : (opts?.successStatus ?? 200)
    )
  }

  try {
    const response = await runWithIdempotencyScope({ key, operation }, execute)
    if (response.ok) {
      // The AFTER trigger committed the effect in the same transaction.
      return response
    }
    if (response.status === 404) {
      // Deleted-resource replay: the target row is gone but the immutable
      // effect proves the mutation already committed (e.g. a later delete of
      // the row, or a retry of a delete after the target vanished).
      const effect = await readIdempotencyEffectRow(key, actorId, operation)
      if (effect) {
        // A committed effect only replays the SAME canonical request (DB-2).
        if (effect.effect_fingerprint) {
          const incoming = await computeEffectFingerprintViaAdmin(
            operation,
            canonicalEffectPayload(operation, fingerprintPayload, actorId)
          )
          if (incoming !== effect.effect_fingerprint) {
            return busyResponse('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with different payload.')
          }
        }
        const denied = await reauthorizeOrDeny(opts, { responseStatus: effect.response_status })
        if (denied) return denied
        return stampedSuccessResponse(
          effect.response_status > 0 ? effect.response_status : (opts?.successStatus ?? 200)
        )
      }
    }
    return response
  } catch (err) {
    if (err instanceof DuplicateDeliveryError) {
      const denied = await reauthorizeOrDeny(opts, null)
      if (denied) return denied
      return stampedSuccessResponse(opts?.successStatus ?? 200)
    }
    if (err instanceof IdempotencyConflictError) {
      return busyResponse('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with different payload.')
    }
    if (err instanceof UnrecoverableDeliveryError) {
      return commitUnknownResponse()
    }
    throw err
  }
}
