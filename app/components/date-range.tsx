'use client'

// A single date-range control shared by every reports tab. It composes a
// quick-access chip row (opt-in), the full preset <Select>, the custom
// start/end date inputs, and the resolved-range badge so the filter UX is
// identical everywhere instead of three overlapping controls per tab.

import { presetRange, type Preset } from '@/lib/dates'
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

/** The subset surfaced as one-tap chips; the select still covers all presets. */
const QUICK_PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This Week' },
  { value: '7days', label: 'Last 7 Days' },
  { value: 'this', label: 'This Month' },
  { value: 'last', label: 'Last Month' },
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
  /** Render the quick-access chip row above the preset select. */
  quickChips?: boolean
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
  quickChips = false,
  range,
  className,
}: DateRangePickerProps) {
  const resolved = range ?? presetRange(preset, customStart, customEnd)
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {quickChips && (
        <div role="group" aria-label="Quick date ranges" className="flex flex-wrap items-center gap-1.5">
          {QUICK_PRESETS.map(({ value, label }) => {
            const active = preset === value
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => onPresetChange(value)}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? 'border-primary-300 dark:border-primary-900 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-200'
                    : 'border-border bg-card text-fg-muted hover:bg-muted hover:text-fg'
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}
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
