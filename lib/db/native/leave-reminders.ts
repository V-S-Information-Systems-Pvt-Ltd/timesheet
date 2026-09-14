import 'server-only'

import type { GlobalReminder, LeaveEntry, Reminder } from '@/app/types'
import { isAdminActor } from '@/lib/roles'
import { query } from '../pool'
import type { Actor, DbCreateResult, DbWrite, LeafRowInput } from '../repository'
import type { LeaveListQuery, LeaveReminderPersistence } from '@/lib/domain/leave-reminders-port'

interface LeaveRow {
  id: string
  user_id: string
  leave_date: string
  reason: string
  created_at: string
}

interface ReminderRow {
  id: string
  user_id: string
  message: string
  remind_at: string
  done: boolean
  created_at: string
}

interface GlobalReminderRow {
  id: string
  message: string
  remind_at: string
  created_at: string
}

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

async function writeReturning<T>(sql: string, params?: unknown[]): Promise<DbCreateResult<T>> {
  try {
    const rows = await query<T>(sql, params)
    const row = rows[0] ?? null
    if (!row) {
      return { data: null, error: 'Record could not be created.' }
    }
    return { data: row, error: null }
  } catch (err) {
    return { data: null, error: friendlyWriteError(err) }
  }
}

export const nativeLeaveReminderPersistence: LeaveReminderPersistence = {
  async listLeaves(actor: Actor, opts: LeaveListQuery = {}): Promise<LeaveEntry[]> {
    const conds: string[] = []
    const params: unknown[] = []

    if (isAdminActor(actor)) {
      if (opts.userId) {
        params.push(opts.userId)
        conds.push(`user_id = $${params.length}`)
      }
    } else {
      params.push(actor.id)
      conds.push(`user_id = $${params.length}`)
    }

    if (opts.from) {
      params.push(opts.from)
      conds.push(`leave_date >= $${params.length}`)
    }
    if (opts.to) {
      params.push(opts.to)
      conds.push(`leave_date <= $${params.length}`)
    }

    const where = conds.length ? `where ${conds.join(' and ')}` : ''
    const rows = await query<LeaveRow>(
      `select id, user_id, leave_date, reason, created_at from public.leaves ${where} order by leave_date asc limit 1000`,
      params
    )
    return rows as LeaveEntry[]
  },

  async createLeaves(actor: Actor, rows: LeafRowInput[]): Promise<DbWrite> {
    if (rows.length === 0) return { error: null }
    for (const row of rows) {
      if (!isAdminActor(actor) && row.userId !== actor.id) {
        return { error: 'You can only mark leave for yourself.' }
      }
    }
    const values: string[] = []
    const params: unknown[] = []
    rows.forEach((row) => {
      params.push(row.userId, row.leaveDate, row.reason)
      const i = params.length
      values.push(`($${i - 2}, $${i - 1}, $${i})`)
    })
    return write(
      `insert into public.leaves (user_id, leave_date, reason) values ${values.join(', ')}`,
      params
    )
  },

  async deleteLeave(actor: Actor, id: string): Promise<DbWrite> {
    if (isAdminActor(actor)) {
      return write('delete from public.leaves where id = $1', [id])
    }
    return write('delete from public.leaves where id = $1 and user_id = $2', [id, actor.id])
  },

  async listReminders(actor: Actor, _userId: string): Promise<Reminder[]> {
    const rows = await query<ReminderRow>(
      'select id, user_id, message, remind_at, done, created_at from public.reminders where user_id = $1 order by remind_at asc',
      [actor.id]
    )
    return rows as Reminder[]
  },

  async createReminder(
    actor: Actor,
    input: { userId: string; message: string; remindAt: string }
  ): Promise<DbWrite> {
    const userId = isAdminActor(actor) ? input.userId : actor.id
    return write(
      'insert into public.reminders (user_id, message, remind_at) values ($1, $2, $3)',
      [userId, input.message, input.remindAt]
    )
  },

  async updateReminder(actor: Actor, id: string, input: { done: boolean }): Promise<DbWrite> {
    return write(
      'update public.reminders set done = $1 where id = $2 and user_id = $3',
      [input.done, id, actor.id]
    )
  },

  async deleteReminder(actor: Actor, id: string): Promise<DbWrite> {
    return write('delete from public.reminders where id = $1 and user_id = $2', [id, actor.id])
  },

  async listGlobalReminders(actor: Actor): Promise<GlobalReminder[]> {
    if (!isAdminActor(actor)) return []
    const rows = await query<GlobalReminderRow>(
      'select id, message, remind_at, created_at from public.global_reminders order by remind_at asc'
    )
    return rows as GlobalReminder[]
  },

  async listDueGlobalReminders(actor: Actor): Promise<GlobalReminder[]> {
    const rows = await query<GlobalReminderRow>(
      `select gr.id, gr.message, gr.remind_at, gr.created_at
       from public.global_reminders gr
       where gr.remind_at <= now()
         and not exists (
           select 1 from public.global_reminder_dismissals d
           where d.reminder_id = gr.id and d.user_id = $1
         )
       order by gr.remind_at asc`,
      [actor.id]
    )
    return rows as GlobalReminder[]
  },

  async createGlobalReminder(
    actor: Actor,
    input: { message: string; remindAt: string }
  ): Promise<DbCreateResult<GlobalReminder>> {
    if (!isAdminActor(actor)) return { data: null, error: 'You do not have permission to perform this action.' }
    return writeReturning<GlobalReminder>(
      'insert into public.global_reminders (message, remind_at) values ($1, $2) returning id, message, remind_at::text as remind_at, created_at::text as created_at',
      [input.message, input.remindAt]
    )
  },

  async updateGlobalReminder(
    actor: Actor,
    id: string,
    input: { message?: string; remindAt?: string }
  ): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    const fields: string[] = []
    const values: unknown[] = []
    let i = 1
    if (input.message !== undefined) {
      fields.push(`message = $${i++}`)
      values.push(input.message.trim())
    }
    if (input.remindAt !== undefined) {
      fields.push(`remind_at = $${i++}`)
      values.push(input.remindAt)
    }
    if (fields.length === 0) return { error: null }
    values.push(id)
    return write(
      `update public.global_reminders set ${fields.join(', ')} where id = $${i}`,
      values
    )
  },

  async deleteGlobalReminder(actor: Actor, id: string): Promise<DbWrite> {
    if (!isAdminActor(actor)) return { error: 'You do not have permission to perform this action.' }
    return write('delete from public.global_reminders where id = $1', [id])
  },

  async dismissGlobalReminder(actor: Actor, reminderId: string): Promise<DbWrite> {
    return write(
      'insert into public.global_reminder_dismissals (user_id, reminder_id) values ($1, $2) on conflict do nothing',
      [actor.id, reminderId]
    )
  },
}
