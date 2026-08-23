// lib/db/restore-shared.ts
// Pure backend-agnostic preparation for backup restore operations.
// Resolves existing entity mappings, filters duplicates, computes daily hour limits,
// and produces validated candidate rows for database insertion.

import type {
  BackupPayload,
  BackupProject,
  BackupActivityType,
} from '@/app/types'

export interface EntityLookupContext {
  projects: Array<{ id: string; name: string }>
  activityTypes: Array<{ id: string; name: string }>
  users: Array<{ id: string; email: string }>
  dailyTotals: Array<{ userId: string; logDate: string; hours: number }>
}

export interface PreparedTimesheet {
  userId: string
  projectId: string
  activityTypeId: string | null
  logDate: string
  hoursWorked: number
  workDone: string
}

export interface PreparedLeave {
  userId: string
  leaveDate: string
  reason: string
}

export interface PreparedReminder {
  userId: string
  message: string
  remindAt: string
  done: boolean
}

export interface PreparedGlobalReminder {
  message: string
  remindAt: string
}

export interface PreparedRestore {
  newProjects: BackupProject[]
  newActivityTypes: BackupActivityType[]
  candidateTimesheets: PreparedTimesheet[]
  candidateLeaves: PreparedLeave[]
  candidateReminders: PreparedReminder[]
  candidateGlobalReminders: PreparedGlobalReminder[]
  skippedCount: number
}

/**
 * Transforms a validated BackupPayload into prepared candidate rows ready for backend insertion.
 */
export function prepareRestore(
  payload: BackupPayload,
  context: EntityLookupContext
): PreparedRestore {
  const existingProjectNames = new Set(context.projects.map((p) => p.name.toLowerCase()))
  const existingTypeNames = new Set(context.activityTypes.map((t) => t.name.toLowerCase()))
  const userByEmail = new Map(context.users.map((u) => [u.email.toLowerCase(), u.id]))

  // 1. Projects: only insert ones that do not exist yet
  const newProjects: BackupProject[] = []
  for (const p of payload.projects) {
    if (!existingProjectNames.has(p.name.toLowerCase())) {
      newProjects.push(p)
      existingProjectNames.add(p.name.toLowerCase())
    }
  }

  // 2. Activity Types: only insert ones that do not exist yet
  const newActivityTypes: BackupActivityType[] = []
  for (const t of payload.activityTypes) {
    if (!existingTypeNames.has(t.name.toLowerCase())) {
      newActivityTypes.push(t)
      existingTypeNames.add(t.name.toLowerCase())
    }
  }

  // Project and Type ID maps (updated dynamically as callers create new ones or map existing)
  const projectNameToId = new Map(context.projects.map((p) => [p.name.toLowerCase(), p.id]))
  const typeNameToId = new Map(context.activityTypes.map((t) => [t.name.toLowerCase(), t.id]))

  // 3. Timesheets: enforce 24h daily limits and resolve FKs
  const dailyHoursMap = new Map(
    context.dailyTotals.map((t) => [`${t.userId}|${t.logDate}`, t.hours])
  )
  const candidateTimesheets: PreparedTimesheet[] = []
  let skippedCount = 0

  for (const t of payload.timesheets) {
    const userId = userByEmail.get(t.email.toLowerCase())
    if (!userId) {
      skippedCount++
      continue
    }

    const projectId = projectNameToId.get(t.project.toLowerCase())
    // Note: if the project is being created in this restore, caller provides updated map
    const activityTypeId = t.activity_type
      ? typeNameToId.get(t.activity_type.toLowerCase()) ?? null
      : null

    const key = `${userId}|${t.log_date}`
    const currentTotal = dailyHoursMap.get(key) ?? 0
    if (currentTotal + t.hours_worked > 24) {
      skippedCount++
      continue
    }

    dailyHoursMap.set(key, currentTotal + t.hours_worked)
    candidateTimesheets.push({
      userId,
      projectId: projectId ?? '', // Caller resolves new project IDs if pending
      activityTypeId,
      logDate: t.log_date,
      hoursWorked: t.hours_worked,
      workDone: t.work_done,
    })
  }

  // 4. Leaves: skip rows where user does not exist
  const candidateLeaves: PreparedLeave[] = []
  for (const l of payload.leaves) {
    const userId = userByEmail.get(l.email.toLowerCase())
    if (!userId) {
      skippedCount++
      continue
    }
    candidateLeaves.push({
      userId,
      leaveDate: l.leave_date,
      reason: l.reason,
    })
  }

  // 5. Reminders: skip rows where user does not exist
  const candidateReminders: PreparedReminder[] = []
  for (const r of payload.reminders) {
    const userId = userByEmail.get(r.email.toLowerCase())
    if (!userId) {
      skippedCount++
      continue
    }
    candidateReminders.push({
      userId,
      message: r.message,
      remindAt: r.remind_at,
      done: r.done,
    })
  }

  // 6. Global Reminders
  const candidateGlobalReminders: PreparedGlobalReminder[] = payload.globalReminders.map((g) => ({
    message: g.message,
    remindAt: g.remind_at,
  }))

  return {
    newProjects,
    newActivityTypes,
    candidateTimesheets,
    candidateLeaves,
    candidateReminders,
    candidateGlobalReminders,
    skippedCount,
  }
}
