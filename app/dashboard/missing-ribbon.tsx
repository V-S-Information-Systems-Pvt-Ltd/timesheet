// app/dashboard/missing-ribbon.tsx
// One-line month strip above Log Time: every day of this month coloured as
// logged / missing / leave / holiday. A missing day picks that date in Log Time.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { dataClient } from '@/lib/data/client'
import { missingDayCell, MissingLegend } from '@/app/reports/holiday-calendar'
import { cn } from '@/app/components/cn'

const MONTH_PAGE = 1000

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
      const hours = new Map<string, number>()
      // Page to completion: a cap would report false missing days.
      for (let from = 0; ; from += MONTH_PAGE) {
        const page = await dataClient.getTimesheets({ dateFrom: monthStart, dateTo: today, userId, from, to: from + MONTH_PAGE - 1 })
        if (!live) return
        if (page.error || !page.data) return setError(true)
        for (const t of page.data) hours.set(t.log_date, (hours.get(t.log_date) ?? 0) + Number(t.hours_worked))
        if (page.data.length < MONTH_PAGE) break
      }
      const leaves = await dataClient.getLeaves({ userId, from: monthStart, to: today })
      if (!live) return
      if (leaves.error || !leaves.data) return setError(true)
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
      return { iso: date.toISOString().slice(0, 10), day: i + 1, weekday: date.getUTCDay() }
    })
  }, [today])

  if (error) return null
  const cell = data ? missingDayCell(data.hours, data.leave, today) : null
  const missing = cell ? days.filter(d => cell(d.iso, d.weekday === 0 || d.weekday === 6).missing).length : 0
  const monthName = new Date(`${monthStart}T00:00:00Z`).toLocaleString(undefined, { month: 'long', timeZone: 'UTC' })

  return (
    <section aria-label={`${monthName} logging`} className="mb-4 rounded-xl border border-line bg-card px-4 py-3 shadow-card">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold text-fg">{monthName}</h2>
        <p className="text-sm text-fg-muted" aria-live="polite">
          {!data ? 'Checking your month…' : missing === 0 ? 'Nothing missing so far.' : `${missing} working day${missing === 1 ? '' : 's'} missing. Pick one to log it.`}
        </p>
        <div className="ml-auto hidden sm:block"><MissingLegend /></div>
      </div>
      <ol className="grid grid-cols-11 gap-0.5 text-center text-xs tabular-nums sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none">
        {days.map(d => {
          const weekend = d.weekday === 0 || d.weekday === 6
          const state = cell?.(d.iso, weekend) ?? { className: 'text-fg-subtle' }
          const label = `${d.iso}${state.title ? `: ${state.title}` : ''}`
          const inner = (
            <span aria-hidden>
              <span className="block text-[10px] leading-none opacity-70">{'SMTWTFS'[d.weekday]}</span>
              <span className="block pt-0.5">{d.day}</span>
            </span>
          )
          const base = cn('block w-full rounded py-1', state.className, d.iso === today && 'outline outline-2 outline-offset-1 outline-primary-600')
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
