import 'server-only'

import type { GlobalReminder, LeaveEntry, Reminder } from '@/app/types'
import type { Actor, LeafRowInput } from '@/lib/db/repository'
import { parseSchema, leaveQuerySchema, leaveRowsSchema, reminderSchema } from '@/lib/validation-schemas'
import type { LeaveListQuery, LeaveReminderPersistence } from './leave-reminders-port'
import { runWithWriteBudget, type WriteBudget } from './write-budget'

export type LeaveReminderErrorCode =
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'STORAGE_ERROR'
  | 'RATE_LIMITED'

export interface LeaveReminderDomainError {
  code: LeaveReminderErrorCode
  message: string
  details?: {
    fieldErrors?: Record<string, string[]>
    [key: string]: unknown
  }
}

export type LeaveReminderResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: LeaveReminderDomainError }

/**
 * Explicit dependencies for the leave/reminders application module: narrow
 * persistence and the write budget. Transports compose these at the server
 * entry boundary; the module never resolves a global repository, cookies or
 * headers.
 */
export interface LeaveReminderDeps {
  persistence: LeaveReminderPersistence
  writeBudget: WriteBudget
}

/**
 * Charge exactly one write-budget slot for an operation, releasing it when the
 * operation is not chargeable. Returns the operation result, or a
 * `RATE_LIMITED` domain error the transports map to their own envelope. This
 * mirrors the timesheet module so a keyed delivery that replays from the
 * idempotency ledger never reaches this path and never double-charges.
 */
async function chargeOnce<T>(
  deps: LeaveReminderDeps,
  actorId: string,
  isChargeable: (result: LeaveReminderResult<T>) => boolean,
  run: () => Promise<LeaveReminderResult<T>>
): Promise<LeaveReminderResult<T>> {
  const outcome = await runWithWriteBudget(deps.writeBudget, actorId, run, isChargeable)
  if (!outcome.ok) {
    return { ok: false, error: { code: 'RATE_LIMITED', message: outcome.error } }
  }
  return outcome.result
}

/**
 * Defense-in-depth active-account guard. Transport boundaries already reject
 * inactive actors, but the domain must not proceed for a direct caller holding
 * an inactive Actor either.
 */
function inactiveActorError(actor: Actor): LeaveReminderDomainError | null {
  if (!actor.isActive) {
    return { code: 'FORBIDDEN', message: 'Your account is not active.' }
  }
  return null
}

function validationError(error: {
  error: string
  fieldErrors?: Record<string, string[]>
}): LeaveReminderDomainError {
  return {
    code: 'VALIDATION_ERROR',
    message: error.error,
    details: { fieldErrors: error.fieldErrors },
  }
}

function storageError(message: string): LeaveReminderDomainError {
  return { code: 'STORAGE_ERROR', message }
}

// --- leaves -------------------------------------------------------------------

/**
 * List leave markers visible to the actor. Admin-supplied `userId`/date filters
 * are validated here; the adapter applies the role/ownership scope.
 */
export async function listLeaves(
  actor: Actor,
  rawQuery: Record<string, unknown>,
  deps: LeaveReminderDeps
): Promise<LeaveReminderResult<LeaveEntry[]>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  const parsed = parseSchema(leaveQuerySchema, rawQuery)
  if (!parsed.ok) return { ok: false, error: validationError(parsed.error) }

  const opts: LeaveListQuery = parsed.data
  const data = await deps.persistence.listLeaves(actor, opts)
  return { ok: true, data }
}

/**
 * Create one or more leave markers. Validates row shape/dates/count and the
 * 366-row cap, then charges one write-budget slot for the whole batch.
 */
export async function createLeaves(
  actor: Actor,
  rows: unknown,
  deps: LeaveReminderDeps
): Promise<LeaveReminderResult<{ success: true }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  return chargeOnce(
    deps,
    actor.id,
    (result) => result.ok,
    async () => {
      const parsed = parseSchema(leaveRowsSchema, rows)
      if (!parsed.ok) return { ok: false, error: validationError(parsed.error) }

      const result = await deps.persistence.createLeaves(actor, parsed.data as LeafRowInput[])
      if (result.error) return { ok: false, error: storageError(result.error) }
      return { ok: true, data: { success: true as const } }
    }
  )
}

/** Delete a single leave marker (own row for non-admins). */
export async function deleteLeave(
  actor: Actor,
  id: string,
  deps: LeaveReminderDeps
): Promise<LeaveReminderResult<{ success: true }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  return chargeOnce(
    deps,
    actor.id,
    (result) => result.ok,
    async () => {
      const result = await deps.persistence.deleteLeave(actor, id)
      if (result.error) return { ok: false, error: storageError(result.error) }
      return { ok: true, data: { success: true as const } }
    }
  )
}

// --- reminders ----------------------------------------------------------------

/** List the actor's own reminders (own-only regardless of any caller userId). */
export async function listReminders(
  actor: Actor,
  deps: LeaveReminderDeps
): Promise<LeaveReminderResult<Reminder[]>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  const data = await deps.persistence.listReminders(actor, actor.id)
  return { ok: true, data }
}

/**
 * Create a personal reminder. The reminder always belongs to the acting user;
 * `remindAt` is validated and normalized to ISO before persisting. Charges one
 * write-budget slot.
 */
export async function createReminder(
  actor: Actor,
  raw: { message?: unknown; remindAt?: unknown },
  deps: LeaveReminderDeps
): Promise<LeaveReminderResult<{ success: true }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  return chargeOnce(
    deps,
    actor.id,
    (result) => result.ok,
    async () => {
      const parsed = parseSchema(reminderSchema, {
        message: raw?.message,
        remindAt: raw?.remindAt,
      })
      if (!parsed.ok) return { ok: false, error: validationError(parsed.error) }

      const result = await deps.persistence.createReminder(actor, {
        userId: actor.id,
        message: parsed.data.message,
        remindAt: new Date(parsed.data.remindAt).toISOString(),
      })
      if (result.error) return { ok: false, error: storageError(result.error) }
      return { ok: true, data: { success: true as const } }
    }
  )
}

/**
 * Toggle a reminder's done state. The `done` flag is coerced through Boolean so
 * the state transition is identical on every transport. Charges one
 * write-budget slot.
 */
export async function updateReminder(
  actor: Actor,
  id: string,
  raw: { done?: unknown },
  deps: LeaveReminderDeps
): Promise<LeaveReminderResult<{ success: true }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  return chargeOnce(
    deps,
    actor.id,
    (result) => result.ok,
    async () => {
      const result = await deps.persistence.updateReminder(actor, id, { done: Boolean(raw?.done) })
      if (result.error) return { ok: false, error: storageError(result.error) }
      return { ok: true, data: { success: true as const } }
    }
  )
}

/** Delete a personal reminder. Charges one write-budget slot. */
export async function deleteReminder(
  actor: Actor,
  id: string,
  deps: LeaveReminderDeps
): Promise<LeaveReminderResult<{ success: true }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  return chargeOnce(
    deps,
    actor.id,
    (result) => result.ok,
    async () => {
      const result = await deps.persistence.deleteReminder(actor, id)
      if (result.error) return { ok: false, error: storageError(result.error) }
      return { ok: true, data: { success: true as const } }
    }
  )
}

// --- global reminders ---------------------------------------------------------

/**
 * Admin: list all global reminders. The transport gates the admin role and the
 * adapter re-checks it, so visibility matches the released behavior.
 */
export async function listGlobalReminders(
  actor: Actor,
  deps: LeaveReminderDeps
): Promise<LeaveReminderResult<GlobalReminder[]>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  const data = await deps.persistence.listGlobalReminders(actor)
  return { ok: true, data }
}

/** User: due global reminders that the actor has not dismissed. */
export async function listDueGlobalReminders(
  actor: Actor,
  deps: LeaveReminderDeps
): Promise<LeaveReminderResult<GlobalReminder[]>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  const data = await deps.persistence.listDueGlobalReminders(actor)
  return { ok: true, data }
}

/**
 * Admin: broadcast a global reminder. Validates the message/time and normalizes
 * `remindAt` to ISO. Returns the created row (or null when the adapter reported
 * success without a row) so the transport can preserve its response contract.
 */
export async function createGlobalReminder(
  actor: Actor,
  raw: { message?: unknown; remindAt?: unknown },
  deps: LeaveReminderDeps
): Promise<LeaveReminderResult<GlobalReminder | null>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  const parsed = parseSchema(reminderSchema, {
    message: raw?.message,
    remindAt: raw?.remindAt,
  })
  if (!parsed.ok) return { ok: false, error: validationError(parsed.error) }

  const result = await deps.persistence.createGlobalReminder(actor, {
    message: parsed.data.message,
    remindAt: new Date(parsed.data.remindAt).toISOString(),
  })
  if (result.error) return { ok: false, error: storageError(result.error) }
  return { ok: true, data: result.data ?? null }
}

/** Admin: update a global reminder's message and/or time. */
export async function updateGlobalReminder(
  actor: Actor,
  id: string,
  raw: { message?: unknown; remindAt?: unknown },
  deps: LeaveReminderDeps
): Promise<LeaveReminderResult<{ success: true }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  const parsed = parseSchema(reminderSchema.partial(), raw)
  if (!parsed.ok) return { ok: false, error: validationError(parsed.error) }

  const remindAt = parsed.data.remindAt ? new Date(parsed.data.remindAt).toISOString() : undefined
  const result = await deps.persistence.updateGlobalReminder(actor, id, {
    message: parsed.data.message?.trim(),
    remindAt,
  })
  if (result.error) return { ok: false, error: storageError(result.error) }
  return { ok: true, data: { success: true as const } }
}

/** Admin: delete a global reminder. */
export async function deleteGlobalReminder(
  actor: Actor,
  id: string,
  deps: LeaveReminderDeps
): Promise<LeaveReminderResult<{ success: true }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  const result = await deps.persistence.deleteGlobalReminder(actor, id)
  if (result.error) return { ok: false, error: storageError(result.error) }
  return { ok: true, data: { success: true as const } }
}

/** Per-user dismissal of a global reminder. */
export async function dismissGlobalReminder(
  actor: Actor,
  reminderId: string,
  deps: LeaveReminderDeps
): Promise<LeaveReminderResult<{ success: true }>> {
  const inactive = inactiveActorError(actor)
  if (inactive) return { ok: false, error: inactive }

  const result = await deps.persistence.dismissGlobalReminder(actor, reminderId)
  if (result.error) return { ok: false, error: storageError(result.error) }
  return { ok: true, data: { success: true as const } }
}
