import { toISODate } from '@/lib/dates'

export function dashboardMonthRange(now = new Date()) {
  return {
    from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    groupBy: 'user' as const,
  }
}

type Totals = { totalHours: number; totalEntries: number }
export type DashboardMonthTotalsState =
  | { status: 'idle' | 'loading'; totals: null; error: null }
  | { status: 'ready'; totals: Totals; error: null }
  | { status: 'error'; totals: null; error: string }

type Result = { data: Totals | null; error: string | null }
const REFRESH_ERROR = 'Could not load this month’s totals.'

/** One mounted dashboard owns this controller; no shared auth or result cache. */
export function createDashboardMonthTotals(
  read: (query: ReturnType<typeof dashboardMonthRange>) => Promise<Result>,
  publish: (state: DashboardMonthTotalsState) => void,
  initialSession: string | null = null,
) {
  let session: string | null = initialSession
  let generation = 0
  let inFlight: Promise<Result> | null = null
  let busy = false

  async function refresh(): Promise<void> {
    if (!session) return
    const current = ++generation
    publish({ status: 'loading', totals: null, error: null })
    // A row callback may run before its busy lock is released. Do not block
    // reconciliation waiting for that lock; its release starts the fresh read.
    if (busy) return
    if (inFlight) await inFlight.catch(() => {})
    if (current !== generation) return
    let request: Promise<Result> | null = null
    try {
      request = read(dashboardMonthRange())
      inFlight = request
      const { data, error } = await request
      if (current !== generation) return
      if (error || !data) {
        publish({ status: 'error', totals: null, error: error || REFRESH_ERROR })
      } else {
        publish({ status: 'ready', totals: { totalHours: data.totalHours, totalEntries: data.totalEntries }, error: null })
      }
    } catch {
      if (current === generation) publish({ status: 'error', totals: null, error: REFRESH_ERROR })
    } finally {
      if (request && inFlight === request) inFlight = null
    }
  }

  return {
    refresh,
    hydrate(state: DashboardMonthTotalsState, range: ReturnType<typeof dashboardMonthRange>, now = new Date()) {
      if (!session || busy) return false
      const local = dashboardMonthRange(now)
      if (range.from !== local.from || range.to !== local.to) { void refresh(); return false }
      generation++
      publish(state)
      return true
    },
    reset(nextSession: string | null) {
      session = nextSession
      generation++
      busy = false
      // Retain the old flight until settled. The page also bypasses shared
      // transport deduplication, so remounts cannot adopt another session's read.
      publish({ status: 'idle', totals: null, error: null })
    },
    setBusy(nextBusy: boolean) {
      if (nextBusy === busy) return
      busy = nextBusy
      if (busy) {
        generation++
        if (session) publish({ status: 'loading', totals: null, error: null })
      } else {
        void refresh()
      }
    },
  }
}
