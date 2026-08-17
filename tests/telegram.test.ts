import { describe, expect, it } from 'vitest'
import {
  botDate,
  buildBotCommand,
  flattenDescription,
  formatHours,
  resolveBotNumber,
} from '../lib/telegram'

const project = (telegram_no: number | null) => ({ telegram_no })
const type = (telegram_no: number | null) => ({ telegram_no })

const entry = (log_date: string, hours_worked = 3.5, work_done = 'Tape library check') => ({
  log_date,
  hours_worked,
  work_done,
})

const TODAY = '2026-08-11'

describe('botDate', () => {
  it('strips zero padding from month and day', () => {
    expect(botDate('2026-08-11')).toBe('2026-8-11')
    expect(botDate('2026-01-03')).toBe('2026-1-3')
    expect(botDate('2026-12-31')).toBe('2026-12-31')
  })
  it('passes through non-date strings untouched', () => {
    expect(botDate('not-a-date')).toBe('not-a-date')
  })
})

describe('formatHours', () => {
  it('renders whole and fractional hours', () => {
    expect(formatHours(6)).toBe('6')
    expect(formatHours(3.5)).toBe('3.5')
    expect(formatHours(3.5)).toBe('3.5')
    expect(formatHours(Number.NaN)).toBe('0')
  })
})

describe('flattenDescription', () => {
  it('collapses newlines into single spaces', () => {
    expect(flattenDescription('line one\nline two')).toBe('line one line two')
  })
})

describe('resolveBotNumber', () => {
  it('prefers the project number over the activity type', () => {
    expect(resolveBotNumber(project(94), type(129))).toBe(94)
  })
  it('falls back to the activity type number', () => {
    expect(resolveBotNumber(project(null), type(129))).toBe(129)
  })
  it('returns null when neither is configured', () => {
    expect(resolveBotNumber(project(null), type(null))).toBeNull()
  })
})

describe('Internal default project rule', () => {
  const internal = { telegram_no: 1000, name: 'Internal' }

  it('prefers the activity type number for Internal', () => {
    expect(resolveBotNumber(internal, type(112))).toBe(112)
  })
  it('falls back to Internal bot number 1000 when the type has none', () => {
    expect(resolveBotNumber(internal, type(null))).toBe(1000)
  })
  it('builds /log with the activity number for an Internal entry', () => {
    const { command } = buildBotCommand(entry(TODAY), internal, type(112), TODAY)
    expect(command).toBe('/log 112 3.5 Tape library check')
  })
})

describe('buildBotCommand', () => {
  it('builds /log for today', () => {
    const { command } = buildBotCommand(entry(TODAY), project(94), type(null), TODAY)
    expect(command).toBe('/log 94 3.5 Tape library check')
  })

  it('builds /logyesterday (no date) for yesterday', () => {
    const { command } = buildBotCommand(entry('2026-08-10'), project(141), type(null), TODAY)
    expect(command).toBe('/logyesterday 141 3.5 Tape library check')
  })

  it('builds dated /logyesterday for older entries with the bot date format', () => {
    const { command } = buildBotCommand(entry('2026-08-01'), project(94), type(null), TODAY)
    expect(command).toBe('/logyesterday 2026-8-1 94 3.5 Tape library check')
  })

  it('falls back to the activity type number when the project has none', () => {
    const { command } = buildBotCommand(entry(TODAY), project(null), type(142), TODAY)
    expect(command).toBe('/log 142 3.5 Tape library check')
  })

  it('returns a reason instead of a command when no number exists', () => {
    const result = buildBotCommand(entry(TODAY), project(null), type(null), TODAY)
    expect(result.command).toBeNull()
    expect(result.reason).toContain('No bot number configured')
  })

  it('formats whole-hour entries without decimals', () => {
    const { command } = buildBotCommand(entry(TODAY, 6, 'RedHat workshop'), project(141), type(null), TODAY)
    expect(command).toBe('/log 141 6 RedHat workshop')
  })

  it('keeps multi-word descriptions intact', () => {
    const { command } = buildBotCommand(
      entry(TODAY, 6, 'INC00086211 Mobitel tape library issue check onsite'),
      project(94),
      type(null),
      TODAY
    )
    expect(command).toBe('/log 94 6 INC00086211 Mobitel tape library issue check onsite')
  })

  it('flattens newlines in the description', () => {
    const { command } = buildBotCommand(entry(TODAY, 3, 'L1\nL2'), project(94), type(null), TODAY)
    expect(command).toBe('/log 94 3 L1 L2')
  })
})