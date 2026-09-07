// lib/idempotency.ts
import 'server-only'
import { createHash } from 'node:crypto'
import { query, transaction } from '@/lib/db/pool'
import { IS_NATIVE } from '@/lib/backend/config'
import { getAdminClient } from '@/lib/supabase/admin'
import { logger, extractError } from '@/lib/logger'

export interface StoredIdempotencyRecord {
  status: number
  payload: unknown
}

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

    // In flight by concurrent request — unless the claim is stale (e.g. a
    // crash between a committed mutation and the ledger commit), in which
    // case atomically reclaim it so the key is not poisoned until retention
    // cleanup. The conditional update is the linearization point: exactly one
    // contender wins.
    // Rows marked committed_unknown = true are strictly excluded from takeover.
    const taken = await query<{ key: string }>(
      `update public.idempotency_keys
       set payload_fingerprint = $1, claimed_at = now()
       where key = $2 and actor_id = $3 and operation = $4
         and response_status = 0
         and committed_unknown = false
         and claimed_at < $5::timestamptz
       returning key`,
      [fingerprint, key, actorId, operation, staleClaimCutoffIso()]
    )
    if (taken.length > 0) {
      return { state: 'claimed' }
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

    // In flight — in Supabase mode, PostgREST mutations and the idempotency ledger
    // do not share a single DB transaction. If a claim is stuck at response_status = 0
    // past the stale cutoff (5 minutes), the preceding mutation may have already
    // committed before an unrecorded crash. Reclaiming it would duplicate committed writes.
    // Instead, stale claims transition to committed_unknown to prevent re-execution and
    // direct the caller to manual review.
    const isStale = Boolean(data.claimed_at && data.claimed_at < staleClaimCutoffIso())
    if (isStale) {
      const { error: markErr } = await admin
        .from('idempotency_keys')
        .update({ committed_unknown: true })
        .eq('key', key)
        .eq('actor_id', actorId)
        .eq('operation', operation)
        .eq('response_status', 0)
      if (markErr) {
        throw new Error(`Failed to mark stale idempotency key as committed_unknown: ${markErr.message}`)
      }
      return { state: 'committed_unknown' }
    }

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
       set response_status = $1, response_payload = $2
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
  // grace. Change both together if product extends offline life.
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
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
    return parseInt(res[0]?.count || '0', 10)
  } else {
    const admin = getAdminClient() as unknown as {
      from: (table: string) => {
        delete: (opts?: { count?: string }) => {
          lt: (col: string, val: string) => Promise<{ count: number | null; error: { message?: string } | null }>
        }
      }
    }
    const { count, error } = await admin
      .from('idempotency_keys')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff.toISOString())

    if (error) {
      logger.error('Failed to cleanup idempotency keys', { error: error.message })
      return 0
    }
    return count ?? 0
  }
}

export async function withIdempotency(
  request: Request,
  actorId: string,
  operation: string,
  fingerprintPayload: unknown,
  execute: () => Promise<Response>
): Promise<Response> {
  const idempotencyKey = request.headers.get('idempotency-key') || request.headers.get('x-idempotency-key')
  if (!idempotencyKey) {
    return execute()
  }

  const fingerprint = computePayloadFingerprint(fingerprintPayload)

  if (IS_NATIVE) {
    return await transaction(async () => {
      const claim = await claimIdempotencyKey(idempotencyKey, actorId, operation, fingerprint)
      if (claim.state === 'replay') {
        return Response.json(claim.record.payload, { status: claim.record.status })
      }
      if (claim.state === 'committed_unknown') {
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
      if (claim.state === 'in_flight') {
        return Response.json(
          { data: null, error: { code: 'IDEMPOTENCY_IN_FLIGHT', message: 'A request with this idempotency key is already in progress. Retry with the same key.' } },
          { status: 409 }
        )
      }
      if (claim.state === 'conflict') {
        return Response.json(
          { data: null, error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key reused with different payload.' } },
          { status: 409 }
        )
      }

      const response = await execute()
      if (response.ok) {
        let body: unknown = {}
        try {
          body = await response.clone().json()
        } catch {
          body = {}
        }
        await commitIdempotencyKey(idempotencyKey, actorId, operation, response.status, body)
      } else {
        await releaseIdempotencyKey(idempotencyKey, actorId, operation)
      }
      return response
    })
  }

  const claim = await claimIdempotencyKey(idempotencyKey, actorId, operation, fingerprint)
  if (claim.state === 'replay') {
    return Response.json(claim.record.payload, { status: claim.record.status })
  }
  if (claim.state === 'committed_unknown') {
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
  if (claim.state === 'in_flight') {
    return Response.json(
      { data: null, error: { code: 'IDEMPOTENCY_IN_FLIGHT', message: 'A request with this idempotency key is already in progress. Retry with the same key.' } },
      { status: 409 }
    )
  }
  if (claim.state === 'conflict') {
    return Response.json(
      { data: null, error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key reused with different payload.' } },
      { status: 409 }
    )
  }

  let mutationCommitted = false
  try {
    const response = await execute()
    if (response.ok) {
      mutationCommitted = true
      let body: unknown = {}
      try {
        body = await response.clone().json()
      } catch {
        body = {}
      }

      // Bounded retry of ledger commit (3 attempts with short backoff)
      let commitSuccess = false
      let lastCommitErr: unknown = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await commitIdempotencyKey(idempotencyKey, actorId, operation, response.status, body)
          commitSuccess = true
          break
        } catch (commitErr) {
          lastCommitErr = commitErr
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 50))
          }
        }
      }

      if (!commitSuccess) {
        // The business write already committed, but persisting the ledger result
        // failed after retries. We mark the row committed_unknown = true so
        // stale-claim recovery will never re-execute it, and return 409 IDEMPOTENCY_COMMIT_UNKNOWN.
        logger.error('Failed to commit idempotency key after successful mutation', {
          error: extractError(lastCommitErr),
          idempotencyKey,
        })
        try {
          await markIdempotencyCommittedUnknown(idempotencyKey, actorId, operation)
        } catch (markErr) {
          logger.error('Failed to mark idempotency key as committed_unknown', {
            error: extractError(markErr),
            idempotencyKey,
          })
        }
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
    } else {
      await releaseIdempotencyKey(idempotencyKey, actorId, operation)
    }
    return response
  } catch (err) {
    if (!mutationCommitted) {
      await releaseIdempotencyKey(idempotencyKey, actorId, operation)
    }
    throw err
  }
}
