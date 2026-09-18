// lib/validation-schemas.ts
// Zod schemas for server-side input validation. These replace the manual
// isNonEmpty / isReasonableHours / isValidISODate checks in app/actions.ts
// and the ad-hoc parsing in the timesheets API route, returning structured
// field-level errors instead of plain strings.
import { z } from 'zod'
import { isValidISODate } from './validation'
import { validatePasswordPolicy } from './password-policy'

// Canonical timesheet request schemas live in @vsis/contracts (shared with
// mobile); re-exported here so existing server imports keep working.
export {
  logEntrySchema,
  timesheetQuerySchema,
  batchDeleteTimesheetsSchema,
  batchDuplicateTimesheetsSchema,
  backfillSettingsSchema,
} from '@vsis/contracts'

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

/** Password complexity requirement (min 8 chars, uppercase, lowercase, number). */
export const passwordSchema = z.string().superRefine((pwd, ctx) => {
  const res = validatePasswordPolicy(pwd)
  if (!res.ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: res.error ?? 'Invalid password.',
    })
  }
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
