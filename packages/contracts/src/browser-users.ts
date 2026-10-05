import { z } from 'zod'

// Cookie administration preserves the narrow browser action semantics rather
// than overloading the broader mobile user's generic patch contract.
const permissionRole = z.enum(['admin', 'pm', 'co', 'user'], { error: 'Invalid permission role.' })
const hierarchyRole = z.enum(['manager', 'team_lead', 'engineer', 'user'], { error: 'Invalid hierarchy role.' })

export const browserCreateUserSchema = z.object({
  email: z.string(),
  password: z.string(),
  name: z.string(),
  department: z.string(),
  title: z.string(),
  permissionRole,
  hierarchyRole,
  isActive: z.boolean(),
  managerId: z.string().nullable().optional(),
}).strict()

export const browserUserMutationSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('toggle-status') }).strict(),
  z.object({ operation: z.literal('roles'), permissionRole, hierarchyRole }).strict(),
  z.object({ operation: z.literal('name'), name: z.string() }).strict(),
  z.object({ operation: z.literal('department'), department: z.string() }).strict(),
  z.object({ operation: z.literal('manager'), managerId: z.string().nullable() }).strict(),
  z.object({
    operation: z.literal('hierarchy'), managerId: z.string().nullable(),
    title: z.string().optional(), hierarchyRole: hierarchyRole.optional(),
  }).strict(),
])

export type BrowserCreateUserInput = z.infer<typeof browserCreateUserSchema>
export type BrowserUserMutation = z.infer<typeof browserUserMutationSchema>
