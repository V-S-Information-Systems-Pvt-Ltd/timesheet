// lib/backup.ts
// Pure helpers for the admin Backup & Restore feature. A backup is a JSON
// payload of work data only (no auth/user accounts): projects, activity
// types, timesheets, leaves, reminders, global reminders and app settings.
// Users are referenced by email and matched to existing accounts on restore.

import type {
  BackupActivityType,
  BackupGlobalReminder,
  BackupLeave,
  BackupPayload,
  BackupProject,
  BackupReminder,
  BackupTimesheet,
} from '@/app/types'
import { isValidISODate } from '@/lib/validation'

export interface BackupValidationResult {
  ok: boolean
  payload?: BackupPayload
  error?: string
}

const MAX_TIMESHEETS = 5000
const MAX_ROWS = 20000

/** Calendar date string (YYYY-MM-DD), rejecting rolled-over dates. */
function isDate(value: unknown): value is string {
  return isValidISODate(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numOrNull(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null
}

/**
 * Validate + normalize a parsed backup JSON document. Returns a typed payload
 * or a user-facing error explaining what is wrong.
 */
export function parseBackup(input: unknown): BackupValidationResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'Invalid backup file.' }
  }
  const doc = input as Record<string, unknown>

  if (doc.version !== 1) return { ok: false, error: 'Unsupported backup version.' }
  if (!Array.isArray(doc.projects) || !Array.isArray(doc.activityTypes) ||
      !Array.isArray(doc.timesheets) || !Array.isArray(doc.leaves) ||
      !Array.isArray(doc.reminders) || !Array.isArray(doc.globalReminders)) {
    return { ok: false, error: 'Backup file is missing one or more required sections.' }
  }
  if (doc.timesheets.length > MAX_TIMESHEETS || doc.timesheets.length + doc.leaves.length + doc.reminders.length > MAX_ROWS) {
    return { ok: false, error: 'Backup file is too large to restore.' }
  }

  const projects: BackupProject[] = []
  const seenProjects = new Set<string>()
  for (const row of doc.projects as unknown[]) {
    const r = row as Record<string, unknown>
    const name = str(r?.name)
    if (!name) return { ok: false, error: 'A project in the backup is missing its name.' }
    if (seenProjects.has(name)) continue // dedupe by name
    seenProjects.add(name)
    projects.push({ name, so_number: str(r?.so_number), telegram_no: numOrNull(r?.telegram_no) })
  }

  const activityTypes: BackupActivityType[] = []
  const seenTypes = new Set<string>()
  for (const row of doc.activityTypes as unknown[]) {
    const r = row as Record<string, unknown>
    const name = str(r?.name)
    if (!name) return { ok: false, error: 'An activity type in the backup is missing its name.' }
    if (seenTypes.has(name)) continue
    seenTypes.add(name)
    activityTypes.push({
      name,
      is_active: typeof r?.is_active === 'boolean' ? r.is_active : true,
      telegram_no: numOrNull(r?.telegram_no),
    })
  }

  const timesheets: BackupTimesheet[] = []
  const seenEntries = new Set<string>()
  for (const row of doc.timesheets as unknown[]) {
    const r = row as Record<string, unknown>
    const email = cleanString(r?.email).toLowerCase()
    const project = str(r?.project)
    const hours = r?.hours_worked
    const date = str(r?.log_date)
    if (!email || !project || !date || !isDate(date)) {
      return { ok: false, error: 'A timesheet row is missing email, project, or a valid date.' }
    }
    if (!isFiniteNumber(hours) || hours <= 0 || hours > 24) {
      return { ok: false, error: `Invalid hours "${String(r?.hours_worked)}" on row for ${email} (${date}).` }
    }
    // Skip exact duplicate rows (same user/date/project/type/hours).
    const activityType = str(r?.activity_type)
    const key = `${email}|${date}|${project}|${activityType ?? ''}|${hours}`
    if (seenEntries.has(key)) continue
    seenEntries.add(key)
    timesheets.push({
      email,
      log_date: date,
      project,
      activity_type: activityType,
      hours_worked: hours,
      work_done: cleanString(r?.work_done),
    })
  }

  const leaves: BackupLeave[] = []
  const seenLeaves = new Set<string>()
  for (const row of doc.leaves as unknown[]) {
    const r = row as Record<string, unknown>
    const email = cleanString(r?.email).toLowerCase()
    const date = str(r?.leave_date)
    if (!email || !date || !isDate(date)) return { ok: false, error: 'A leave row is missing email or a valid date.' }
    const key = `${email}|${date}`
    if (seenLeaves.has(key)) continue
    seenLeaves.add(key)
    leaves.push({ email, leave_date: date, reason: cleanString(r?.reason) })
  }

  const reminders: BackupReminder[] = []
  for (const row of doc.reminders as unknown[]) {
    const r = row as Record<string, unknown>
    const email = cleanString(r?.email).toLowerCase()
    const message = str(r?.message)
    const remindAt = str(r?.remind_at)
    if (!email || !message || !remindAt) return { ok: false, error: 'A reminder row is missing email, message, or time.' }
    reminders.push({
      email,
      message,
      remind_at: remindAt,
      done: typeof r?.done === 'boolean' ? r.done : false,
    })
  }

  const globalReminders: BackupGlobalReminder[] = []
  for (const row of doc.globalReminders as unknown[]) {
    const r = row as Record<string, unknown>
    const message = str(r?.message)
    const remindAt = str(r?.remind_at)
    if (!message || !remindAt) return { ok: false, error: 'A global reminder is missing its message or time.' }
    globalReminders.push({ message, remind_at: remindAt })
  }

  return {
    ok: true,
    payload: {
      version: 1,
      exportedAt: cleanString(doc.exportedAt) || new Date().toISOString(),
      projects,
      activityTypes,
      timesheets,
      leaves,
      reminders,
      globalReminders,
    },
  }
}
