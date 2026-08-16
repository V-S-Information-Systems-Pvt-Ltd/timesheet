// lib/telegram.ts
// Pure helpers that build the Telegram bot time-entry commands mirroring a
// logged timesheet entry. The bot accepts:
//   /log <Project No> <Hours> <description>                    (today)
//   /logyesterday <Project No> <Hours> <description>           (yesterday)
//   /logyesterday <YYYY-M-D> <Project No> <Hours> <description> (older dates)
//
// The <Project No> comes from projects.telegram_no; when the project has no
// number configured (e.g. entries logged against the Support / R&D / Meetings
// pseudo-projects), the entry's activity type telegram_no is used as a
// fallback. All functions are pure so they are unit-testable.

import type { ActivityType, Project, Timesheet } from '@/app/types'
import { addDaysISO, todayISO } from './dates'

export interface BotCommandResult {
  command: string | null
  /** Human-readable reason when `command` is null. */
  reason?: string
}

export type ProjectLike = Pick<Project, 'telegram_no'> | null | undefined
export type ActivityTypeLike = Pick<ActivityType, 'telegram_no'> | null | undefined

/** The bot's date format: YYYY-M-D without zero padding (e.g. 2026-8-11). */
export function botDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return iso
  return `${match[1]}-${Number(match[2])}-${Number(match[3])}`
}

/** Render hours as the bot expects (3.5, 6 — no trailing zeros). */
export function formatHours(hours: number): string {
  const n = Number(hours)
  return Number.isFinite(n) ? String(n) : '0'
}

/** Flatten work_done to a single line so the command stays one line. */
export function flattenDescription(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim()
}

/** Pick the bot number: the project's, else the activity type's. */
export function resolveBotNumber(
  project: ProjectLike,
  activityType: ActivityTypeLike
): number | null {
  if (project?.telegram_no) return project.telegram_no
  if (activityType?.telegram_no) return activityType.telegram_no
  return null
}

/**
 * Build the bot command for a timesheet entry. `today` defaults to the real
 * today so the branch (today / yesterday / dated) is deterministic in tests.
 */
export function buildBotCommand(
  entry: Pick<Timesheet, 'log_date' | 'hours_worked' | 'work_done'>,
  project: ProjectLike,
  activityType: ActivityTypeLike,
  today: string = todayISO()
): BotCommandResult {
  const no = resolveBotNumber(project, activityType)
  if (no === null) {
    return {
      command: null,
      reason:
        'No bot number configured for this entry — set one in Project Manager or Activity Types.',
    }
  }

  const description = flattenDescription(entry.work_done) || '<description>'
  const hours = formatHours(entry.hours_worked)
  const yesterday = addDaysISO(today, -1)

  if (entry.log_date === today) {
    return { command: `/log ${no} ${hours} ${description}` }
  }
  if (entry.log_date === yesterday) {
    return { command: `/logyesterday ${no} ${hours} ${description}` }
  }
  return { command: `/logyesterday ${botDate(entry.log_date)} ${no} ${hours} ${description}` }
}