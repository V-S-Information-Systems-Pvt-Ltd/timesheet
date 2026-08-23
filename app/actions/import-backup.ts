// app/actions/import-backup.ts
// Server Actions for CSV timesheet imports and database backup/restore.
'use server'

import { isValidISODate } from '@/lib/validation'
import { RATE_LIMIT_IMPORT, peekRateLimit, consumeRateLimit, dailyImportStore, getRetryAfter } from '@/lib/rate-limit'
import { parseBackup } from '@/lib/backup'
import { repo } from '@/lib/db'
import type { TimesheetInput } from '@/lib/db/repository'
import type { BackupCreatedCounts, BackupPayload } from '@/app/types'
import { type ActionResult, requireActor, safeAudit } from './_shared'

/** Admin: delete all timesheet entries belonging to a user (deactivate flow). */
export async function deleteUserTimesheets(userId: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await repo.deleteUserTimesheets(gate.actor, userId)
  return result.error ? { error: result.error } : {}
}

/** Raw CSV row shape for the import (client sends parsed rows). */
export interface CsvTimesheetRow {
  email: string
  logDate: string
  project: string
  activityType: string
  hours: string
  workDone: string
}

/** Admin: import timesheet rows; unknown references and bad rows are reported. */
export async function importTimesheets(
  rows: CsvTimesheetRow[]
): Promise<ActionResult & { imported?: number; skipped?: number; errors?: string[] }> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  const rate = peekRateLimit(dailyImportStore, `import:${actor.id}`, RATE_LIMIT_IMPORT)
  if (!rate.ok) {
    const retry = getRetryAfter(rate.resetAt)
    return { error: `Import rate limit exceeded. Try again in ${retry}s.` }
  }

  if (!Array.isArray(rows) || rows.length === 0) return { error: 'No rows to import.' }
  if (rows.length > 2000) return { error: 'Too many rows (max 2000).' }

  const [users, projects, types] = await Promise.all([
    repo.listProfiles(actor),
    repo.listProjects(actor),
    repo.listAllActivityTypes(actor),
  ])
  const userByEmail = new Map(users.map(u => [u.email.toLowerCase(), u]))
  const projectByName = new Map(projects.map(p => [p.name, p]))
  const typeByName = new Map(types.map(t => [t.name, t]))

  const out: TimesheetInput[] = []
  const errors: string[] = []
  rows.forEach((raw, i) => {
    const line = i + 2 // CSV line numbers start after the header row
    const r = (raw ?? {}) as CsvTimesheetRow
    const email = typeof r.email === 'string' ? r.email.trim().toLowerCase() : ''
    const user = userByEmail.get(email)
    if (!user) {
      errors.push(`Row ${line}: unknown email "${email || '(empty)'}"`)
      return
    }
    const projectName = typeof r.project === 'string' ? r.project.trim() : ''
    const project = projectByName.get(projectName)
    if (!project) {
      errors.push(`Row ${line}: unknown project "${projectName || '(empty)'}"`)
      return
    }
    let activityTypeId: string | null = null
    if (typeof r.activityType === 'string' && r.activityType.trim()) {
      const type = typeByName.get(r.activityType.trim())
      if (!type) {
        errors.push(`Row ${line}: unknown activity type "${r.activityType}"`)
        return
      }
      activityTypeId = type.id
    }
    const hours = Number(r.hours)
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      errors.push(`Row ${line}: invalid hours "${r.hours}"`)
      return
    }
    if (typeof r.logDate !== 'string' || !isValidISODate(r.logDate)) {
      errors.push(`Row ${line}: invalid date "${r.logDate}"`)
      return
    }
    const workDone = typeof r.workDone === 'string' ? r.workDone.trim() : ''
    if (!workDone) {
      errors.push(`Row ${line}: missing work description`)
      return
    }
    out.push({
      userId: user.id,
      projectId: project.id,
      activityTypeId,
      hoursWorked: hours,
      workDone,
      logDate: r.logDate,
    })
  })

  if (out.length === 0 && errors.length > 0) {
    return { error: 'Nothing to import.', errors }
  }

  // Enforce the 24h daily cap across existing and incoming rows: rows that
  // would push a user's day above 24 hours are skipped and reported.
  const totals = await repo.getTimesheetDailyTotals(actor)
  const byKey = new Map(totals.map(t => [`${t.userId}|${t.logDate}`, t.hours]))
  const running = new Map<string, number>()
  const finalRows: TimesheetInput[] = []
  for (const row of out) {
    const key = `${row.userId}|${row.logDate}`
    const current = (byKey.get(key) ?? 0) + (running.get(key) ?? 0)
    if (current + row.hoursWorked > 24) {
      errors.push(`${row.logDate}: daily total would exceed 24 hours (${row.hoursWorked}h).`)
      continue
    }
    running.set(key, current + row.hoursWorked)
    finalRows.push(row)
  }

  const result = await repo.importTimesheets(actor, finalRows)
  if (!result.error) {
    // Only charge the budget when the import actually wrote data.
    consumeRateLimit(dailyImportStore, `import:${actor.id}`, RATE_LIMIT_IMPORT)
    await safeAudit(actor, {
      action: 'timesheets.import',
      detail: { imported: result.imported, skipped: out.length - finalRows.length },
    })
  }
  return {
    error: result.error ?? undefined,
    imported: result.imported,
    skipped: out.length - finalRows.length,
    errors,
  }
}

const MAX_BACKUP_SIZE = 20 * 1024 * 1024 // 20 MB

/** Admin: export all work data as a backup payload (JSON). */
export async function exportBackup(): Promise<{ payload: BackupPayload | null; error?: string }> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { payload: null, error: gate.error }

  const result = await repo.exportBackup(gate.actor)
  return { payload: result.payload, error: result.error ?? undefined }
}

/** Admin: validate a backup JSON document and merge it into the database. */
export async function restoreBackup(
  json: string
): Promise<
  ActionResult & {
    created?: BackupCreatedCounts
    skipped?: number
  }
> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  if (typeof json !== 'string' || json.length === 0) return { error: 'No backup file selected.' }
  if (json.length > MAX_BACKUP_SIZE) return { error: 'Backup file is too large.' }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { error: 'Invalid backup file (not valid JSON).' }
  }
  const check = parseBackup(parsed)
  if (!check.ok || !check.payload) return { error: check.error ?? 'Invalid backup file.' }

  const result = await repo.restoreBackup(gate.actor, check.payload)
  if (!result.error) {
    await safeAudit(gate.actor, {
      action: 'backup.restore',
      detail: { created: result.created, skipped: result.skipped },
    })
  }
  return {
    error: result.error ?? undefined,
    created: result.created,
    skipped: result.skipped,
  }
}
