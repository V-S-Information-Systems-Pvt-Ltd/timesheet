import { describe, expect, it, vi } from 'vitest'
import type { GlobalReminder } from '@/app/types'
import { dismissDashboardReminder, remindersForDisplay } from '@/lib/dashboard-global-reminders'

const row = (id: string, banner?: boolean, time = '2026-01-01T00:00:00Z'): GlobalReminder => ({
  id, message: id, remind_at: time, created_at: time, display_as_banner: banner,
})
const now = new Date('2026-10-06T00:00:00Z').getTime()

describe('dashboard global reminder presentation', () => {
  it('shows due banners separately from ordinary and legacy tile reminders', () => {
    const rows = [row('banner', true), row('tile', false), row('legacy'), row('future', true, '2099-01-01T00:00:00Z')]
    expect(remindersForDisplay(rows, true, now).map(r => r.id)).toEqual(['banner'])
    expect(remindersForDisplay(rows, false, now).map(r => r.id)).toEqual(['tile', 'legacy'])
    expect(remindersForDisplay(null, true, now)).toEqual([])
  })

  it('removes a dismissed banner only after successful persistence', async () => {
    let rows = [row('banner', true)]
    const write = vi.fn().mockResolvedValue({ error: null })
    expect(await dismissDashboardReminder('banner', write, id => { rows = rows.filter(r => r.id !== id) })).toBeNull()
    expect(write).toHaveBeenCalledWith('banner')
    expect(remindersForDisplay(rows, true, now)).toEqual([])
  })

  it.each(['provider error', 'network error'])('keeps a banner visible after %s', async failure => {
    let rows = [row('banner', true)]
    const write = failure === 'provider error'
      ? vi.fn().mockResolvedValue({ error: 'Dismiss refused.' })
      : vi.fn().mockRejectedValue(new Error('offline'))
    expect(await dismissDashboardReminder('banner', write, id => { rows = rows.filter(r => r.id !== id) })).toBeTruthy()
    expect(remindersForDisplay(rows, true, now)).toHaveLength(1)
  })
})
