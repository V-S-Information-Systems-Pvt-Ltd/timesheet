import 'server-only'

import { repo } from '@/lib/db'
import { dailyWriteBudget, type WriteBudget } from '@/lib/domain/write-budget'
import type { LeaveReminderDeps } from '@/lib/domain/leave-reminders'
import type { LeaveReminderPersistence } from '@/lib/domain/leave-reminders-port'

/**
 * Narrow adapter from the backend-dispatched compatibility `Repository` to the
 * leave/reminders port. `repo` already resolves native PostgreSQL or the
 * request-scoped Supabase implementation (including the keyed
 * idempotency-effect handling for create/update/delete deliveries), so this
 * mapping adds no provider behavior of its own; it only narrows the surface the
 * module sees.
 */
export const leaveReminderPersistence: LeaveReminderPersistence = {
  listLeaves: (actor, opts) => repo.listLeaves(actor, opts),
  createLeaves: (actor, rows) => repo.createLeaves(actor, rows),
  deleteLeave: (actor, id) => repo.deleteLeave(actor, id),

  listReminders: (actor, userId) => repo.listReminders(actor, userId),
  createReminder: (actor, input) => repo.createReminder(actor, input),
  updateReminder: (actor, id, input) => repo.updateReminder(actor, id, input),
  deleteReminder: (actor, id) => repo.deleteReminder(actor, id),

  listGlobalReminders: (actor) => repo.listGlobalReminders(actor),
  listDueGlobalReminders: (actor) => repo.listDueGlobalReminders(actor),
  createGlobalReminder: (actor, input) => repo.createGlobalReminder(actor, input),
  updateGlobalReminder: (actor, id, input) => repo.updateGlobalReminder(actor, id, input),
  deleteGlobalReminder: (actor, id) => repo.deleteGlobalReminder(actor, id),
  dismissGlobalReminder: (actor, reminderId) => repo.dismissGlobalReminder(actor, reminderId),
}

/**
 * Server entry composition for the leave/reminders module. Transports depend on
 * this helper instead of resolving a database backend themselves; the
 * application operations receive persistence and the write budget explicitly.
 */
export function leaveReminderDeps(
  overrides: Partial<Pick<LeaveReminderDeps, 'writeBudget'>> = {}
): LeaveReminderDeps {
  return {
    persistence: leaveReminderPersistence,
    writeBudget: overrides.writeBudget ?? dailyWriteBudget,
  }
}

/**
 * Null-object write budget for the compatibility `/api/data` leave/reminder
 * transports. Those endpoints historically enforced no per-user daily write
 * budget (only the versioned `/api/v1` resources did), so composing this budget
 * keeps their released surface byte-identical while the module still owns the
 * single charge/release decision. Reserved slots are always granted and the
 * release is a no-op.
 */
export const unthrottledWriteBudget: WriteBudget = {
  async reserve() {
    return { ok: true, reservation: { release: async () => {} } }
  },
}
