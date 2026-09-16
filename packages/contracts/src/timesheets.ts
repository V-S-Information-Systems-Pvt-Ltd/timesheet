// Canonical timesheet wire contract shared by the server transports and the
// mobile client. The server remains authoritative: these types and schemas
// describe the released /api/v1 request and response shapes and must not
// drift from them.
import { z } from 'zod'
import { isValidISODate } from '@vsis/core'

/** Canonical input schema for creating/updating a timesheet entry. */
export const logEntrySchema = z.object({
  userId: z.string().optional(),
  projectId: z.string().min(1, 'Project is required.'),
  activityTypeId: z.string().min(1, 'Activity type is required.'),
  hoursWorked: z
    .number({ error: 'Hours must be a number.' })
    .positive('Hours must be greater than zero.')
    .max(24, 'Hours must be at most 24.'),
  workDone: z.string().min(1, 'Work description is required.').max(2000, 'Work description is too long.'),
  logDate: z.string().refine(isValidISODate, { message: 'Invalid date.' }),
})

/** Query-string schema for the timesheets list endpoint. */
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

/** Batch timesheet delete payload schema (bounded at 100 entries). */
export const batchDeleteTimesheetsSchema = z.object({
  ids: z
    .array(z.string().min(1, 'ID cannot be empty.'))
    .min(1, 'At least one ID is required.')
    .max(100, 'Batch size limit is 100 entries.'),
})

/** Batch timesheet duplicate payload schema (bounded at 100 entries). */
export const batchDuplicateTimesheetsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1, 'ID cannot be empty.'),
        targetDate: z.string().refine(isValidISODate, { message: 'Invalid targetDate. Use YYYY-MM-DD.' }).optional(),
      })
    )
    .min(1, 'At least one item is required.')
    .max(100, 'Batch size limit is 100 items.'),
})

/** A single timesheet entry as it appears in every response payload. */
export interface TimesheetEntry {
  id: string
  user_id: string
  user_email?: string
  project_id: string
  project_name?: string
  activity_type_id: string | null
  activity_name?: string | null
  log_date: string
  hours_worked: number
  work_done: string
  created_at: string
}

/** Input for creating a timesheet entry. */
export interface CreateTimesheetInput {
  userId?: string
  projectId: string
  activityTypeId?: string | null
  hoursWorked: number
  workDone: string
  logDate: string
}

/** Query parameters for listing timesheet entries. */
export interface TimesheetListParams {
  limit?: number
  from?: number
  to?: number
  dateFrom?: string
  dateTo?: string
  userId?: string
}

/** Paginated timesheet list response. */
export interface TimesheetListResult {
  rows: TimesheetEntry[]
  count?: number
  total?: number
}

/** Per-item outcome of a batch delete. */
export interface BatchDeleteResultItem {
  id: string
  success: boolean
  error?: string
}

/** Response for a batch delete of timesheet entries. */
export interface BatchDeleteTimesheetsResponse {
  results: BatchDeleteResultItem[]
  deletedCount: number
}

/** One item of a batch duplicate request. */
export interface BatchDuplicateItem {
  id: string
  targetDate?: string
}

/** Per-item outcome of a batch duplicate. */
export interface BatchDuplicateResultItem {
  id: string
  success: boolean
  entry?: TimesheetEntry
  error?: string
}

/** Response for a batch duplicate of timesheet entries. */
export interface BatchDuplicateTimesheetsResponse {
  results: BatchDuplicateResultItem[]
  duplicatedCount: number
}
