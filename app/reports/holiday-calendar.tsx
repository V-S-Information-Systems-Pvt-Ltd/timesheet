'use client'

import { useState } from 'react'
import { Badge, Card, Field, Select } from '@/app/components/ui'
import { IconCalendar } from '@/app/components/icons'
import { SRI_LANKA_HOLIDAYS, holidaysInYear, type Holiday } from '@/lib/work-calendar'
import { cn } from '@/app/components/cn'

const YEARS = Array.from(new Set(SRI_LANKA_HOLIDAYS.map(h => Number(h.date.slice(0, 4)))))
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function MonthGrid({ year, month, holidays, locale }: { year: number; month: number; holidays: Map<string, Holiday>; locale: string }) {
  const first = new Date(Date.UTC(year, month, 1))
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const lead = (first.getUTCDay() + 6) % 7 // Monday-first
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 text-sm font-semibold text-fg">{first.toLocaleString(locale, { month: 'long', timeZone: 'UTC' })}</div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {WEEKDAYS.map(d => <div key={d} className="py-0.5 font-medium text-fg-subtle">{d}</div>)}
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />
          const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const holiday = holidays.get(iso)
          const weekend = i % 7 >= 5
          return (
            <div
              key={iso}
              title={holiday ? `${holiday.name}${holiday.mercantile ? ' (Mercantile)' : ''}` : undefined}
              className={cn('rounded py-1 tabular-nums',
                holiday?.mercantile ? 'bg-primary-600 font-semibold text-white'
                  : holiday ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
                    : weekend ? 'text-fg-subtle' : 'text-fg')}
            >
              {day}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function HolidayCalendar() {
  const current = new Date().getFullYear()
  const [year, setYear] = useState(YEARS.includes(current) ? current : YEARS[YEARS.length - 1])
  const list = holidaysInYear(year)
  const byDate = new Map(list.map(h => [h.date, h]))
  const locale = typeof navigator !== 'undefined' ? (navigator.language || 'en-US') : 'en-US'
  return (
    <div className="space-y-4">
      <Card
        title="Sri Lanka Holiday Calendar"
        subtitle="Mercantile holidays are excluded from expected working hours."
        icon={<IconCalendar className="h-4.5 w-4.5" />}
        actions={
          <Field label="Year" className="w-28">
            <Select value={String(year)} onChange={e => setYear(Number(e.target.value))}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
          </Field>
        }
      >
        <div className="mb-3 flex flex-wrap gap-3 text-xs text-fg-muted">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-primary-600" /> Mercantile holiday</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-amber-100 dark:bg-amber-900/40" /> Public / bank holiday</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }, (_, m) => <MonthGrid key={m} year={year} month={m} holidays={byDate} locale={locale} />)}
        </div>
      </Card>
      <Card title={`Holidays in ${year}`} subtitle={`${list.filter(h => h.mercantile).length} mercantile of ${list.length}`}>
        <ul className="divide-y divide-border text-sm">
          {list.map(h => (
            <li key={h.date + h.name} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="tabular-nums text-fg-muted">{h.date}</span>
                <span className="ml-3 text-fg">{h.name}</span>
              </span>
              {h.mercantile ? <Badge tone="blue">Mercantile</Badge> : <Badge tone="slate">Public / Bank</Badge>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
