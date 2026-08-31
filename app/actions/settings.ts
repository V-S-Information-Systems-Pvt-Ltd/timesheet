// app/actions/settings.ts
// Server Actions for activity types, reminders, backfill window, layouts, and titles.
'use server'

import { isNonEmpty } from '@/lib/validation'
import type { BackfillSettings } from '@/lib/validation'
import { ADMIN_TILE_IDS, TILE_IDS } from '@/app/constants'
import { repo } from '@/lib/db'
import type { AdminDashboardLayout, DashboardLayout, TitleRecord } from '@/app/types'
import { type ActionResult, requireActiveActor, requireActor, requireSuperAdmin, isSuperAdmin } from './_shared'

// --- activity types ---

export async function addActivityType(name: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  if (!isNonEmpty(name)) return { error: 'Activity type name is required.' }

  const result = await repo.createActivityType(gate.actor, name.trim())
  return result.error ? { error: result.error } : {}
}

export async function renameActivityType(id: string, name: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  if (!isNonEmpty(name)) return { error: 'Activity type name is required.' }

  const result = await repo.renameActivityType(gate.actor, id, name.trim())
  return result.error ? { error: result.error } : {}
}

export async function setActivityTypeActive(id: string, isActive: boolean): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await repo.setActivityTypeActive(gate.actor, id, isActive)
  return result.error ? { error: result.error } : {}
}

/** Admin: set (or clear) the Telegram bot number for an activity type. */
export async function setActivityTypeTelegramNo(
  id: string,
  telegramNo: number | null
): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  if (telegramNo !== null && (!Number.isInteger(telegramNo) || telegramNo <= 0)) {
    return { error: 'Bot number must be a positive whole number.' }
  }

  const result = await repo.setActivityTypeTelegramNo(gate.actor, id, telegramNo)
  return result.error ? { error: result.error } : {}
}

// --- global reminders ---

export async function addGlobalReminder(input: {
  message: string
  remindAt: string
}): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  if (!isNonEmpty(input.message) || !isNonEmpty(input.remindAt)) {
    return { error: 'Message and time are required.' }
  }
  const remindAt = new Date(input.remindAt)
  if (Number.isNaN(remindAt.getTime())) {
    return { error: 'Invalid reminder time.' }
  }

  const result = await repo.createGlobalReminder(gate.actor, {
    message: input.message.trim(),
    remindAt: remindAt.toISOString(),
  })
  return result.error ? { error: result.error } : {}
}

export async function deleteGlobalReminder(id: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await repo.deleteGlobalReminder(gate.actor, id)
  return result.error ? { error: result.error } : {}
}

export async function dismissGlobalReminder(reminderId: string): Promise<ActionResult> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }

  const result = await repo.dismissGlobalReminder(gate.actor, reminderId)
  return result.error ? { error: result.error } : {}
}

/**
 * Set the app-wide backfill window. Admin only.
 */
export async function setBackfillWindow(settings: BackfillSettings): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  if (settings.mode !== 'days' && settings.mode !== 'month_start') {
    return { error: 'Invalid backfill mode.' }
  }
  if (!Number.isInteger(settings.windowDays) || settings.windowDays < 0 || settings.windowDays > 365) {
    return { error: 'Days window must be a whole number between 0 and 365.' }
  }
  if (!Number.isInteger(settings.extraDays) || settings.extraDays < 0 || settings.extraDays > 365) {
    return { error: 'Extra days must be a whole number between 0 and 365.' }
  }

  const result = await repo.setBackfillWindow(gate.actor, settings)
  return result.error ? { error: result.error } : {}
}

// --- dashboard layout (own profile) ---

/** Save the current user's dashboard tile order/visibility. */
export async function saveDashboardLayout(layout: DashboardLayout): Promise<ActionResult> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  const tiles = layout?.tiles
  const known = new Set<string>(TILE_IDS)
  const seen = new Set<string>()
  const valid =
    Array.isArray(tiles) &&
    tiles.length === known.size &&
    tiles.every(t => !!t && known.has(t.id) && !seen.has(t.id) && typeof t.enabled === 'boolean' && (seen.add(t.id), true))
  if (!valid) return { error: 'Invalid layout.' }

  const result = await repo.setDashboardLayout(actor, layout)
  return result.error ? { error: result.error } : {}
}

/** Save the current user's admin-panel tile order/visibility. */
export async function saveAdminLayout(layout: AdminDashboardLayout): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }
  const actor = gate.actor

  // The Super Admin tile is reserved for the configured super-admin: strip it
  // from the payload for everyone else so it never reaches the database.
  const allowed = isSuperAdmin(actor)
    ? ADMIN_TILE_IDS
    : ADMIN_TILE_IDS.filter(id => id !== 'super-admin')
  const tiles = (layout?.tiles ?? []).filter(
    t => !!t && (allowed as string[]).includes(t.id)
  )
  const known = new Set<string>(allowed)
  const seen = new Set<string>()
  const valid =
    Array.isArray(tiles) &&
    tiles.length === known.size &&
    tiles.every(t => !!t && known.has(t.id) && !seen.has(t.id) && typeof t.enabled === 'boolean' && (seen.add(t.id), true))
  if (!valid) return { error: 'Invalid layout.' }

  const result = await repo.setAdminLayout(actor, { tiles })
  return result.error ? { error: result.error } : {}
}

/** Read the global default panel order (any active signed-in user). */
export async function getDefaultLayouts(): Promise<
  { dashboard: DashboardLayout; admin: AdminDashboardLayout } | { error: string }
> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }

  try {
    const result = await repo.getDefaultLayouts(gate.actor)
    if (result.error || !result.data) {
      return { error: result.error ?? 'Could not load default panel layouts.' }
    }
    return result.data
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not load default panel layouts.' }
  }
}

// --- titles lookup (any active signed-in user) ---

export async function getTitles(): Promise<{ titles: string[]; error?: string }> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { titles: [], error: gate.error }

  try {
    const titles = await repo.listTitles()
    return { titles }
  } catch (err) {
    return { titles: [], error: err instanceof Error ? err.message : 'Failed to fetch titles.' }
  }
}

export async function getTitleRecords(): Promise<{ titles: TitleRecord[]; error?: string }> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { titles: [], error: gate.error }

  try {
    const titles = await repo.listTitleRecords()
    return { titles }
  } catch (err) {
    return { titles: [], error: err instanceof Error ? err.message : 'Failed to fetch title records.' }
  }
}

// --- workspace branding ---

import { DEFAULT_BRANDING, validateBranding } from '@/lib/branding'
import type { WorkspaceBranding } from '@/app/types'

export async function getBranding(): Promise<{ branding: WorkspaceBranding; error?: string }> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { branding: DEFAULT_BRANDING, error: gate.error }

  try {
    const res = await repo.getBranding(gate.actor)
    return { branding: res.data ?? DEFAULT_BRANDING, error: res.error ?? undefined }
  } catch (err) {
    return {
      branding: DEFAULT_BRANDING,
      error: err instanceof Error ? err.message : 'Failed to load branding.',
    }
  }
}

export async function saveBranding(input: unknown): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: gate.error }

  const validation = validateBranding(input)
  if (!validation.valid || !validation.data) {
    const firstError = validation.errors ? Object.values(validation.errors)[0] : 'Invalid branding input.'
    return { error: firstError }
  }

  const result = await repo.setBranding(gate.actor, validation.data)
  return result.error ? { error: result.error } : {}
}

export async function resetBranding(): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: gate.error }

  const result = await repo.setBranding(gate.actor, DEFAULT_BRANDING)
  return result.error ? { error: result.error } : {}
}
