import type { Timesheet } from '@/app/types'
import type { TimesheetQuery, TimesheetResult } from '@/lib/data/client'
import { isTemporaryTimesheetId } from '@/lib/optimistic-timesheets'

export type TimesheetRead = (query: TimesheetQuery) => Promise<TimesheetResult>
export interface EntriesPage { user: string; page: number; size: number }

export function entriesPageFromSearch(search: Pick<URLSearchParams, 'get'>): EntriesPage {
  const size = Number(search.get('size'))
  const page = Number(search.get('page'))
  return {
    user: search.get('user') ?? '',
    size: [25, 50, 100].includes(size) ? size : 50,
    page: Number.isSafeInteger(page) && page > 0 && page <= Math.floor(Number.MAX_SAFE_INTEGER / 100) ? page : 1,
  }
}

export function entriesPageQuery(page: EntriesPage): TimesheetQuery {
  const from = (page.page - 1) * page.size
  return { from, to: from + page.size - 1, userId: page.user || undefined }
}

/** Entire matching history, installed atomically by callers after success.
 * Count drift, repeated IDs, missing pages, and cancellation fail closed.
 * Offset paging cannot promise a transaction against external writers.
 */
export async function readTimesheetHistory(
  read: TimesheetRead,
  filters: Pick<TimesheetQuery, 'userId' | 'dateFrom' | 'dateTo'> = {},
  isCurrent: () => boolean = () => true,
): Promise<Timesheet[]> {
  const size = 1000
  const rows: Timesheet[] = []
  const ids = new Set<string>()
  let total: number | null = null
  for (let from = 0; ; from += size) {
    if (!isCurrent()) throw new Error('History request cancelled. Please retry.')
    const result = await read({ ...filters, from, to: from + size - 1, includeCount: true })
    if (!isCurrent()) throw new Error('History request cancelled. Please retry.')
    if (result.error || !result.data) throw new Error(result.error || 'Could not load complete history.')
    if (result.count === null || !Number.isSafeInteger(result.count) || result.count < 0) {
      throw new Error('Could not verify complete history. Please retry.')
    }
    if (total === null) total = result.count
    if (total !== result.count || result.data.length > size) throw new Error('History changed while loading. Please retry.')
    for (const row of result.data) {
      if (ids.has(row.id) || isTemporaryTimesheetId(row.id)) throw new Error('History changed while loading. Please retry.')
      ids.add(row.id)
      rows.push(row)
    }
    if (rows.length === total) return rows
    if (rows.length > total || result.data.length !== size) throw new Error('Could not load complete history. Please retry.')
  }
}

export interface TimesheetPageState {
  scope: string
  rows: Timesheet[]
  count: number | null
  loading: boolean
  error: string | null
}

/** Each instance owns its requests; read must bypass global URL singleflight. */
export function createTimesheetPageReader(read: TimesheetRead, publish: (state: TimesheetPageState) => void,
  initial?: { state: TimesheetPageState; query: TimesheetQuery }) {
  let scope = initial?.state.scope ?? ''
  let sequence = 0
  let query: TimesheetQuery = initial?.query ?? {}
  let state: TimesheetPageState = initial?.state ?? { scope, rows: [], count: null, loading: false, error: null }
  const emit = (next: TimesheetPageState) => { state = next; publish(next) }
  return {
    reset(nextScope: string, nextQuery: TimesheetQuery) {
      scope = nextScope
      query = nextQuery
      sequence++
      emit({ scope, rows: [], count: null, loading: Boolean(scope), error: null })
    },
    invalidate() { sequence++ },
    async refresh() {
      if (!scope) return false
      const current = ++sequence
      const requestedScope = scope
      emit({ ...state, loading: true, error: null })
      let result: TimesheetResult
      try { result = await read(query) }
      catch { result = { data: null, count: null, error: 'Could not refresh entries.' } }
      if (current !== sequence || requestedScope !== scope) return false
      if (result.error || !result.data) {
        emit({ ...state, loading: false, error: result.error || 'Could not refresh entries.' })
        return false
      }
      emit({ scope, rows: result.data, count: result.count, loading: false, error: null })
      return true
    },
  }
}

/** Page overlays never pull an off-page row into a different page/filter. */
export function mergePageOverlays(rows: Timesheet[], pending: ReadonlyMap<string, Timesheet | null>, user: string) {
  const merged = rows.flatMap(row => {
    const replacement = pending.has(row.id) ? pending.get(row.id) : row
    return replacement && (!user || replacement.user_id === user) ? [replacement] : []
  })
  const ids = new Set(rows.map(row => row.id))
  const temporary = [...pending.values()].filter((row): row is Timesheet => row !== null && isTemporaryTimesheetId(row.id) && !ids.has(row.id) && (!user || row.user_id === user))
  return [...temporary, ...merged]
}

export function selectedSnapshotRows(snapshot: ReadonlyMap<string, Timesheet>, ids: ReadonlySet<string>): Timesheet[] {
  return [...snapshot.values()].filter(row => ids.has(row.id) && !isTemporaryTimesheetId(row.id))
}
