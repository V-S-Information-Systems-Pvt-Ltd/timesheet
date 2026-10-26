// app/dashboard/missing-ribbon.tsx
// One-line month strip above Log Time: every day of this month coloured as
// logged / missing / leave / holiday. A missing day picks that date in Log Time.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { dataClient } from '@/lib/data/client'
import { readTimesheetHistory } from '@/lib/dashboard-timesheets'
import { missingDayCell, MissingLegend } from '@/app/reports/holiday-calendar'
import { cn } from '@/app/components/cn'

export function MissingRibbon({ userId, today, minLogDate, refreshKey, onPick }: {
  userId: string
  today: string
  /** Days before this can no longer be logged, so they are not offered. */
  minLogDate: string
  /** Changes whenever entries change, to reload the month. */
  refreshKey: unknown
  onPick: (iso: string) => void
}) {
  const [data, setData] = useState<{ hours: Map<string, number>; leave: Set<string> } | null>(null)
  const [error, setError] = useState(false)
  const monthStart = `${today.slice(0, 7)}-01`

  useEffect(() => {
    let live = true
    void (async () => {
      // The month is paged to completion: a cap would report false missing days.
      const [rows, leaves] = await Promise.all([
        readTimesheetHistory(q => dataClient.getTimesheets(q), { userId, dateFrom: monthStart, dateTo: today }, () => live).catch(() => null),
        dataClient.getLeaves({ userId, from: monthStart, to: today }),
      ])
      if (!live) return
      if (!rows || leaves.error || !leaves.data) return setError(true)
      const hours = new Map<string, number>()
      for (const t of rows) hours.set(t.log_date, (hours.get(t.log_date) ?? 0) + Number(t.hours_worked))
      setError(false)
      setData({ hours, leave: new Set(leaves.data.map(l => l.leave_date)) })
    })()
    return () => { live = false }
  }, [userId, today, monthStart, refreshKey])

  const days = useMemo(() => {
    const year = Number(today.slice(0, 4))
    const month = Number(today.slice(5, 7)) - 1
    const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    return Array.from({ length: count }, (_, i) => {
      const date = new Date(Date.UTC(year, month, i + 1))
      const weekday = date.getUTCDay()
      return { iso: date.toISOString().slice(0, 10), day: i + 1, weekday, weekend: weekday === 0 || weekday === 6 }
    })
  }, [today])

  if (error) return null
  const cell = data ? missingDayCell(data.hours, data.leave, today) : null
  const missing = cell ? days.filter(d => cell(d.iso, d.weekend).missing).length : 0
  const monthName = new Date(`${monthStart}T00:00:00Z`).toLocaleString(undefined, { month: 'long', timeZone: 'UTC' })

  return (
    <section aria-label={`${monthName} logging`} className="mb-4 rounded-sheet border border-line bg-card px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold text-fg">{monthName}</h2>
        <p className="text-sm text-fg-muted" aria-live="polite">
          {!data ? 'Checking your month…' : missing === 0 ? 'Nothing missing so far.' : `${missing} working day${missing === 1 ? '' : 's'} missing. Pick one to log it.`}
        </p>
        <div className="ml-auto hidden sm:block"><MissingLegend /></div>
      </div>
      <ol className="grid grid-cols-7 gap-0.5 text-center text-xs tabular-nums sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none">
        {days.map(d => {
          const state = cell?.(d.iso, d.weekend) ?? { className: 'text-fg-subtle' }
          const label = `${d.iso}${state.title ? `: ${state.title}` : ''}`
          const inner = (
            <span aria-hidden>
              <span className="block text-[10px] leading-none opacity-70">{'SMTWTFS'[d.weekday]}</span>
              <span className="block pt-0.5">{d.day}</span>
            </span>
          )
          const base = cn('block min-h-11 w-full rounded-control py-1.5 sm:min-h-0 sm:py-1', state.className, d.iso === today && 'outline outline-2 outline-offset-1 outline-primary-600')
          return (
            <li key={d.iso}>
              {state.missing && d.iso >= minLogDate ? (
                <button type="button" onClick={() => onPick(d.iso)} aria-label={`${label}, log time for this day`} title={`${state.title} – log time`} className={cn(base, 'hover:brightness-95')}>
                  {inner}
                </button>
              ) : (
                <span title={state.title} className={base}>{inner}<span className="sr-only">{label}</span></span>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
