import type { Timesheet } from '@/app/types'

let temporaryIdSequence = 0

export function isTemporaryTimesheetId(id: string): boolean {
  return id.startsWith('temp-')
}

/** Local-only identity, not a security token; also works on HTTP LAN deployments. */
export function createTemporaryTimesheetId(): string {
  return `temp-${Date.now().toString(36)}-${(++temporaryIdSequence).toString(36)}`
}

/** Restore a real row's server position without moving newer optimistic inserts. */
export function insertOptimisticTimesheet(
  rows: Timesheet[],
  entry: Timesheet,
  serverOrder: readonly string[],
): Timesheet[] {
  const next = [entry, ...rows.filter(row => row.id !== entry.id)]
  if (isTemporaryTimesheetId(entry.id)) return next
  const positions = new Map(serverOrder.map((id, index) => [id, index]))
  return next.sort((a, b) => (positions.get(a.id) ?? -1) - (positions.get(b.id) ?? -1))
}

/** Apply only writes still in flight over a fresh, authoritative server list. */
export function mergePendingTimesheets(
  rows: Timesheet[],
  pending: ReadonlyMap<string, Timesheet | null>,
): Timesheet[] {
  const merged = rows.flatMap(row => {
    if (!pending.has(row.id)) return [row]
    const replacement = pending.get(row.id)
    return replacement ? [replacement] : []
  })
  const serverIds = new Set(rows.map(row => row.id))
  const additions = [...pending.values()].filter(
    (row): row is Timesheet => row !== null && !serverIds.has(row.id),
  )
  return [...additions, ...merged]
}
