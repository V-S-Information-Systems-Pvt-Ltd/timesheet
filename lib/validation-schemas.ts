// lib/validation-schemas.ts
// Zod schemas for server-side input validation. These replace the manual
// isNonEmpty / isReasonableHours / isValidISODate checks in app/actions.ts
// and the ad-hoc parsing in the timesheets API route, returning structured
// field-level errors instead of plain strings.
import { z } from 'zod'
import { isValidISODate } from './validation'

/** Common work-entry input shape used by logEntry, logYesterday, updateTimesheet. */
export const logEntrySchema = z.object({
  projectId: z.string().min(1, 'Project is required.'),
  activityTypeId: z.string().min(1, 'Activity type is required.'),
  hoursWorked: z
    .number({ error: 'Hours must be a number.' })
    .positive('Hours must be greater than zero.')
    .max(24, 'Hours must be at most 24.'),
  workDone: z.string().min(1, 'Work description is required.').max(2000, 'Work description is too long.'),
  logDate: z.string().refine(isValidISODate, { message: 'Invalid date.' }),
})

/** logYesterday accepts the same work fields as logEntry but without logDate
 * (yesterday is computed server-side); adds an optional userId for admin backfill. */
export const logYesterdaySchema = z.object({
  projectId: z.string().min(1, 'Project is required.'),
  activityTypeId: z.string().min(1, 'Activity type is required.'),
  hoursWorked: z
    .number({ error: 'Hours must be a number.' })
    .positive('Hours must be greater than zero.')
    .max(24, 'Hours must be at most 24.'),
  workDone: z.string().min(1, 'Work description is required.').max(2000, 'Work description is too long.'),
  userId: z.string().optional(),
})

/** Query-string shape for the timesheets list endpoint. */
export const timesheetQuerySchema = z.object({
  from: z.coerce
    .number({ error: 'from must be an integer' })
    .int()
    .nonnegative('from must be >= 0')
    .optional(),
  to: z.coerce
    .number({ error: 'to must be an integer' })
    .int()
    .nonnegative('to must be >= 0')
    .optional(),
  limit: z.coerce
    .number({ error: 'limit must be an integer' })
    .int()
    .positive('limit must be > 0')
    .optional(),
  userId: z.string().optional(),
  // Validated as ISO dates so malformed values fail with a clean 400 instead
  // of a backend date-cast error (500).
  dateFrom: z.string().refine(isValidISODate, { message: 'Invalid dateFrom. Use YYYY-MM-DD.' }).optional(),
  dateTo: z.string().refine(isValidISODate, { message: 'Invalid dateTo. Use YYYY-MM-DD.' }).optional(),
})

/** Password complexity requirement (min 8 chars, uppercase, lowercase, number). */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .regex(/[A-Z]/, 'Password must include at least one uppercase letter.')
  .regex(/[a-z]/, 'Password must include at least one lowercase letter.')
  .regex(/[0-9]/, 'Password must include at least one digit.')

/** Project creation / renaming schema. */
export const projectSchema = z.object({
  name: z.string().min(1, 'Project name is required.').max(200, 'Project name is too long.'),
})

/** Activity type schema. */
export const activityTypeSchema = z.object({
  name: z.string().min(1, 'Activity type name is required.').max(200, 'Activity type name is too long.'),
})

/** Reminder schema. remindAt must parse as a real date; callers normalize it
 * to ISO before persisting. */
export const reminderSchema = z.object({
  message: z.string().trim().min(1, 'Message is required.').max(500, 'Message is too long.'),
  remindAt: z
    .string()
    .min(1, 'Reminder date/time is required.')
    .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: 'Invalid reminder time.' }),
})

/** Backfill settings schema. */
export const backfillSettingsSchema = z.object({
  mode: z.enum(['days', 'month_start']),
  windowDays: z.number().int().nonnegative('Window days must be >= 0'),
  extraDays: z.number().int().nonnegative('Extra days must be >= 0'),
})

/** Leave-entry rows accepted by POST /api/data/leaves. Bounded at 366 rows
 * (one year) so an unbounded payload cannot reach the database layer. */
export const leaveRowsSchema = z
  .array(
    z.object({
      userId: z.string().min(1, 'userId is required.'),
      leaveDate: z.string().refine(isValidISODate, { message: 'Invalid leaveDate. Use YYYY-MM-DD.' }),
      reason: z.string().max(500, 'Reason is too long.').default(''),
    })
  )
  .min(1, 'No leave rows provided.')
  .max(366, 'Too many leave rows (max 366).')

/** Query-string shape for the leaves list endpoint. */
export const leaveQuerySchema = z.object({
  userId: z.string().trim().min(1, 'userId must not be blank.').optional(),
  from: z.string().refine(isValidISODate, { message: 'Invalid from. Use YYYY-MM-DD.' }).optional(),
  to: z.string().refine(isValidISODate, { message: 'Invalid to. Use YYYY-MM-DD.' }).optional(),
})

/** Result of parsing a schema: either success or structured field errors. */
export type ValidationError = {
  error: string
  fieldErrors?: Record<string, string[]>
}

export function parseSchema<T>(
  schema: z.ZodSchema<T>,
  input: unknown
): { ok: true; data: T } | { ok: false; error: ValidationError } {
  const result = schema.safeParse(input)
  if (result.success) return { ok: true, data: result.data }
  const fieldErrors: Record<string, string[]> = {}
  let firstMessage = 'Invalid input.'
  for (const issue of result.error.issues) {
    const key = issue.path?.[0] ? String(issue.path[0]) : '_root'
    fieldErrors[key] = fieldErrors[key] ?? []
    fieldErrors[key].push(issue.message)
    if (firstMessage === 'Invalid input.') {
      const pathPrefix = issue.path?.length ? `${issue.path.join('.')}: ` : ''
      firstMessage = pathPrefix + issue.message
    }
  }
  return { ok: false, error: { error: firstMessage, fieldErrors } }
}
