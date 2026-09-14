import 'server-only'

import { IS_NATIVE } from '@/lib/backend/config'
import { todayISO } from '@/lib/dates'
import { dailyWriteBudget } from '@/lib/domain/write-budget'
import type { TimesheetDomainDeps } from '@/lib/domain/timesheets'
import type { TimesheetPersistence } from '@/lib/domain/timesheets-port'
import { nativeTimesheetPersistence } from './native/timesheets'
import { supabaseTimesheetPersistence } from './supabase/timesheets'

/**
 * Directly composes the narrow TimesheetPersistence port from the active provider adapter.
 * Bypasses the broad compatibility Repository facade so domain operations talk directly
 * to their provider implementation.
 */
export const timesheetPersistence: TimesheetPersistence = IS_NATIVE
  ? nativeTimesheetPersistence
  : supabaseTimesheetPersistence

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
