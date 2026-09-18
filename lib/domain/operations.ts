import 'server-only'

import type { Actor, ImportResult, TimesheetInput } from '@/lib/db/repository'
import type { BackupCreatedCounts, BackupPayload } from '@/app/types'
import type { Backend } from '@/lib/backend/config'
import { isAdminActor, isSuperAdminActor } from '@/lib/roles'
import { logger, redactLogMeta, extractError } from '@/lib/logger'
import { parseBackup } from '@/lib/backup'
import type {
  MaintenancePersistence,
  OperationsAuditEntry,
  OperationsPersistence,
} from './operations-port'

/**
 * Explicit dependencies for the operations application module: a narrow
 * backup/restore persistence port, a scheduled-maintenance port, an explicit
 * clock and the active backend name (for bounded, non-secret log metadata).
 * Transports compose these at the server entry boundary; the module never
 * resolves a global repository, cookies or headers.
 */
export interface OperationsDomainDeps {
  persistence: OperationsPersistence
  maintenance: MaintenancePersistence
  clock: () => Date
  backend: Backend
}

export type OperationsErrorCode = 'FORBIDDEN' | 'VALIDATION_ERROR' | 'STORAGE_ERROR'

export interface OperationsDomainError {
  code: OperationsErrorCode
  message: string
}

export type OperationsResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: OperationsDomainError }

/** Empty created-count shape. Restore failures must report this, never counts. */
const EMPTY_CREATED: BackupCreatedCounts = {
  projects: 0,
  activityTypes: 0,
  timesheets: 0,
  leaves: 0,
  reminders: 0,
  globalReminders: 0,
}

/** Idempotency retention: OFFLINE_REPLAY_MAX_AGE_DAYS (90) + 7-day grace. */
export const MAINTENANCE_IDEMPOTENCY_RETENTION_DAYS = 97

function forbidden(message: string, code: OperationsErrorCode = 'FORBIDDEN'): OperationsDomainError {
  return { code, message }
}

/**
 * Defense-in-depth admin guard. The transports already gate with
 * `requireActor(['admin'])`/`isAdminActor`; the module must not proceed for a
 * direct caller holding a non-admin Actor either.
 */
function requireAdmin(actor: Actor): OperationsDomainError | null {
  if (!actor.isActive) return forbidden('Your account is not active.')
  if (!isAdminActor(actor)) {
    return forbidden('You do not have permission to perform this action.')
  }
  return null
}

/**
 * Defense-in-depth super-admin guard for destructive resets. A reset can never
 * be reached with an ordinary admin (or ordinary user) Actor.
 */
function requireSuperAdmin(actor: Actor): OperationsDomainError | null {
  if (!actor.isActive) return forbidden('Your account is not active.')
  if (!isSuperAdminActor(actor)) {
    return forbidden('Super-admin access required.')
  }
  return null
}

/**
 * Bounded, redacted structured log entry: operation name, backend and result,
 * plus at most a few small counts. Never the payload, tokens, or user-supplied
 * bodies. `redactLogMeta` is applied even though the logger also redacts.
 */
function logOperation(
  deps: OperationsDomainDeps,
  operation: string,
  result: 'success' | 'failure',
  extra: Record<string, unknown> = {}
): void {
  const meta = redactLogMeta({ operation, backend: deps.backend, result, ...extra })
  if (result === 'success') logger.info(`${operation} completed`, meta)
  else logger.warn(`${operation} failed`, meta)
}

export interface AuditOutcome {
  auditRecorded: boolean
  /** Present only when the audit write failed; the operation itself may still have committed. */
  auditError?: string
}

/**
 * Record an audit entry through the persistence port. Audit delivery is outside
 * the operation transaction: a failure is logged (redacted) and reported, never
 * allowed to fail or roll back the committed operation.
 */
export async function recordAudit(
  actor: Actor,
  entry: OperationsAuditEntry,
  deps: OperationsDomainDeps,
  failureLogMessage = 'audit log write failed'
): Promise<AuditOutcome> {
  try {
    const result = await deps.persistence.writeAuditLog(actor, entry)
    if (result?.error) {
      logger.error(
        failureLogMessage,
        redactLogMeta({ operation: 'audit.write', backend: deps.backend, action: entry.action, error: result.error })
      )
      return { auditRecorded: false, auditError: result.error }
    }
    return { auditRecorded: true }
  } catch (err) {
    const message = extractError(err)
    logger.error(
      failureLogMessage,
      redactLogMeta({ operation: 'audit.write', backend: deps.backend, action: entry.action, error: message })
    )
    return { auditRecorded: false, auditError: message }
  }
}

export interface BackupExportOutcome {
  payload: BackupPayload | null
  error: string | null
}

/**
 * Export a backup payload. The provider returns a structured error (never
 * throws) for authorization/read failure; that error is surfaced unchanged.
 */
export async function exportBackupData(
  actor: Actor,
  deps: OperationsDomainDeps
): Promise<OperationsResult<BackupExportOutcome>> {
  const denied = requireAdmin(actor)
  if (denied) return { ok: false, error: denied }

  const result = await deps.persistence.exportBackup(actor)
  logOperation(deps, 'backup.export', result.error ? 'failure' : 'success', {
    hasPayload: result.payload !== null,
    projects: result.payload?.projects.length ?? 0,
    timesheets: result.payload?.timesheets.length ?? 0,
    ...(result.error ? { error: result.error } : {}),
  })
  return { ok: true, data: { payload: result.payload, error: result.error } }
}

export interface BackupRestoreOutcome {
  created: BackupCreatedCounts
  skipped: number
  auditRecorded: boolean
  auditError?: string
}

/**
 * Parse, validate and atomically restore a backup document.
 *
 * Atomicity: the whole restore is delegated to `persistence.restoreBackup`
 * exactly once — the native transaction / Supabase `restore_backup_tx` RPC is
 * the indivisible unit. Nothing here writes rows directly, so a validation or
 * mid-write failure leaves no partial imported state and reports zeroed counts
 * rather than fabricated ones.
 */
export async function restoreBackupFromJson(
  actor: Actor,
  json: string,
  deps: OperationsDomainDeps
): Promise<OperationsResult<BackupRestoreOutcome>> {
  const denied = requireAdmin(actor)
  if (denied) return { ok: false, error: denied }

  if (typeof json !== 'string' || json.trim().length === 0) {
    return { ok: false, error: forbidden('No backup file selected.', 'VALIDATION_ERROR') }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return {
      ok: false,
      error: forbidden('Invalid backup file (not valid JSON).', 'VALIDATION_ERROR'),
    }
  }

  const check = parseBackup(parsed)
  if (!check.ok || !check.payload) {
    return {
      ok: false,
      error: forbidden(check.error ?? 'Invalid backup file.', 'VALIDATION_ERROR'),
    }
  }

  const result = await deps.persistence.restoreBackup(actor, check.payload)
  if (result.error) {
    // Provider rolled back; report the provider error and NEVER its partial
    // counts. `EMPTY_CREATED` is the only count shape returned on failure.
    logOperation(deps, 'backup.restore', 'failure', { error: result.error, created: EMPTY_CREATED })
    return { ok: false, error: forbidden(result.error, 'STORAGE_ERROR') }
  }

  const audit = await recordAudit(
    actor,
    { action: 'backup.restore', detail: { created: result.created, skipped: result.skipped } },
    deps,
    'restore audit log write failed'
  )
  logOperation(deps, 'backup.restore', 'success', {
    created: result.created,
    skipped: result.skipped,
    auditRecorded: audit.auditRecorded,
  })
  return {
    ok: true,
    data: {
      created: result.created,
      skipped: result.skipped,
      auditRecorded: audit.auditRecorded,
      auditError: audit.auditError,
    },
  }
}

/**
 * Import pre-validated timesheet rows and audit the outcome. Row resolution and
 * the 24h cap stay in the transport (they need reference/people lookups); this
 * owns the provider write and the audit side effect.
 */
export async function importTimesheetRows(
  actor: Actor,
  rows: TimesheetInput[],
  deps: OperationsDomainDeps,
  audit?: { skipped?: number }
): Promise<OperationsResult<ImportResult>> {
  const denied = requireAdmin(actor)
  if (denied) return { ok: false, error: denied }

  const result = await deps.persistence.importTimesheets(actor, rows)
  if (!result.error) {
    await recordAudit(
      actor,
      {
        action: 'timesheets.import',
        // The transport reports rows it dropped during validation/cap checks;
        // fall back to the provider count when it does not supply one.
        detail: { imported: result.imported, skipped: audit?.skipped ?? result.skipped },
      },
      deps
    )
  }
  logOperation(deps, 'timesheets.import', result.error ? 'failure' : 'success', {
    imported: result.imported,
    skipped: result.skipped,
    ...(result.error ? { error: result.error } : {}),
  })
  return { ok: true, data: result }
}

/** Admin: delete all timesheet entries belonging to a user (deactivation flow). */
export async function deleteUserTimesheetsData(
  actor: Actor,
  userId: string,
  deps: OperationsDomainDeps
): Promise<OperationsResult<null>> {
  const denied = requireAdmin(actor)
  if (denied) return { ok: false, error: denied }

  const result = await deps.persistence.deleteUserTimesheets(actor, userId)
  if (result.error) {
    return { ok: false, error: forbidden(result.error, 'STORAGE_ERROR') }
  }
  logOperation(deps, 'timesheets.delete-user', 'success')
  return { ok: true, data: null }
}

export type ResetMode = 'timesheets' | 'activity' | 'all'

/**
 * Super-admin destructive reset. `mode` is validated before dispatch so an
 * unknown mode never reaches a provider call.
 */
export async function resetOperationalData(
  actor: Actor,
  mode: string,
  deps: OperationsDomainDeps
): Promise<OperationsResult<null>> {
  const denied = requireSuperAdmin(actor)
  if (denied) return { ok: false, error: denied }

  let result: { error: string | null }
  let validMode: ResetMode
  if (mode === 'timesheets') {
    validMode = 'timesheets'
    result = await deps.persistence.resetTimesheets(actor)
  } else if (mode === 'activity') {
    validMode = 'activity'
    result = await deps.persistence.resetActivityData(actor)
  } else if (mode === 'all') {
    validMode = 'all'
    result = await deps.persistence.resetAllData(actor)
  } else {
    return { ok: false, error: forbidden('Invalid reset mode.', 'VALIDATION_ERROR') }
  }

  if (result.error) {
    logOperation(deps, 'database.reset', 'failure', { mode: validMode, error: result.error })
    return { ok: false, error: forbidden(result.error, 'STORAGE_ERROR') }
  }

  await recordAudit(actor, { action: 'database.reset', detail: { mode: validMode } }, deps)
  logOperation(deps, 'database.reset', 'success', { mode: validMode })
  return { ok: true, data: null }
}

/**
 * Scheduled maintenance authorization marker. Callers hold it only after the
 * cron secret gate; it is deliberately NOT an `Actor`, so an ordinary-user
 * credential can never construct a valid call.
 */
export interface MaintenanceAuthorization {
  readonly kind: 'scheduled'
}

export interface MaintenanceOutcome {
  cleanedSessions: number
  cleanedRateLimits: number
  cleanedIdempotencyKeys: number
}

/**
 * Run the scheduled cleanup: expire mobile sessions, prune rate-limit windows
 * and prune idempotency keys/effects. Session cleanup is fatal (matches the
 * previous route); rate-limit and idempotency cleanup are best-effort so one
 * failure does not abort the others.
 */
export async function runScheduledMaintenance(
  authorization: MaintenanceAuthorization,
  deps: OperationsDomainDeps
): Promise<OperationsResult<MaintenanceOutcome>> {
  if (!authorization || authorization.kind !== 'scheduled') {
    return { ok: false, error: forbidden('Scheduled maintenance is not authorized.') }
  }

  const cleanedSessions = await deps.maintenance.cleanupExpiredSessions()

  let cleanedRateLimits = 0
  try {
    cleanedRateLimits = await deps.maintenance.cleanupRateLimits(deps.clock())
  } catch (err) {
    logger.error(
      'Rate-limit cleanup failed during scheduled run',
      redactLogMeta({
        operation: 'maintenance.cleanup.rate-limits',
        backend: deps.backend,
        result: 'failure',
        error: extractError(err),
      })
    )
  }

  let cleanedIdempotencyKeys = 0
  try {
    cleanedIdempotencyKeys = await deps.maintenance.cleanupIdempotencyKeys(
      MAINTENANCE_IDEMPOTENCY_RETENTION_DAYS
    )
  } catch (err) {
    logger.error(
      'Idempotency keys cleanup failed during scheduled run',
      redactLogMeta({
        operation: 'maintenance.cleanup.idempotency',
        backend: deps.backend,
        result: 'failure',
        error: extractError(err),
      })
    )
  }

  const data: MaintenanceOutcome = { cleanedSessions, cleanedRateLimits, cleanedIdempotencyKeys }
  logOperation(deps, 'maintenance.cleanup', 'success', { ...data })
  return { ok: true, data }
}
