// lib/dates.ts
// Compatibility re-export: the canonical pure date helpers live in @vsis/core
// and are shared with the mobile application. Platform-specific date
// presentation stays local to each platform.
export {
  toISODate,
  todayISO,
  addDaysISO,
  rangeDates,
  nextMonthISO,
  monthStartOffset,
  monthEndOffset,
  presetRange,
  type Preset,
} from '@vsis/core'
