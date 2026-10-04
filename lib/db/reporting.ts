import 'server-only'

import { IS_NATIVE } from '@/lib/backend/config'
import { todayISO } from '@/lib/dates'
import type { ReportingPersistence } from '@/lib/domain/reporting-port'
import type { ReportingDeps } from '@/lib/domain/reporting'
import { createNativeReportingPersistence } from './native/reporting'
import { createSupabaseReportingPersistence } from './supabase/reporting'
import { nativeTimesheetPersistence } from './native/timesheets'
import { supabaseTimesheetPersistence } from './supabase/timesheets'

/**
 * Directly composes the narrow ReportingPersistence port from the active provider adapter.
 * The canonical scoped list is injected here (the composition root may import both domain
 * adapters) so the reporting adapter needs no sibling-domain import of its own.
 */
export const reportingPersistence: ReportingPersistence = IS_NATIVE
  ? createNativeReportingPersistence((actor, opts) => nativeTimesheetPersistence.list(actor, opts))
  : createSupabaseReportingPersistence((actor, opts) => supabaseTimesheetPersistence.list(actor, opts))

/**
 * Server entry composition for the reporting module. Transports depend on this
 * helper instead of resolving a database backend themselves; the application
 * operations receive persistence and a clock explicitly.
 */
export function reportingDeps(
  overrides: Partial<Pick<ReportingDeps, 'clock'>> = {}
): ReportingDeps {
  return {
    persistence: reportingPersistence,
    clock: overrides.clock ?? todayISO,
  }
}
