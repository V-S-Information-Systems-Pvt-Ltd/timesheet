import type { GlobalReminder } from '@/app/types'

export function remindersForDisplay(rows: GlobalReminder[] | null, banner: boolean, now = Date.now()) {
  return (rows ?? []).filter(r => Boolean(r.display_as_banner) === banner && new Date(r.remind_at).getTime() <= now)
}

/** Only remove a reminder from the shared UI after its dismissal is persisted. */
export async function dismissDashboardReminder(
  id: string,
  write: (id: string) => Promise<{ error: string | null }>,
  onDismiss: (id: string) => void,
) {
  try {
    const { error } = await write(id)
    if (error) return error
    onDismiss(id)
    return null
  } catch {
    return 'Could not dismiss the reminder. Please try again.'
  }
}
