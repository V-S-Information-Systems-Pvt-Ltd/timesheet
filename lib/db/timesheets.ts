import 'server-only'

import { repo } from '@/lib/db'
import { todayISO } from '@/lib/dates'
import { dailyWriteBudget } from '@/lib/domain/write-budget'
import type { TimesheetDomainDeps } from '@/lib/domain/timesheets'
import type { TimesheetPersistence } from '@/lib/domain/timesheets-port'

/**
 * Narrow adapter from the backend-dispatched compatibility `Repository` to the
 * timesheet port. `repo` already resolves native PostgreSQL or the
 * request-scoped Supabase implementation, so this mapping adds no provider
 * behavior of its own; it only narrows the surface the timesheet module sees.
 */
export const timesheetPersistence: TimesheetPersistence = {
  list: (actor, options) => repo.listTimesheets(actor, options),
  getBackfillWindow: (actor) => repo.getBackfillWindow(actor),
  getById: (actor, id) => repo.getTimesheet(actor, id),
  getByIds: (actor, ids) => repo.getTimesheetsByIds(actor, ids),
  getLatest: (actor, userId) => repo.getLatestTimesheet(actor, userId),
  sumHoursForUserDate: (actor, userId, logDate, excludeEntryId) =>
    repo.sumHoursForUserDate(actor, userId, logDate, excludeEntryId),
  sumHoursForUserDates: (actor, pairs) => repo.sumHoursForUserDates(actor, pairs),
  create: (actor, input) => repo.createTimesheet(actor, input),
  update: (actor, id, input) => repo.updateTimesheet(actor, id, input),
  remove: (actor, id) => repo.deleteTimesheet(actor, id),
  bulkUpdate: (actor, updates) => repo.bulkUpdateTimesheets(actor, updates),
}

/**
 * Server entry composition for the timesheet module. Transports depend on this
 * helper instead of resolving a database backend themselves; the application
 * operations receive persistence, clock and write-budget explicitly.
 */
export function timesheetDeps(
  overrides: Partial<Pick<TimesheetDomainDeps, 'writeBudget'>> = {}
): TimesheetDomainDeps {
  return {
    persistence: timesheetPersistence,
    clock: todayISO,
    writeBudget: overrides.writeBudget ?? dailyWriteBudget,
  }
}
