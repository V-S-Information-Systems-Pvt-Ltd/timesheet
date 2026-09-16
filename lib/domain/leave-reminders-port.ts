import 'server-only'

import type { GlobalReminder, LeaveEntry, Reminder } from '@/app/types'
import type { Actor, DbCreateResult, DbWrite, LeafRowInput } from '@/lib/db/repository'

/** Query-string shape accepted by the leave list operation. */
export interface LeaveListQuery {
  userId?: string
  from?: string
  to?: string
}

/**
 * Narrow persistence port owned by the leave/reminders application module. It
 * exposes only the operations personal leave, personal reminders and global
 * reminders need, so each backend can implement it without re-exposing the wide
 * compatibility `Repository`.
 *
 * Authorization, RLS, SQL scoping, provider error mapping, and the keyed
 * idempotency-effect machinery stay inside the implementation (native SQL or
 * the request-scoped Supabase client). The module never resolves a global
 * repository, cookies, headers or a service-role client for ordinary-user
 * operations.
 */
export interface LeaveReminderPersistence {
  listLeaves(actor: Actor, opts?: LeaveListQuery): Promise<LeaveEntry[]>
  createLeaves(actor: Actor, rows: LeafRowInput[]): Promise<DbWrite>
  deleteLeave(actor: Actor, id: string): Promise<DbWrite>

  listReminders(actor: Actor, userId: string): Promise<Reminder[]>
  createReminder(
    actor: Actor,
    input: { userId: string; message: string; remindAt: string }
  ): Promise<DbWrite>
  updateReminder(actor: Actor, id: string, input: { done: boolean }): Promise<DbWrite>
  deleteReminder(actor: Actor, id: string): Promise<DbWrite>

  listGlobalReminders(actor: Actor): Promise<GlobalReminder[]>
  listDueGlobalReminders(actor: Actor): Promise<GlobalReminder[]>
  createGlobalReminder(
    actor: Actor,
    input: { message: string; remindAt: string }
  ): Promise<DbCreateResult<GlobalReminder>>
  updateGlobalReminder(
    actor: Actor,
    id: string,
    input: { message?: string; remindAt?: string }
  ): Promise<DbWrite>
  deleteGlobalReminder(actor: Actor, id: string): Promise<DbWrite>
  dismissGlobalReminder(actor: Actor, reminderId: string): Promise<DbWrite>
}
