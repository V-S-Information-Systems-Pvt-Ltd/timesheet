import 'server-only'

import { todayISO } from '@/lib/dates'
import type { ReportingPersistence } from '@/lib/domain/reporting-port'
import type { ReportingDeps } from '@/lib/domain/reporting'
import { createNativeReportingPersistence } from './native/reporting'
import { nativeTimesheetPersistence } from './native/timesheets'

/**
 * Directly composes the narrow ReportingPersistence port from the native adapter.
 * The canonical scoped list is injected here (the composition root may import both domain
 * adapters) so the reporting adapter needs no sibling-domain import of its own.
 */
export const reportingPersistence: ReportingPersistence = createNativeReportingPersistence((actor, opts) => nativeTimesheetPersistence.list(actor, opts))

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
