'use client'

import { useId } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtHours } from '@/lib/reports'
import type { HoursPoint } from './chart-data'
import { EmptyState } from './ui'

const AXIS_TICK = { fill: 'var(--fg-muted)', fontSize: 11 }
const TOOLTIP_STYLE = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--fg)',
  fontSize: 12,
}

interface HoursChartProps {
  title: string
  data: HoursPoint[]
  description?: string
}

/** One hours series: categories use length, not a different hue per person. */
export function BarChartCard({ title, data, description }: HoursChartProps) {
  const titleId = useId()
  const shown = data.slice(0, 12)
  if (!data.length) return <EmptyState title="No hours to plot" />
  if (data.length === 1) {
    return <div className="rounded-control bg-muted p-4 text-sm text-fg"><span className="font-medium">{data[0].label}</span>: {fmtHours(data[0].hours)} hrs</div>
  }
  return (
    <figure className="min-w-0" aria-labelledby={titleId}>
      <figcaption id={titleId} className="mb-3 text-sm font-medium text-fg">{title}</figcaption>
      <div className="hours-chart" style={{ height: Math.max(180, shown.length * 36 + 44) }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={shown} layout="vertical" margin={{ top: 4, right: 28, bottom: 8, left: 0 }} accessibilityLayer>
            <CartesianGrid horizontal={false} stroke="var(--border)" />
            <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} domain={[0, 'auto']} unit=" h" />
            <YAxis type="category" dataKey="label" width={100} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(label: string) => label.length > 15 ? `${label.slice(0, 13)}…` : label} />
            <Tooltip cursor={{ fill: 'var(--muted)' }} contentStyle={TOOLTIP_STYLE} itemStyle={{ color: 'var(--fg)' }} formatter={(value) => [`${fmtHours(Number(value))} hrs`, 'Hours']} />
            <Bar dataKey="hours" name="Hours" fill="var(--chart-hours)" barSize={20} radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-fg-muted">{description ?? 'Full values are available in the table below.'}{data.length > shown.length ? ' Showing the first 12 users; the table includes everyone.' : ''}</p>
    </figure>
  )
}

/** Daily totals as columns on a category axis: days without entries are
 *  simply absent, never interpolated across as a line would. */
export function TrendChart({ title, data, description }: HoursChartProps) {
  const titleId = useId()
  if (!data.length) return <EmptyState title="No logged dates to plot" />
  return (
    <figure className="min-w-0" aria-labelledby={titleId}>
      <figcaption id={titleId} className="mb-3 text-sm font-medium text-fg">{title}</figcaption>
      <div className="hours-chart h-56">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={data} margin={{ top: 12, right: 24, bottom: 8, left: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={12} tickFormatter={(label: string) => label.slice(5)} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} domain={[0, 'auto']} unit=" h" />
            <Tooltip cursor={{ fill: 'var(--muted)' }} contentStyle={TOOLTIP_STYLE} itemStyle={{ color: 'var(--fg)' }} formatter={(value) => [`${fmtHours(Number(value))} hrs`, 'Hours']} />
            <Bar dataKey="hours" name="Hours" fill="var(--chart-hours)" maxBarSize={28} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-fg-muted">{description} Only dates with loaded entries are shown.</p>
      <details className="mt-3 text-xs text-fg-muted">
        <summary className="cursor-pointer font-medium">Daily totals table</summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{title}</caption>
            <thead><tr><th scope="col" className="py-2">Date</th><th scope="col" className="py-2 text-right">Hours</th></tr></thead>
            <tbody>{data.map(point => <tr key={point.label} className="border-t border-line"><td className="py-2">{point.label}</td><td className="py-2 text-right tabular-nums">{fmtHours(point.hours)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}
