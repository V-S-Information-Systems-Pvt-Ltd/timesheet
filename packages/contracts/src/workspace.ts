import { z } from 'zod'
import type { ActorCapabilities } from './domain'
import type { IdentityProvider } from './identity'

/** Backend value exposed by the mobile configuration endpoint. */
export type MobileBackend = IdentityProvider

/** Mobile modules eligible for home/more placement and custom ordering. */
export type MobileModuleId =
  | 'timesheets'
  | 'log-time'
  | 'reports'
  | 'leaves'
  | 'reminders'
  | 'team'
  | 'profile'
  | 'admin-projects'
  | 'admin-activities'
  | 'admin-users'
  | 'admin-settings'
  | 'admin-leaves'
  | 'admin-reminders'
  | 'admin-reports'

export interface MobileModuleSetting {
  id: MobileModuleId
  enabled: boolean
  placement?: 'home' | 'more'
}

export interface MobileLayout {
  modules: MobileModuleSetting[]
}

export interface MobileLayoutResponse {
  layout: MobileLayout
  savedLayout: MobileLayout | null
  defaultLayout: MobileLayout
  capabilities: ActorCapabilities
}

/** Workspace branding shared by web and mobile renderers. */
export interface WorkspaceBranding {
  appName: string
  primaryColor: string
  logoUrl: string | null
}

/** Backfill-window settings shared by admin transports and browser data code. */
export type BackfillMode = 'days' | 'month_start'

export const backfillSettingsSchema = z.object({
  mode: z.enum(['days', 'month_start']),
  windowDays: z.number().int().nonnegative('Window days must be >= 0'),
  extraDays: z.number().int().nonnegative('Extra days must be >= 0'),
})

export type BackfillSettings = z.infer<typeof backfillSettingsSchema>
