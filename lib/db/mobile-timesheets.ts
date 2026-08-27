import 'server-only'

import { IS_NATIVE } from '@/lib/backend'
import { repo } from '@/lib/db'
import { listSupabaseMobileActorTimesheets } from '@/lib/db/supabase'
import type { Actor, TimesheetListOptions, TimesheetListResult } from '@/lib/db/repository'

type MobileTimesheetListOptions = Omit<TimesheetListOptions, 'userId'>

/**
 * Lists only the bearer-authenticated user's entries. This deliberately does
 * not expose a userId option: mobile tokens are personal, not admin sessions.
 */
export async function listMobileActorTimesheets(
  actor: Actor,
  opts: MobileTimesheetListOptions = {}
): Promise<TimesheetListResult> {
  if (IS_NATIVE) {
    return repo.listTimesheets(actor, { ...opts, userId: actor.id })
  }
  return listSupabaseMobileActorTimesheets(actor.id, opts)
}
