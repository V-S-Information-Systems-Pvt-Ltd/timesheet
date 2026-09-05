// lib/idempotency.ts
import 'server-only'
import { createHash } from 'node:crypto'
import { query } from '@/lib/db/pool'
import { IS_NATIVE } from '@/lib/backend/config'
import { getAdminClient } from '@/lib/supabase/admin'

export interface StoredIdempotencyRecord {
  status: number
  payload: unknown
}

export function computePayloadFingerprint(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex')
}

export async function getIdempotentResponse(
  key: string,
  actorId: string,
  operation: string,
  fingerprint: string
): Promise<{ match: true; record: StoredIdempotencyRecord } | { match: false; conflict?: boolean }> {
  if (IS_NATIVE) {
    try {
      const rows = await query<{
        payload_fingerprint: string
        response_status: number
        response_payload: unknown
      }>(
        `select payload_fingerprint, response_status, response_payload
           from public.idempotency_keys
          where key = $1 and actor_id = $2 and operation = $3`,
        [key, actorId, operation]
      )
      if (rows.length === 0) return { match: false }
      const row = rows[0]
      if (row.payload_fingerprint !== fingerprint) {
        return { match: false, conflict: true }
      }
      return {
        match: true,
        record: { status: row.response_status, payload: row.response_payload },
      }
    } catch {
      return { match: false }
    }
  } else {
    try {
      const admin = getAdminClient()
      const { data, error } = await admin
        .from('idempotency_keys')
        .select('payload_fingerprint, response_status, response_payload')
        .eq('key', key)
        .eq('actor_id', actorId)
        .eq('operation', operation)
        .maybeSingle()

      if (error || !data) return { match: false }
      const record = data as { payload_fingerprint: string; response_status: number; response_payload: unknown }
      if (record.payload_fingerprint !== fingerprint) {
        return { match: false, conflict: true }
      }
      return {
        match: true,
        record: { status: record.response_status, payload: record.response_payload },
      }
    } catch {
      return { match: false }
    }
  }
}

export async function saveIdempotentResponse(
  key: string,
  actorId: string,
  operation: string,
  fingerprint: string,
  status: number,
  payload: unknown
): Promise<void> {
  if (IS_NATIVE) {
    try {
      await query(
        `insert into public.idempotency_keys
           (key, actor_id, operation, payload_fingerprint, response_status, response_payload)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (key, actor_id, operation) do nothing`,
        [key, actorId, operation, fingerprint, status, JSON.stringify(payload)]
      )
    } catch {
      // best-effort persistence
    }
  } else {
    try {
      const admin = getAdminClient()
      await admin.from('idempotency_keys').insert({
        key,
        actor_id: actorId,
        operation,
        payload_fingerprint: fingerprint,
        response_status: status,
        response_payload: payload,
      })
    } catch {
      // best-effort persistence
    }
  }
}
