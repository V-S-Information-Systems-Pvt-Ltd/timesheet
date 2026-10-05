import 'server-only'

import type { CsvTimesheetRow } from '@vsis/contracts'
import { peoplePersistence } from '@/lib/db/people'
import { operationsDeps } from '@/lib/db/operations'
import { referencePersistence } from '@/lib/db/reference'
import { timesheetPersistence } from '@/lib/db/timesheets'
import type { Actor, TimesheetInput } from '@/lib/db/types'
import { importTimesheetRows } from '@/lib/domain/operations'
import { reserveRateLimit } from '@/lib/rate-limit'
import { isValidISODate } from '@/lib/validation'

export type TimesheetImportResult = {
  error?: string
  imported?: number
  skipped?: number
  errors?: string[]
}

/** Shared CSV-import coordinator. It owns validation, budgeting and reference resolution. */
export async function importTimesheetsForActor(
  actor: Actor,
  rows: CsvTimesheetRow[]
): Promise<TimesheetImportResult> {
  const rate = await reserveRateLimit('daily-import', `import:${actor.id}`)
  if (!rate.ok) {
    return { error: `Import rate limit exceeded. Try again in ${rate.retryAfter}s.` }
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    await rate.release()
    return { error: 'No rows to import.' }
  }
  if (rows.length > 2000) {
    await rate.release()
    return { error: 'Too many rows (max 2000).' }
  }

  try {
    const [users, projects, types] = await Promise.all([
      peoplePersistence.listProfiles(actor),
      referencePersistence.listProjects(actor),
      referencePersistence.listAllActivityTypes(actor),
    ])
    const userByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]))
    const projectByName = new Map(projects.map((project) => [project.name, project]))
    const typeByName = new Map(types.map((type) => [type.name, type]))

    const candidates: TimesheetInput[] = []
    const errors: string[] = []
    rows.forEach((raw, index) => {
      const line = index + 2
      const email = typeof raw?.email === 'string' ? raw.email.trim().toLowerCase() : ''
      const user = userByEmail.get(email)
      if (!user) {
        errors.push(`Row ${line}: unknown email "${email || '(empty)'}"`)
        return
      }
      const projectName = typeof raw.project === 'string' ? raw.project.trim() : ''
      const project = projectByName.get(projectName)
      if (!project) {
        errors.push(`Row ${line}: unknown project "${projectName || '(empty)'}"`)
        return
      }
      let activityTypeId: string | null = null
      if (typeof raw.activityType === 'string' && raw.activityType.trim()) {
        const type = typeByName.get(raw.activityType.trim())
        if (!type) {
          errors.push(`Row ${line}: unknown activity type "${raw.activityType}"`)
          return
        }
        activityTypeId = type.id
      }
      const hours = Number(raw.hours)
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
        errors.push(`Row ${line}: invalid hours "${raw.hours}"`)
        return
      }
      if (typeof raw.logDate !== 'string' || !isValidISODate(raw.logDate)) {
        errors.push(`Row ${line}: invalid date "${raw.logDate}"`)
        return
      }
      const workDone = typeof raw.workDone === 'string' ? raw.workDone.trim() : ''
      if (!workDone) {
        errors.push(`Row ${line}: missing work description`)
        return
      }
      candidates.push({
        userId: user.id,
        projectId: project.id,
        activityTypeId,
        hoursWorked: hours,
        workDone,
        logDate: raw.logDate,
      })
    })

    if (candidates.length === 0 && errors.length > 0) {
      await rate.release()
      return { error: 'Nothing to import.', errors }
    }

    const userDatePairs = Array.from(new Map(candidates.map((row) => [
      `${row.userId}:${row.logDate}`,
      { userId: row.userId, logDate: row.logDate },
    ])).values())
    const existingHours = await timesheetPersistence.sumHoursForUserDates(actor, userDatePairs)
    const running = new Map<string, number>()
    const finalRows: TimesheetInput[] = []
    for (const row of candidates) {
      const key = `${row.userId}:${row.logDate}`
      const existing = existingHours.get(key) ?? 0
      const incoming = running.get(key) ?? 0
      if (existing + incoming + row.hoursWorked > 24) {
        errors.push(`${row.logDate}: daily total would exceed 24 hours (${row.hoursWorked}h).`)
        continue
      }
      running.set(key, incoming + row.hoursWorked)
      finalRows.push(row)
    }

    const outcome = await importTimesheetRows(actor, finalRows, operationsDeps(), {
      skipped: candidates.length - finalRows.length,
    })
    if (!outcome.ok) {
      await rate.release()
      return { error: outcome.error.message, errors }
    }
    const result = outcome.data
    if (result.error) await rate.release()
    return {
      error: result.error ?? undefined,
      imported: result.imported,
      skipped: candidates.length - finalRows.length,
      errors,
    }
  } catch (error) {
    await rate.release()
    throw error
  }
}
