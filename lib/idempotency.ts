// lib/idempotency.ts
import 'server-only'
import { query } from '@/lib/db/pool'
import { logger, extractError } from '@/lib/logger'
import { runWithIdempotencyScope } from '@/lib/idempotency-key'
import { timesheetFormatResponse } from '@/lib/timesheet-format'
import { cleanupExpiredFreshKeys } from '@/lib/idempotency-fresh-key'
import { computePayloadFingerprint } from '@/lib/idempotency/fingerprint'
import {
  preparePortableRetry,
  type PortableLocalState,
} from '@/lib/idempotency/portable-retry'

export { computePayloadFingerprint } from '@/lib/idempotency/fingerprint'
export {
  applyPortableTranslation,
  decidePortablePayload,
} from '@/lib/idempotency/portable-retry'

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
}

export async function commitIdempotencyKey(
  key: string,
  actorId: string,
  operation: string,
  status: number,
  payload: unknown
): Promise<void> {
  await query(
    `update public.idempotency_keys
     set response_status = $1, response_payload = $2, committed_unknown = false
     where key = $3 and actor_id = $4 and operation = $5`,
    [status, JSON.stringify(payload), key, actorId, operation]
  )
}

export async function markIdempotencyCommittedUnknown(
  key: string,
  actorId: string,
  operation: string
): Promise<void> {
  await query(
    `update public.idempotency_keys
     set committed_unknown = true
     where key = $1 and actor_id = $2 and operation = $3`,
    [key, actorId, operation]
  )
}

export async function releaseIdempotencyKey(
  key: string,
  actorId: string,
  operation: string
): Promise<void> {
  try {
    await query(
      `delete from public.idempotency_keys
       where key = $1 and actor_id = $2 and operation = $3 and response_status = 0 and committed_unknown = false`,
      [key, actorId, operation]
    )
  } catch {
    // non-blocking cleanup
  }
}

export async function cleanupIdempotencyKeys(retentionDays = 97): Promise<number> {
  // Retention = OFFLINE_REPLAY_MAX_AGE_DAYS (90, mobile sync-engine) + 7-day
  // grace. Change the queue, ledger, and effect retention together if
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

async function computePortableEffectFingerprint(operation: string, payload: unknown): Promise<string> {
  const rows = await query<{ fingerprint: string }>(
    'select public.idempotency_effect_fingerprint($1, $2::jsonb) as fingerprint',
    [operation, JSON.stringify(payload)]
  )
  const fingerprint = rows[0]?.fingerprint
  if (!fingerprint) throw new Error('Portable idempotency fingerprint returned no value.')
  return fingerprint
}

async function localPortableState(
  key: string,
  actorId: string,
  operation: string,
  payload: unknown
): Promise<PortableLocalState> {
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

async function reauthorizeOrDeny(
  opts: IdempotencyOptions | undefined,
  stored: { status: number; payload: unknown } | { responseStatus: number } | null
): Promise<Response | null> {
  if (!opts?.reauthorize) return null
  return opts.reauthorize(stored)
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

export async function withIdempotency(
  request: Request,
  actorId: string,
  operation: string,
  fingerprintPayload: unknown,
  executeMutation: () => Promise<Response>,
  opts?: IdempotencyOptions
): Promise<Response> {
  // Replay resolution remains outside this fresh-write gate (including portable
  // retry history). An old client's already-committed retry must
  // still return success, never an update-required response that loses work.
  const execute = async () => {
    if (operation === 'create_timesheet' || operation === 'update_timesheet' ||
        operation === 'duplicate_timesheet' || operation === 'batch_duplicate_timesheets') {
      const incompatible = timesheetFormatResponse(request)
      if (incompatible) return incompatible
    }
    return executeMutation()
  }
  const idempotencyKey = request.headers.get('idempotency-key') || request.headers.get('x-idempotency-key')
  if (!idempotencyKey) {
    return execute()
  }

  const portable = await preparePortableRetry(
    idempotencyKey,
    actorId,
    operation,
    fingerprintPayload,
    {
      localState: localPortableState,
      computeEffectFingerprint: computePortableEffectFingerprint,
      reauthorize: (stored) => reauthorizeOrDeny(opts, stored),
    }
  )
  if (portable) return portable

  const fingerprint = computePayloadFingerprint(fingerprintPayload)

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
