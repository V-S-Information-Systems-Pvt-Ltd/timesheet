// Personal report views must not inherit the group report's user selection.
export function reportUserId(tab: string, userFilter: string, myId: string | undefined): string | null {
  const filter = tab === 'myhours' || tab === 'summaries' ? 'me' : userFilter
  if (filter === 'me') return myId ?? 'me'
  return filter === 'all' ? null : filter
}
