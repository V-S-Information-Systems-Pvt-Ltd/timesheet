'use client'

// A single date-range control shared by every reports tab: the preset
// <Select>, the custom start/end date inputs, and the resolved-range badge.

import { presetRange, type Preset } from '@vsis/core'
import { Badge, Input, Select } from './ui'
import { cn } from './cn'

/** Full preset list — the <Select> always exposes every option. */
const PRESET_OPTIONS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This Week' },
  { value: '7days', label: 'Last 7 Days' },
  { value: 'this', label: 'This Month' },
  { value: 'last', label: 'Last Month' },
  { value: 'prev2', label: '2 Months Ago' },
  { value: 'prev3', label: '3 Months Ago' },
  { value: 'custom', label: 'Custom Range' },
]

export function DatePresetSelect({ preset, onPresetChange, allowCustom = true, label = 'Date range preset' }: {
  preset: Preset
  onPresetChange: (preset: Preset) => void
  allowCustom?: boolean
  label?: string
}) {
  return (
    <Select aria-label={label} value={preset} onChange={(event) => onPresetChange(event.target.value as Preset)} className="w-auto max-w-full">
      {PRESET_OPTIONS.filter(option => allowCustom || option.value !== 'custom').map(option => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </Select>
  )
}

export interface DateRangePickerProps {
  preset: Preset
  onPresetChange: (preset: Preset) => void
  customStart: string
  customEnd: string
  onCustomStartChange: (value: string) => void
  onCustomEndChange: (value: string) => void
  /**
   * Resolved range for the badge. Defaults to `presetRange(preset, …)`, which
   * matches what callers compute, but accept it so the badge never drifts from
   * the range the page actually fetched.
   */
  range?: { start: string; end: string }
  className?: string
}

export function DateRangePicker({
  preset,
  onPresetChange,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
  range,
  className,
}: DateRangePickerProps) {
  const resolved = range ?? presetRange(preset, customStart, customEnd)
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <DatePresetSelect preset={preset} onPresetChange={onPresetChange} />
      {preset === 'custom' && (
        <>
          <Input
            type="date"
            aria-label="Custom range start date"
            value={customStart}
            onChange={(e) => onCustomStartChange(e.target.value)}
            className="w-auto"
          />
          <span className="text-sm text-fg-muted">to</span>
          <Input
            type="date"
            aria-label="Custom range end date"
            value={customEnd}
            onChange={(e) => onCustomEndChange(e.target.value)}
            className="w-auto"
          />
        </>
      )}
      <Badge tone="blue">
        {resolved.start} → {resolved.end}
      </Badge>
    </div>
  )
}
