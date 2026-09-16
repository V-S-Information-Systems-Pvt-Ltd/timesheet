import 'server-only'

import type {
  BackupExportResult,
  BackupPayload,
  BackupRestoreResult,
} from '@/app/types'
import { sanitizeWorkDone } from '@/lib/validation'
import { getPool, query } from '../pool'
import { isAdminActor } from '@/lib/roles'
import type {
  Actor,
  DbWrite,
  ImportResult,
  RateLimitReleaseInput,
  RateLimitReserveInput,
  RateLimitReserveResult,
  TimesheetInput,
} from '../repository'
import type {
  OperationsAuditEntry,
  OperationsPersistence,
} from '@/lib/domain/operations-port'

function friendlyWriteError(err: unknown): string {
  const e = err as { code?: string; constraint?: string } | null
  if (e?.code === '23505') {
    if (e.constraint?.includes('leaves')) {
      return 'One or more of those leave dates is already marked.'
    }
    return 'A record with that value already exists.'
  }
  if (e?.code === '23503') {
    return 'This record is referenced by other data and cannot be changed.'
  }
  return 'Something went wrong. Please try again.'
}

async function write(sql: string, params?: unknown[]): Promise<DbWrite> {
  try {
    await query(sql, params)
    return { error: null }
  } catch (err) {
    return { error: friendlyWriteError(err) }
  }
}

async function writeMany(statements: string[]): Promise<DbWrite> {
  try {
    for (const sql of statements) {
      await query(sql)
    }
    return { error: null }
  } catch (err) {
    return { error: friendlyWriteError(err) }
  }
}

export interface NativeOperationsPersistence extends OperationsPersistence {
  reserveRateLimit(input: RateLimitReserveInput): Promise<RateLimitReserveResult>
  releaseRateLimit(input: RateLimitReleaseInput): Promise<void>
  cleanupRateLimits(before: Date): Promise<number>
}

export const nativeOperationsPersistence: NativeOperationsPersistence = {
  // --- backup & restore (admin) ---

  async exportBackup(actor: Actor): Promise<BackupExportResult> {
    if (!isAdminActor(actor)) {
      return { payload: null, error: 'You do not have permission to perform this action.' }
    }
    const [projects, types, users, timesheets, leaves, reminders, globals] = await Promise.all([
      query<{ id: string; name: string; so_number: string | null; telegram_no: number | null }>(
        'select id, name, so_number, telegram_no from public.projects order by name'
      ),
      query<{ id: string; name: string; is_active: boolean; telegram_no: number | null }>(
        'select id, name, is_active, telegram_no from public.activity_types order by name'
      ),
      query<{ id: string; email: string }>('select id, lower(email) as email from public.profiles'),
      query<{ user_id: string; project_id: string; activity_type_id: string | null; log_date: string; hours_worked: number; work_done: string }>(
        'select user_id, project_id, activity_type_id, log_date, hours_worked, work_done from public.timesheets order by log_date'
      ),
      query<{ user_id: string; leave_date: string; reason: string }>(
        'select user_id, leave_date, reason from public.leaves order by leave_date'
      ),
      query<{ user_id: string; message: string; remind_at: string; done: boolean }>(
        'select user_id, message, remind_at, done from public.reminders order by remind_at'
      ),
      query<{ message: string; remind_at: string }>(
        'select message, remind_at from public.global_reminders order by remind_at'
      ),
    ])
    const emailById = new Map(users.map(u => [u.id, u.email]))
    const projectNameById = new Map(projects.map(p => [p.id, p.name]))
    const typeNameById = new Map(types.map(t => [t.id, t.name]))

    return {
      payload: {
        version: 1,
        exportedAt: new Date().toISOString(),
        projects: projects.map(p => ({ name: p.name, so_number: p.so_number, telegram_no: p.telegram_no })),
        activityTypes: types.map(t => ({ name: t.name, is_active: t.is_active, telegram_no: t.telegram_no })),
        timesheets: timesheets.map(t => ({
          email: emailById.get(t.user_id) ?? '',
          log_date: t.log_date,
          project: projectNameById.get(t.project_id) ?? '',
          activity_type: t.activity_type_id ? (typeNameById.get(t.activity_type_id) ?? null) : null,
          hours_worked: Number(t.hours_worked),
          work_done: t.work_done,
        })),
        leaves: leaves.map(l => ({ email: emailById.get(l.user_id) ?? '', leave_date: l.leave_date, reason: l.reason })),
        reminders: reminders.map(r => ({
          email: emailById.get(r.user_id) ?? '',
          message: r.message,
          remind_at: r.remind_at,
          done: r.done,
        })),
        globalReminders: globals.map(g => ({ message: g.message, remind_at: g.remind_at })),
      },
      error: null,
    }
  },

  async restoreBackup(actor: Actor, payload: BackupPayload): Promise<BackupRestoreResult> {
    const empty: BackupRestoreResult = {
      created: { projects: 0, activityTypes: 0, timesheets: 0, leaves: 0, reminders: 0, globalReminders: 0 },
      skipped: 0,
      error: null,
    }
    if (!isAdminActor(actor)) {
      return { ...empty, error: 'You do not have permission to perform this action.' }
    }

    const client = await getPool().connect()
    try {
      await client.query('begin')
      await client.query('lock table public.projects, public.activity_types, public.timesheets, public.leaves, public.reminders, public.global_reminders in exclusive mode')

      const created = { ...empty.created }
      let skipped = 0

      // Projects: create missing by name.
      const projectIdByName = new Map<string, string>()
      const existingProjects = await client.query<{ id: string; name: string }>('select id, name from public.projects')
      for (const r of existingProjects.rows) projectIdByName.set(r.name, r.id)
      for (const p of payload.projects) {
        if (projectIdByName.has(p.name)) continue
        const ins = await client.query<{ id: string }>(
          `insert into public.projects (name, so_number, telegram_no) values ($1, $2, $3) returning id`,
          [p.name, p.so_number, p.telegram_no]
        )
        projectIdByName.set(p.name, ins.rows[0].id)
        created.projects++
      }

      // Activity types: create missing by name.
      const typeIdByName = new Map<string, string>()
      const existingTypes = await client.query<{ id: string; name: string }>('select id, name from public.activity_types')
      for (const r of existingTypes.rows) typeIdByName.set(r.name, r.id)
      for (const t of payload.activityTypes) {
        if (typeIdByName.has(t.name)) continue
        const ins = await client.query<{ id: string }>(
          `insert into public.activity_types (name, is_active, telegram_no) values ($1, $2, $3) returning id`,
          [t.name, t.is_active, t.telegram_no]
        )
        typeIdByName.set(t.name, ins.rows[0].id)
        created.activityTypes++
      }

      // Users: match by email; unknown emails are skipped.
      const userByEmail = new Map<string, string>()
      const existingUsers = await client.query<{ id: string; email: string }>(
        'select id, lower(email) as email from public.profiles'
      )
      for (const r of existingUsers.rows) userByEmail.set(r.email, r.id)

      // Timesheets: skip exact duplicates; enforce the 24h daily cap.
      const relevantUserIds = Array.from(
        new Set(
          payload.timesheets
            .map((t) => userByEmail.get(t.email.toLowerCase()))
            .filter((id): id is string => Boolean(id))
        )
      )
      const relevantDates = Array.from(new Set(payload.timesheets.map((t) => t.log_date)))

      const existingEntries =
        relevantUserIds.length > 0 && relevantDates.length > 0
          ? await client.query<{
              user_id: string
              log_date: string
              project_id: string
              activity_type_id: string | null
              hours_worked: number
            }>(
              'select user_id, log_date, project_id, activity_type_id, hours_worked from public.timesheets where user_id = any($1::uuid[]) and log_date = any($2::date[])',
              [relevantUserIds, relevantDates]
            )
          : { rows: [] }

      const existingKeys = new Set<string>()
      const totals = new Map<string, number>()
      for (const r of existingEntries.rows) {
        existingKeys.add(`${r.user_id}|${r.log_date}|${r.project_id}|${r.activity_type_id ?? ''}|${Number(r.hours_worked)}`)
        const k = `${r.user_id}|${r.log_date}`
        totals.set(k, (totals.get(k) ?? 0) + Number(r.hours_worked))
      }

      const timesheetsToInsert: Array<[string, string, string | null, string, number, string]> = []
      for (const t of payload.timesheets) {
        const userId = userByEmail.get(t.email.toLowerCase())
        const projectId = projectIdByName.get(t.project)
        if (!userId || !projectId) { skipped++; continue }
        const typeId = t.activity_type ? (typeIdByName.get(t.activity_type) ?? null) : null
        const key = `${userId}|${t.log_date}|${projectId}|${typeId ?? ''}|${t.hours_worked}`
        if (existingKeys.has(key)) { skipped++; continue }
        const k = `${userId}|${t.log_date}`
        const current = totals.get(k) ?? 0
        if (current + t.hours_worked > 24) { skipped++; continue }
        timesheetsToInsert.push([
          userId,
          projectId,
          typeId,
          t.log_date,
          t.hours_worked,
          sanitizeWorkDone(t.work_done) || 'restored entry',
        ])
        totals.set(k, current + t.hours_worked)
        existingKeys.add(key)
      }

      // Batch insert timesheets in chunks of 50
      const BATCH_SIZE = 50
      for (let i = 0; i < timesheetsToInsert.length; i += BATCH_SIZE) {
        const batch = timesheetsToInsert.slice(i, i + BATCH_SIZE)
        const valueTuples: string[] = []
        const params: unknown[] = []
        batch.forEach((row, rowIdx) => {
          const offset = rowIdx * 6
          valueTuples.push(`($${offset + 1}::uuid, $${offset + 2}::uuid, $${offset + 3}::uuid, $${offset + 4}::date, $${offset + 5}::numeric, $${offset + 6})`)
          params.push(...row)
        })
        await client.query(
          `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
           values ${valueTuples.join(', ')}`,
          params
        )
        created.timesheets += batch.length
      }

      // Leaves: unique (user_id, leave_date) — skip duplicates via ON CONFLICT.
      const leavesToInsert: Array<[string, string, string]> = []
      for (const l of payload.leaves) {
        const userId = userByEmail.get(l.email.toLowerCase())
        if (!userId) { skipped++; continue }
        leavesToInsert.push([userId, l.leave_date, l.reason])
      }
      for (let i = 0; i < leavesToInsert.length; i += BATCH_SIZE) {
        const batch = leavesToInsert.slice(i, i + BATCH_SIZE)
        const valueTuples: string[] = []
        const params: unknown[] = []
        batch.forEach((row, rowIdx) => {
          const offset = rowIdx * 3
          valueTuples.push(`($${offset + 1}::uuid, $${offset + 2}::date, $${offset + 3})`)
          params.push(...row)
        })
        const res = await client.query(
          `insert into public.leaves (user_id, leave_date, reason) values ${valueTuples.join(', ')} on conflict (user_id, leave_date) do nothing`,
          params
        )
        const inserted = res.rowCount ?? 0
        created.leaves += inserted
        skipped += batch.length - inserted
      }

      // Reminders: deduplicate against existing (user_id, message, remind_at)
      const relevantReminderUserIds = Array.from(
        new Set(
          payload.reminders
            .map((r) => userByEmail.get(r.email.toLowerCase()))
            .filter((id): id is string => Boolean(id))
        )
      )
      const existingReminders =
        relevantReminderUserIds.length > 0
          ? await client.query<{ user_id: string; message: string; remind_at: string }>(
              'select user_id, message, remind_at::text from public.reminders where user_id = any($1::uuid[])',
              [relevantReminderUserIds]
            )
          : { rows: [] }
      const existingReminderKeys = new Set(
        existingReminders.rows.map((r) => {
          const t = new Date(r.remind_at).getTime()
          return `${r.user_id}|${r.message}|${Number.isNaN(t) ? r.remind_at : t}`
        })
      )

      const remindersToInsert: Array<[string, string, string, boolean]> = []
      for (const r of payload.reminders) {
        const userId = userByEmail.get(r.email.toLowerCase())
        if (!userId) { skipped++; continue }
        const t = new Date(r.remind_at).getTime()
        const key = `${userId}|${r.message}|${Number.isNaN(t) ? r.remind_at : t}`
        if (existingReminderKeys.has(key)) { skipped++; continue }
        existingReminderKeys.add(key)
        remindersToInsert.push([userId, r.message, r.remind_at, Boolean(r.done)])
      }
      for (let i = 0; i < remindersToInsert.length; i += BATCH_SIZE) {
        const batch = remindersToInsert.slice(i, i + BATCH_SIZE)
        const valueTuples: string[] = []
        const params: unknown[] = []
        batch.forEach((row, rowIdx) => {
          const offset = rowIdx * 4
          valueTuples.push(`($${offset + 1}::uuid, $${offset + 2}, $${offset + 3}::timestamptz, $${offset + 4}::boolean)`)
          params.push(...row)
        })
        await client.query(
          `insert into public.reminders (user_id, message, remind_at, done) values ${valueTuples.join(', ')}`,
          params
        )
        created.reminders += batch.length
      }

      // Global reminders: deduplicate against existing (message, remind_at)
      const relevantGlobalMessages = Array.from(new Set(payload.globalReminders.map((g) => g.message)))
      const existingGlobals =
        relevantGlobalMessages.length > 0
          ? await client.query<{ message: string; remind_at: string }>(
              'select message, remind_at::text from public.global_reminders where message = any($1::text[])',
              [relevantGlobalMessages]
            )
          : { rows: [] }
      const existingGlobalKeys = new Set(
        existingGlobals.rows.map((g) => {
          const t = new Date(g.remind_at).getTime()
          return `${g.message}|${Number.isNaN(t) ? g.remind_at : t}`
        })
      )

      const globalsToInsert: Array<[string, string]> = []
      for (const g of payload.globalReminders) {
        const t = new Date(g.remind_at).getTime()
        const key = `${g.message}|${Number.isNaN(t) ? g.remind_at : t}`
        if (existingGlobalKeys.has(key)) { skipped++; continue }
        existingGlobalKeys.add(key)
        globalsToInsert.push([g.message, g.remind_at])
      }
      for (let i = 0; i < globalsToInsert.length; i += BATCH_SIZE) {
        const batch = globalsToInsert.slice(i, i + BATCH_SIZE)
        const valueTuples: string[] = []
        const params: unknown[] = []
        batch.forEach((row, rowIdx) => {
          const offset = rowIdx * 2
          valueTuples.push(`($${offset + 1}, $${offset + 2}::timestamptz)`)
          params.push(...row)
        })
        await client.query(
          `insert into public.global_reminders (message, remind_at) values ${valueTuples.join(', ')}`,
          params
        )
        created.globalReminders += batch.length
      }

      await client.query('commit')
      return { created, skipped, error: null }
    } catch (err) {
      await client.query('rollback')
      return { ...empty, error: friendlyWriteError(err) }
    } finally {
      client.release()
    }
  },

  async importTimesheets(actor: Actor, rows: TimesheetInput[]): Promise<ImportResult> {
    if (!isAdminActor(actor)) {
      return { imported: 0, skipped: rows.length, error: 'You do not have permission to perform this action.' }
    }
    if (rows.length === 0) return { imported: 0, skipped: 0, error: null }

    const values: string[] = []
    const params: unknown[] = []
    rows.forEach(row => {
      params.push(row.userId, row.projectId, row.activityTypeId, row.logDate, row.hoursWorked, sanitizeWorkDone(row.workDone))
      const i = params.length
      values.push(`($${i - 5}, $${i - 4}, $${i - 3}, $${i - 2}, $${i - 1}, $${i})`)
    })
    try {
      const result = await getPool().query(
        `insert into public.timesheets (user_id, project_id, activity_type_id, log_date, hours_worked, work_done)
         values ${values.join(', ')}`,
        params
      )
      const imported = result.rowCount ?? 0
      return { imported, skipped: rows.length - imported, error: null }
    } catch (err) {
      return { imported: 0, skipped: rows.length, error: friendlyWriteError(err) }
    }
  },

  async deleteUserTimesheets(actor: Actor, userId: string): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write('delete from public.timesheets where user_id = $1', [userId])
  },

  async resetTimesheets(actor: Actor): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write('delete from public.timesheets')
  },

  async resetActivityData(actor: Actor): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const result = await writeMany([
      'delete from public.timesheets',
      'delete from public.leaves',
      'delete from public.reminders',
      'delete from public.global_reminder_dismissals',
    ])
    if (result.error) return result
    return writeMany([
      `insert into public.activity_types (name) values
         ('R&D'), ('Meeting'), ('Certification'), ('Presales support'), ('Documentation')
       on conflict (name) do nothing`,
    ])
  },

  async resetAllData(actor: Actor): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const result = await writeMany([
      'delete from public.timesheets',
      'delete from public.leaves',
      'delete from public.reminders',
      'delete from public.global_reminder_dismissals',
      'delete from public.global_reminders',
      'delete from public.activity_types',
      'delete from public.projects',
    ])
    if (result.error) return result
    // Keep the acting profile so the session survives the reset.
    const keep = await write('delete from public.profiles where id <> $1', [actor.id])
    if (keep.error) return keep
    return writeMany([
      "insert into public.projects (name, telegram_no) values ('Internal', 1000)",
      `insert into public.activity_types (name) values
         ('R&D'), ('Meeting'), ('Certification'), ('Presales support'), ('Documentation')
       on conflict (name) do nothing`,
    ])
  },

  async writeAuditLog(actor: Actor, entry: OperationsAuditEntry): Promise<DbWrite> {
    return write(
      `insert into public.audit_logs (actor_id, actor_email, action, target_id, detail)
       values ($1, $2, $3, $4, $5)`,
      [actor.id, actor.email, entry.action, entry.targetId ?? null, entry.detail ? JSON.stringify(entry.detail) : null]
    )
  },

  // --- rate limiting ---

  async reserveRateLimit(input: RateLimitReserveInput): Promise<RateLimitReserveResult> {
    const rows = await query<{ count: number }>(
      `insert into public.rate_limits (bucket, subject_hash, window_start, reset_at, count)
       values ($1, $2, $3, $4, 1)
       on conflict (bucket, subject_hash, window_start) do update
         set count = public.rate_limits.count + 1
       where public.rate_limits.count < $5
       returning count`,
      [input.bucket, input.subjectHash, input.windowStart, input.resetAt, input.limit]
    )

    if (rows.length === 0) {
      return { reserved: false, count: input.limit }
    }
    return { reserved: true, count: Number(rows[0].count) }
  },

  async releaseRateLimit(input: RateLimitReleaseInput): Promise<void> {
    await query(
      `update public.rate_limits
          set count = greatest(count - 1, 0)
        where bucket = $1 and subject_hash = $2 and window_start = $3`,
      [input.bucket, input.subjectHash, input.windowStart]
    )
  },

  async cleanupRateLimits(before: Date): Promise<number> {
    const rows = await query<{ id: number }>(
      `with removed as (
         delete from public.rate_limits where reset_at <= $1 returning 1 as id
       )
       select count(*)::int as id from removed`,
      [before]
    )
    return Number(rows[0]?.id ?? 0)
  },
}
