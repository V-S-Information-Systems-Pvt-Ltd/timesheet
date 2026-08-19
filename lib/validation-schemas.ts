// lib/validation-schemas.ts
// Zod schemas for server-side input validation.
// These are used in server actions and API route handlers to reject
// malformed or malicious input before it reaches the database.

import { z } from 'zod'

export const logEntrySchema = z.object({
  projectId: z.string().min(1, 'Project is required.'),
  activityTypeId: z.string().min(1, 'Activity type is required.'),
  hoursWorked: z.number().positive('Hours must be greater than zero.').max(24, 'Hours must be at most 24.'),
  workDone: z.string().min(1, 'Work description is required.').max(5000, 'Work description is too long.'),
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format.'),
})

export const loginSchema = z.object({
  email: z.string().email('Invalid email address.'),
  password: z.string().min(1, 'Password is required.'),
})

export const timesheetQuerySchema = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
})

export type LogEntryInput = z.infer<typeof logEntrySchema>
export type LoginInput = z.infer<typeof loginSchema>
export type TimesheetQuery = z.infer<typeof timesheetQuerySchema>
