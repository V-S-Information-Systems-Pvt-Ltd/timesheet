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
