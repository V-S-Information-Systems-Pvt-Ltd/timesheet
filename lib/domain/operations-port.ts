import 'server-only'

import type { Actor, DbWrite, ImportResult, TimesheetInput } from '@/lib/db/repository'
import type {
  BackupExportResult,
  BackupPayload,
  BackupRestoreResult,
} from '@/app/types'

/** Audit entry the operations module records through the persistence port. */
export interface OperationsAuditEntry {
  action: string
  targetId?: string | null
  detail?: Record<string, unknown> | null
}

/**
 * Narrow persistence port owned by the operations application module. It exposes
 * only the backup/restore, import, reset and audit operations the operational
 * use cases need, so each backend can implement it without re-exposing the wide
 * compatibility `Repository`.
 *
 * Authorization, RLS, SQL scoping, transaction boundaries and provider error
 * mapping stay inside the implementation (native SQL or the Supabase admin
 * client). Row-to-DTO mapping stays in the transports.
 *
 * Restore deliberately stays as ONE method. The native adapter runs a single
 * transaction that locks the affected tables and the Supabase adapter calls the
 * `restore_backup_tx` RPC; both are indivisible provider operations. The
 * coordinator MUST call `restoreBackup` exactly once and MUST NOT decompose
 * restore into separately committed domain-service writes, or atomicity is lost.
 */
export interface OperationsPersistence {
  /** Export all work data as a backup payload (admin-gated by the caller too). */
  exportBackup(actor: Actor): Promise<BackupExportResult>
  /** Whole-backup restore — see the interface note: one indivisible provider op. */
  restoreBackup(actor: Actor, payload: BackupPayload): Promise<BackupRestoreResult>
  /** Insert pre-validated timesheet rows (import path). */
  importTimesheets(actor: Actor, rows: TimesheetInput[]): Promise<ImportResult>
  /** Delete all timesheet entries belonging to one user (admin lifecycle). */
  deleteUserTimesheets(actor: Actor, userId: string): Promise<DbWrite>
  /** Delete all timesheet entries (super-admin factory reset). */
  resetTimesheets(actor: Actor): Promise<DbWrite>
  /** Delete timesheets/leaves/reminders/dismissals and re-seed activity types. */
  resetActivityData(actor: Actor): Promise<DbWrite>
  /** Full factory reset (acting profile kept) and re-seed defaults. */
  resetAllData(actor: Actor): Promise<DbWrite>
  /** Append an immutable audit record. */
  writeAuditLog(actor: Actor, entry: OperationsAuditEntry): Promise<DbWrite>
}

/**
 * Scheduled maintenance port. The scheduled cleanup run is authenticated by the
 * cron secret at the transport boundary; the coordinator receives an explicit
 * maintenance authorization, never an ordinary-user `Actor`, so a user session
 * can never reach these operations.
 */
export interface MaintenancePersistence {
  /** Remove expired mobile sessions. Returns the number of sessions cleaned. */
  cleanupExpiredSessions(): Promise<number>
  /** Remove expired rate-limit windows at or before `before`. */
  cleanupRateLimits(before: Date): Promise<number>
  /** Remove idempotency keys/effects older than `retentionDays`. */
  cleanupIdempotencyKeys(retentionDays: number): Promise<number>
}

/** Explicit dependencies for the operations application module. */
export interface OperationsPorts {
  persistence: OperationsPersistence
  maintenance: MaintenancePersistence
}
