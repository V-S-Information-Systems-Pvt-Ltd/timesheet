import { z } from 'zod'

export const browserActivityTypeCreateSchema = z.object({
  name: z.string(),
}).strict()

export const browserActivityTypeMutationSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('rename'), name: z.string() }).strict(),
  z.object({ operation: z.literal('active'), isActive: z.boolean() }).strict(),
  z.object({ operation: z.literal('telegram'), telegramNo: z.number().nullable() }).strict(),
])

export const browserGlobalReminderCreateSchema = z.object({
  message: z.string(),
  remindAt: z.string(),
}).strict()

const browserLayoutSchema = z.object({
  tiles: z.array(z.object({ id: z.string(), enabled: z.boolean() }).strict()),
}).strict()

export const browserLayoutMutationSchema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('dashboard'), layout: browserLayoutSchema }).strict(),
  z.object({ target: z.literal('admin'), layout: browserLayoutSchema }).strict(),
])

export const browserDefaultLayoutsSchema = z.object({
  dashboard: browserLayoutSchema,
  admin: browserLayoutSchema,
}).strict()

const hierarchyRoleSchema = z.enum(['manager', 'team_lead', 'engineer', 'user'])

export const browserSuperadminResetSchema = z.object({
  mode: z.enum(['timesheets', 'activity', 'all']),
}).strict()

export const browserWhitelistedDomainCreateSchema = z.object({
  domain: z.string(),
  autoActivate: z.boolean(),
}).strict()

export const browserWhitelistedDomainUpdateSchema = z.object({
  autoActivate: z.boolean(),
}).strict()

export const browserTitleCreateSchema = z.object({
  name: z.string(),
  hierarchyRole: hierarchyRoleSchema.default('user'),
}).strict()

export const browserTitleReclassifySchema = z.object({
  name: z.string(),
  hierarchyRole: hierarchyRoleSchema,
  syncUsers: z.boolean().default(false),
}).strict()

export const csvTimesheetRowSchema = z.object({
  email: z.string(),
  logDate: z.string(),
  project: z.string(),
  activityType: z.string(),
  hours: z.string(),
  workDone: z.string(),
}).strict()

export const browserTimesheetImportSchema = z.object({
  rows: z.array(csvTimesheetRowSchema),
}).strict()

export type BrowserActivityTypeCreateInput = z.infer<typeof browserActivityTypeCreateSchema>
export type BrowserActivityTypeMutation = z.infer<typeof browserActivityTypeMutationSchema>
export type BrowserGlobalReminderCreateInput = z.infer<typeof browserGlobalReminderCreateSchema>
export type BrowserLayoutMutation = z.infer<typeof browserLayoutMutationSchema>
export type BrowserDefaultLayoutsInput = z.infer<typeof browserDefaultLayoutsSchema>
export type BrowserSuperadminResetInput = z.infer<typeof browserSuperadminResetSchema>
export type BrowserWhitelistedDomainCreateInput = z.infer<typeof browserWhitelistedDomainCreateSchema>
export type BrowserWhitelistedDomainUpdateInput = z.infer<typeof browserWhitelistedDomainUpdateSchema>
export type BrowserTitleCreateInput = z.infer<typeof browserTitleCreateSchema>
export type BrowserTitleReclassifyInput = z.infer<typeof browserTitleReclassifySchema>
export type CsvTimesheetRow = z.infer<typeof csvTimesheetRowSchema>
export type BrowserTimesheetImportInput = z.infer<typeof browserTimesheetImportSchema>
