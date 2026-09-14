import 'server-only'

import { IS_NATIVE } from '@/lib/backend/config'
import { todayISO } from '@/lib/dates'
import type { ReportingPersistence } from '@/lib/domain/reporting-port'
import type { ReportingDeps } from '@/lib/domain/reporting'
import { nativeReportingPersistence } from './native/reporting'
import { supabaseReportingPersistence } from './supabase/reporting'

/**
 * Directly composes the narrow ReportingPersistence port from the active provider adapter.
 * Bypasses the broad compatibility Repository facade so domain operations talk directly
 * to their provider implementation.
 */
export const reportingPersistence: ReportingPersistence = IS_NATIVE
  ? nativeReportingPersistence
  : supabaseReportingPersistence

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
