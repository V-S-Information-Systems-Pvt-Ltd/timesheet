import 'server-only'

import type { AdminDashboardLayout, DashboardLayout, MobileLayout, WorkspaceBranding } from '@/app/types'
import type { Actor, DbResult, DbWrite, DefaultLayouts } from '@/lib/db/repository'
import type { BackfillSettings } from '@/lib/validation'

/**
 * Narrow persistence port owned by the workspace application module. It exposes
 * only the settings, branding, and layout operations the workspace use cases
 * need, so each backend can implement it without re-exposing the wide
 * compatibility `Repository`.
 *
 * Authorization, super-admin gating, RLS, provider error mapping, and the
 * row-to-DTO mapping stay inside the implementation (native SQL or the
 * request-scoped Supabase client). Branding logo delivery, CSP/SSRF validation,
 * React rendering, native theming, and local preference storage are NOT part of
 * this port: they remain in their platform layers.
 */
export interface WorkspacePersistence {
  // --- app settings (backfill window) ---
  getBackfillWindow(actor: Actor): Promise<BackfillSettings>
  setBackfillWindow(actor: Actor, settings: BackfillSettings): Promise<DbWrite>

  // --- workspace default layouts ---
  getDefaultLayouts(actor: Actor): Promise<DbResult<DefaultLayouts>>
  setDefaultLayouts(actor: Actor, layouts: DefaultLayouts): Promise<DbWrite>

  // --- per-user layouts (own profile row) ---
  getMobileLayout(actor: Actor): Promise<DbResult<MobileLayout | null>>
  setMobileLayout(actor: Actor, layout: MobileLayout | null): Promise<DbWrite>
  setDashboardLayout(actor: Actor, layout: DashboardLayout): Promise<DbWrite>
  setAdminLayout(actor: Actor, layout: AdminDashboardLayout): Promise<DbWrite>

  // --- workspace branding ---
  getBranding(actor?: Actor): Promise<DbResult<WorkspaceBranding>>
  setBranding(actor: Actor, branding: WorkspaceBranding): Promise<DbWrite>
}
