export interface BotCommandResult {
  command: string | null;
  reason?: string;
}

export interface ProjectLike {
  name?: string | null;
  telegram_no?: number | null;
}

export interface ActivityTypeLike {
  telegram_no?: number | null;
}

export interface TimesheetLike {
  log_date: string;
  hours_worked: number;
  work_done: string;
}

/** The bot's date format: YYYY-M-D without zero padding (e.g. 2026-8-11). */
export function botDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[1]}-${Number(match[2])}-${Number(match[3])}`;
}

/** Render hours as the bot expects (3.5, 6 — no trailing zeros). */
export function formatHours(hours: number): string {
  const n = Number(hours);
  return Number.isFinite(n) ? String(n) : '0';
}

/** Flatten work_done to a single line so the command stays one line. */
export function flattenDescription(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

/**
 * Pick the bot number:
 *   * "Internal" is the default placeholder project — prefer the activity
 *     type's bot number so internal work logs under the right category,
 *     falling back to Internal's own number (1000) when the type has none.
 *   * otherwise the project's number wins, then the activity type's.
 */
export function resolveBotNumber(
  project: ProjectLike | null | undefined,
  activityType: ActivityTypeLike | null | undefined
): number | null {
  if (project?.name === 'Internal') {
    if (activityType?.telegram_no) return activityType.telegram_no;
    return project.telegram_no ?? null;
  }
  if (project?.telegram_no) return project.telegram_no;
  if (activityType?.telegram_no) return activityType.telegram_no;
  return null;
}

/** Add days to YYYY-MM-DD string without timezone shifts. */
export function addDaysISO(iso: string, deltaDays: number): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return iso;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

/**
 * Build the bot command for a timesheet entry.
 */
export function buildBotCommand(
  entry: TimesheetLike,
  project?: ProjectLike | null,
  activityType?: ActivityTypeLike | null,
  today: string = new Date().toISOString().slice(0, 10)
): BotCommandResult {
  const no = resolveBotNumber(project, activityType);
  if (no === null) {
    return {
      command: null,
      reason:
        'No bot number configured for this entry — set one in Project Manager or Activity Types.',
    };
  }

  const description = flattenDescription(entry.work_done) || '<description>';
  const hours = formatHours(entry.hours_worked);
  const yesterday = addDaysISO(today, -1);

  if (entry.log_date === today) {
    return { command: `/log ${no} ${hours} ${description}` };
  }
  if (entry.log_date === yesterday) {
    return { command: `/logyesterday ${no} ${hours} ${description}` };
  }
  return { command: `/logyesterday ${botDate(entry.log_date)} ${no} ${hours} ${description}` };
}
