'use client'

import { useState } from 'react'
import { Badge, Card, Field, Select } from '@/app/components/ui'
import { IconCalendar } from '@/app/components/icons'
import { SRI_LANKA_HOLIDAYS, holidaysInYear, type Holiday } from '@vsis/core'
import { cn } from '@/app/components/cn'

const YEARS = Array.from(new Set(SRI_LANKA_HOLIDAYS.map(h => Number(h.date.slice(0, 4)))))
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

export interface DayCell { className: string; title?: string }

/** One Monday-first month; `cell` styles each date (ISO yyyy-mm-dd). */
export function MonthGrid({ year, month, locale, cell, large = false }: {
  year: number
  month: number
  locale: string
  cell: (iso: string, weekend: boolean) => DayCell
  large?: boolean
}) {
  const first = new Date(Date.UTC(year, month, 1))
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const lead = (first.getUTCDay() + 6) % 7 // Monday-first
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  return (
    <div className="rounded-control border border-line p-3">
      <div className="mb-2 text-sm font-semibold text-fg">{first.toLocaleString(locale, { month: 'long', year: large ? 'numeric' : undefined, timeZone: 'UTC' })}</div>
      <div className={cn('grid grid-cols-7 text-center', large ? 'gap-1.5 text-sm' : 'gap-0.5 text-xs')}>
        {WEEKDAYS.map(d => <div key={d} className="py-0.5 font-medium text-fg-subtle">{d}</div>)}
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />
          const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const { className, title } = cell(iso, i % 7 >= 5)
          return <div key={iso} title={title} aria-label={title ? `${iso}: ${title}` : iso} className={cn('rounded tabular-nums', large ? 'py-2.5' : 'py-1', className)}>{day}</div>
        })}
      </div>
    </div>
  )
}

function holidayCell(holidays: Map<string, Holiday>) {
  return (iso: string, weekend: boolean): DayCell => {
    const holiday = holidays.get(iso)
    return {
      title: holiday ? `${holiday.name}${holiday.mercantile ? ' (Mercantile)' : ''}` : undefined,
      className: holiday?.mercantile ? 'bg-primary-600 font-semibold text-white'
        : holiday ? 'bg-warning-surface text-warning-text'
          : weekend ? 'text-fg-subtle' : 'text-fg',
    }
  }
}

const MISSING_LEGEND = [
  ['bg-success-surface ring-1 ring-success-ring', 'Logged'],
  ['bg-danger-surface ring-1 ring-danger-ring', 'Missing'],
  ['bg-leave-surface ring-1 ring-leave-ring', 'Leave'],
  ['bg-primary-600', 'Mercantile holiday'],
] as const

export interface MissingDayCell extends DayCell { missing?: boolean }

/** Day state shared by the My Missing calendar and the Log Time ribbon. */
export function missingDayCell(hoursByDate: Map<string, number>, leaveDates: Set<string>, today: string) {
  const holidays = new Map(holidaysInYear(Number(today.slice(0, 4))).filter(h => h.mercantile).map(h => [h.date, h]))
  return (iso: string, weekend: boolean): MissingDayCell => {
    const hours = hoursByDate.get(iso)
    const holiday = holidays.get(iso)
    if (holiday) return { className: 'bg-primary-600 font-semibold text-white', title: holiday.name }
    if (leaveDates.has(iso)) return { className: 'bg-leave-surface text-leave-text', title: 'Leave' }
    if (hours) return { className: 'bg-success-surface font-medium text-success-text', title: `${hours}h logged` }
    if (weekend) return { className: 'text-fg-subtle' }
    if (iso > today) return { className: 'text-fg-muted' }
    return { className: 'bg-danger-surface font-semibold text-danger-text ring-1 ring-danger-ring', title: 'Missing', missing: true }
  }
}

export function MissingLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-fg-muted">
      {MISSING_LEGEND.map(([swatch, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5"><span className={cn('h-3 w-3 rounded', swatch)} /> {label}</span>
      ))}
    </div>
  )
}

/** Current month: logged, missing and leave days up to today. */
export function MissingDaysCalendar({ hoursByDate, leaveDates, today, locale }: {
  hoursByDate: Map<string, number>
  leaveDates: Set<string>
  today: string
  locale: string
}) {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7)) - 1
  const cell = missingDayCell(hoursByDate, leaveDates, today)
  return (
    <div className="space-y-3">
      <MissingLegend />
      <div className="max-w-md"><MonthGrid year={year} month={month} locale={locale} cell={cell} large /></div>
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
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-warning-surface ring-1 ring-warning-ring" /> Public / bank holiday</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }, (_, m) => <MonthGrid key={m} year={year} month={m} locale={locale} cell={holidayCell(byDate)} />)}
        </div>
      </Card>
      <Card title={`Holidays in ${year}`} subtitle={`${list.filter(h => h.mercantile).length} mercantile of ${list.length}`}>
        <ul className="divide-y divide-line text-sm">
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
