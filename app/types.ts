// app/types.ts
// Application-facing types derived from the generated Supabase Database
// types (lib/supabase/database.types.ts), plus the embedded-relation shapes
// returned by joined queries like `timesheets, projects(name), profiles(email)`.

import type { Database } from '@/lib/supabase/database.types'

export type UserRole = Database['public']['Tables']['profiles']['Row']['role']

export type User = Database['public']['Tables']['profiles']['Row']

export type Project = Database['public']['Tables']['projects']['Row']

/** Base timesheet row (no joins). */
export type TimesheetRow = Database['public']['Tables']['timesheets']['Row']

/** Timesheet row plus the embedded project/user fields used across the UI. */
export interface Timesheet extends TimesheetRow {
  projects?: Pick<Project, 'name'> | null
  profiles?: Pick<User, 'email'> | null
}

export type LeaveEntry = Database['public']['Tables']['leaves']['Row']

export type Reminder = Database['public']['Tables']['reminders']['Row']
