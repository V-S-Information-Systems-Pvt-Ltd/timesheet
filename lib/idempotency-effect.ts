// lib/idempotency-effect.ts
// Canonical request payload for the T19.2 effect fingerprint.
//
// The single source of truth for the hash is the SQL function
// `public.idempotency_effect_fingerprint(operation, payload)` (see
// supabase/migrations/20260920000000_idempotency_effects.sql). This module
// only maps a validated
// request/repository payload to the snake_case shape that the DB row will
// contain, so the repository preflight can ask Postgres to hash the incoming
// request and compare it with the row-derived hash stored in
// `idempotency_effects.effect_fingerprint`.
//
// Keeping the hash in SQL avoids a TS/SQL parity hazard: both the trigger and
// the preflight call the same function. A mapping mistake here fails closed
// (a false conflict), never a false success.

import { sanitizeWorkDone } from '@/lib/validation'

type PayloadBag = Record<string, unknown>

function bag(payload: unknown): PayloadBag {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as PayloadBag) : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  // Seconds precision to match the SQL to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS"Z"').
  return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Map a validated payload to the canonical snake_case effect shape for an
 * operation. Unknown/unsupported operations return the payload unchanged; the
 * SQL fingerprint function rejects unsupported operations, so callers fail
 * closed.
 */
export function canonicalEffectPayload(operation: string, payload: unknown, actorId: string): unknown {
  const p = bag(payload)

  switch (operation) {
    case 'create_timesheet':
      return {
        user_id: str(p.userId) ?? actorId,
        project_id: str(p.projectId),
        activity_type_id: str(p.activityTypeId),
        hours_worked: typeof p.hoursWorked === 'number' ? p.hoursWorked : Number(p.hoursWorked),
        work_done: sanitizeWorkDone(str(p.workDone) ?? ''),
        log_date: str(p.logDate),
      }
    case 'update_timesheet':
      return {
        id: str(p.id),
        project_id: str(p.projectId),
        activity_type_id: str(p.activityTypeId),
        hours_worked: typeof p.hoursWorked === 'number' ? p.hoursWorked : Number(p.hoursWorked),
        work_done: sanitizeWorkDone(str(p.workDone) ?? ''),
        log_date: str(p.logDate),
      }
    case 'delete_timesheet':
    case 'delete_leave':
    case 'delete_reminder':
      return { id: str(p.id) }
    case 'create_leave': {
      const rows = Array.isArray(p.rows) ? p.rows : Array.isArray(payload) ? payload : []
      return rows.map((row) => {
        const r = bag(row)
        return {
          user_id: str(r.userId),
          leave_date: str(r.leaveDate),
          // The persisted row stores '' for an absent reason (leaveRowsSchema
          // defaults reason to ''), so mirror that here. Mapping a missing
          // reason to null would fingerprint differently from the stored row
          // and reject a valid retry with a false IDEMPOTENCY_CONFLICT.
          reason: str(r.reason) ?? '',
        }
      })
    }
    case 'create_reminder': {
      const message = str(p.message)
      return {
        // The reminder service always persists the actor's own id; a stray
        // userId in the raw request body must not change the fingerprint.
        user_id: actorId,
        // reminderSchema trims the message before it is persisted, so the
        // stored row (and its fingerprint) holds the trimmed value. Trim here
        // too, otherwise a retry carrying the untrimmed body fingerprints
        // differently and is rejected as a false IDEMPOTENCY_CONFLICT.
        message: message === null ? null : message.trim(),
        remind_at: normalizeTimestamp(p.remindAt),
      }
    }
    case 'update_reminder':
      // The route passes { id, body: { done } }; the repository passes { done }.
      return { id: str(p.id), done: Boolean(p.done ?? bag(p.body).done) }
    default:
      return payload
  }
}
