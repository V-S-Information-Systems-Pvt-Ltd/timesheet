import 'server-only'

import { IS_NATIVE } from '@/lib/backend/config'
import { dailyWriteBudget, type WriteBudget } from '@/lib/domain/write-budget'
import type { LeaveReminderDeps } from '@/lib/domain/leave-reminders'
import type { LeaveReminderPersistence } from '@/lib/domain/leave-reminders-port'
import { nativeLeaveReminderPersistence } from './native/leave-reminders'
import { supabaseLeaveReminderPersistence } from './supabase/leave-reminders'

/**
 * Directly composes the narrow LeaveReminderPersistence port from the active provider adapter.
 * Bypasses the broad compatibility Repository facade so domain operations talk directly
 * to their provider implementation.
 */
export const leaveReminderPersistence: LeaveReminderPersistence = IS_NATIVE
  ? nativeLeaveReminderPersistence
  : supabaseLeaveReminderPersistence

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
