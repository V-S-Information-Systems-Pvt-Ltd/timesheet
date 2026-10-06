// Canonical timesheet wire contract shared by the server transports and the
// mobile client. The server remains authoritative: these types and schemas
// describe the released /api/v1 request and response shapes and must not
// drift from them.
import { z } from 'zod'
import { isValidISODate } from '@vsis/core'

// ---------------------------------------------------------------------------
// Timesheet Type → Activity taxonomy (classification v2).
//
// Stable values (never display labels) are the single source of truth shared by
// web, server and mobile. A row with entry_type === null is a historical
// (pre-v2) row and keeps the legacy Project + Activity-type validation.
// ---------------------------------------------------------------------------

export const ENTRY_TYPES = ['project', 'support', 'internal'] as const
export type EntryType = (typeof ENTRY_TYPES)[number]

export const ACTIVITY_CODES = [
  'planning',
  'implementation',
  'testing',
  'research_development',
  'internal_it',
  'customers',
  'meetings',
  'certifications',
  'poc',
  'presales_support',
  'other',
] as const
export type ActivityCode = (typeof ACTIVITY_CODES)[number]

/** Allowed activity codes per entry type. `research_development` is shared by
 * Project and Internal on purpose; the two stay distinct via entry_type. */
export const ACTIVITIES_BY_TYPE: Record<EntryType, readonly ActivityCode[]> = {
  project: ['planning', 'implementation', 'testing', 'research_development'],
  support: ['internal_it', 'customers'],
  internal: ['research_development', 'meetings', 'certifications', 'poc', 'presales_support', 'other'],
}

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  project: 'Project',
  support: 'Support',
  internal: 'Internal',
}

export const ACTIVITY_LABELS: Record<ActivityCode, string> = {
  planning: 'Planning',
  implementation: 'Implementation',
  testing: 'Testing',
  research_development: 'R&D',
  internal_it: 'Internal IT',
  customers: 'Customers',
  meetings: 'Meetings',
  certifications: 'Certifications',
  poc: 'POC',
  presales_support: 'Presales Support',
  other: 'Other',
}

export const TICKET_NUMBER_MAX = 100
export const ACTIVITY_OTHER_MAX = 200

export function isEntryType(v: unknown): v is EntryType {
  return typeof v === 'string' && (ENTRY_TYPES as readonly string[]).includes(v)
}
export function isActivityCode(v: unknown): v is ActivityCode {
  return typeof v === 'string' && (ACTIVITY_CODES as readonly string[]).includes(v)
}
export function isValidActivityForType(type: EntryType, code: ActivityCode): boolean {
  return ACTIVITIES_BY_TYPE[type].includes(code)
}
/** Project selection is required for, and allowed only on, Project entries. */
export function requiresProject(type: EntryType): boolean {
  return type === 'project'
}
export function requiresTicketNumber(type: EntryType, code: ActivityCode): boolean {
  return type === 'support' && code === 'customers'
}
export function requiresActivityOther(type: EntryType, code: ActivityCode): boolean {
  return type === 'internal' && code === 'other'
}
/** Type-qualified activity label for display, e.g. "Project · R&D". */
export function activityDisplayLabel(type: EntryType, code: ActivityCode): string {
  return `${ENTRY_TYPE_LABELS[type]} · ${ACTIVITY_LABELS[code]}`
}

/** Normalized new-format classification carried through domain and persistence. */
export interface NewEntryClassification {
  entryType: EntryType
  activityCode: ActivityCode
  projectId: string | null
  ticketNumber: string | null
  activityOther: string | null
}

/** Shared branch-rule validation for a new-format classification. Adds a
 * field-level issue for every rule the (type, activity, fields) tuple breaks. */
export function refineClassification(
  v: {
    entryType: EntryType
    activityCode: ActivityCode
    projectId?: string | null
    ticketNumber?: string | null
    activityOther?: string | null
  },
  ctx: z.RefinementCtx
): void {
  if (!isValidActivityForType(v.entryType, v.activityCode)) {
    ctx.addIssue({ code: 'custom', path: ['activityCode'], message: 'Activity is not valid for this type.' })
    return
  }
  if (requiresProject(v.entryType)) {
    if (!v.projectId) ctx.addIssue({ code: 'custom', path: ['projectId'], message: 'Project is required.' })
  } else if (v.projectId) {
    ctx.addIssue({ code: 'custom', path: ['projectId'], message: 'Project is only allowed for Project entries.' })
  }
  const ticket = v.ticketNumber?.trim() ?? ''
  if (requiresTicketNumber(v.entryType, v.activityCode)) {
    if (!ticket) ctx.addIssue({ code: 'custom', path: ['ticketNumber'], message: 'Ticket Number is required.' })
    else if (ticket.length > TICKET_NUMBER_MAX)
      ctx.addIssue({ code: 'custom', path: ['ticketNumber'], message: `Ticket Number must be at most ${TICKET_NUMBER_MAX} characters.` })
  } else if (ticket) {
    ctx.addIssue({ code: 'custom', path: ['ticketNumber'], message: 'Ticket Number is not allowed for this activity.' })
  }
  const other = v.activityOther?.trim() ?? ''
  if (requiresActivityOther(v.entryType, v.activityCode)) {
    if (!other) ctx.addIssue({ code: 'custom', path: ['activityOther'], message: 'Other Activity is required.' })
    else if (other.length > ACTIVITY_OTHER_MAX)
      ctx.addIssue({ code: 'custom', path: ['activityOther'], message: `Other Activity must be at most ${ACTIVITY_OTHER_MAX} characters.` })
  } else if (other) {
    ctx.addIssue({ code: 'custom', path: ['activityOther'], message: 'Other Activity is not allowed for this activity.' })
  }
}

/** Normalize a validated classification: null out fields outside their branch,
 * trim the conditional text. Call only on input that passed refineClassification. */
export function normalizeClassification(v: {
  entryType: EntryType
  activityCode: ActivityCode
  projectId?: string | null
  ticketNumber?: string | null
  activityOther?: string | null
}): NewEntryClassification {
  return {
    entryType: v.entryType,
    activityCode: v.activityCode,
    projectId: requiresProject(v.entryType) ? (v.projectId ?? null) : null,
    ticketNumber: requiresTicketNumber(v.entryType, v.activityCode) ? (v.ticketNumber?.trim() ?? null) : null,
    activityOther: requiresActivityOther(v.entryType, v.activityCode) ? (v.activityOther?.trim() ?? null) : null,
  }
}

/** Canonical input schema for creating/editing a NEW-format timesheet entry. */
export const newEntrySchema = z
  .object({
    userId: z.string().optional(),
    entryType: z.enum(ENTRY_TYPES),
    activityCode: z.enum(ACTIVITY_CODES),
    projectId: z.string().min(1).nullish(),
    activityTypeId: z.null().optional(),
    ticketNumber: z.string().trim().max(TICKET_NUMBER_MAX, 'Ticket Number is too long.').nullish(),
    activityOther: z.string().trim().max(ACTIVITY_OTHER_MAX, 'Other Activity is too long.').nullish(),
    hoursWorked: z
      .number({ error: 'Hours must be a number.' })
      .positive('Hours must be greater than zero.')
      .max(24, 'Hours must be at most 24.'),
    workDone: z.string().min(1, 'Work description is required.').max(2000, 'Work description is too long.'),
    logDate: z.string().refine(isValidISODate, { message: 'Invalid date.' }),
  })
  .superRefine((v, ctx) => refineClassification(v, ctx))
  .transform(v => ({ ...v, ...normalizeClassification(v), activityTypeId: null }))

export type NewEntryInput = z.infer<typeof newEntrySchema>

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

/** Both edit formats are accepted at the transport; persisted rows decide which
 * validator applies in the domain. Legacy output retains its exact old shape. */
export const timesheetMutationSchema = z.unknown().transform((input, ctx) => {
  const fields = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const classified = ['entryType', 'activityCode', 'activityOther', 'ticketNumber'].some(key => fields[key] != null)
  const parsed = classified ? newEntrySchema.safeParse(input) : logEntrySchema.safeParse(input)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message })
    return z.NEVER
  }
  return parsed.data
})

/** Query-string schema for the timesheets list endpoint. */
export const TIMESHEET_DEFAULT_PAGE_SIZE = 50
export const TIMESHEET_MAX_PAGE_SIZE = 1000

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
  // Query strings must use literal booleans; coercion would treat "false" as true.
  includeCount: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
}).refine(q => q.to === undefined || q.to >= (q.from ?? 0), {
  message: 'to must be >= from', path: ['to'],
}).transform(q => {
  const from = q.from ?? 0
  // Adapters prioritize inclusive ranges over limit; bound the effective range.
  const requestedTo = q.to ?? Math.min(Number.MAX_SAFE_INTEGER, from + (q.limit ?? TIMESHEET_DEFAULT_PAGE_SIZE) - 1)
  const to = Math.min(requestedTo, from + TIMESHEET_MAX_PAGE_SIZE - 1, Number.MAX_SAFE_INTEGER)
  return { ...q, from, to, limit: to - from + 1 }
})

/** Batch timesheet edit payload schema (bounded at 500 entries). */
// Bulk edit validates field values per row in the domain so one invalid row
// does not suppress valid updates. Only transport structure is checked here.
export const batchUpdateTimesheetsSchema = z.object({
  entries: z.array(z.object({
    id: z.string().min(1, 'ID cannot be empty.'),
    // Legacy rows carry project/activity; new-format rows carry the
    // classification instead. Per-row format is decided in the domain from the
    // stored row, so transport only checks structure.
    projectId: z.string().nullish(),
    activityTypeId: z.string().nullish(),
    entryType: z.enum(ENTRY_TYPES).nullish(),
    activityCode: z.enum(ACTIVITY_CODES).nullish(),
    ticketNumber: z.string().nullish(),
    activityOther: z.string().nullish(),
    hoursWorked: z.number(),
    workDone: z.string(),
    logDate: z.string(),
  })).min(1, 'No entries selected.').max(500, 'Too many entries for one edit (max 500).'),
})

export type BatchUpdateTimesheetItem = z.infer<typeof batchUpdateTimesheetsSchema>['entries'][number]

export interface BatchUpdateTimesheetsResponse {
  updated: number
  errors?: string[]
}

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
  /** Null for new-format Support/Internal entries. */
  project_id: string | null
  project_name?: string
  activity_type_id: string | null
  activity_name?: string | null
  /** Classification v2. Null/absent identifies a historical-format row. */
  entry_type?: EntryType | null
  activity_code?: ActivityCode | null
  activity_other?: string | null
  ticket_number?: string | null
  log_date: string
  hours_worked: number
  work_done: string
  created_at: string
}

/** Input for creating a timesheet entry. */
export interface CreateTimesheetInput {
  userId?: string
  /** Required for legacy and Project entries; null for Support/Internal. */
  projectId?: string | null
  activityTypeId?: string | null
  /** Classification v2 (new-format entries only). */
  entryType?: EntryType | null
  activityCode?: ActivityCode | null
  ticketNumber?: string | null
  activityOther?: string | null
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
  /** 'CLASSIFICATION_REQUIRED' when the source row is a historical-format entry
   * that must be reclassified through a fresh draft before it can be copied. */
  code?: string
}

/** Response for a batch duplicate of timesheet entries. */
export interface BatchDuplicateTimesheetsResponse {
  results: BatchDuplicateResultItem[]
  duplicatedCount: number
}
