// app/actions/settings.ts
// Server Actions for activity types, reminders, backfill window, layouts, and titles.
'use server'

import { isNonEmpty } from '@/lib/validation'
import { revalidatePath } from 'next/cache'
import type { BackfillSettings } from '@/lib/validation'
import { workspaceDeps } from '@/lib/db/workspace'
import { referenceDeps } from '@/lib/db/reference'
import {
  createActivityType as createActivityTypeDomain,
  listTitleRecords as listTitleRecordsDomain,
  listTitles as listTitlesDomain,
  renameActivityType as renameActivityTypeDomain,
  setActivityTypeActive as setActivityTypeActiveDomain,
  setActivityTypeTelegramNo as setActivityTypeTelegramNoDomain,
} from '@/lib/domain/reference'
import { DEFAULT_BRANDING } from '@/lib/branding'
import type { AdminDashboardLayout, DashboardLayout, TitleRecord, WorkspaceBranding } from '@/app/types'
import { type ActionResult, requireActiveActor, requireActor, requireSuperAdmin } from './_shared'
import {
  setBackfillSettings,
  getDefaultLayouts as getDefaultLayoutsDomain,
  saveDashboardLayout as saveDashboardLayoutDomain,
  saveAdminLayout as saveAdminLayoutDomain,
  getWorkspaceBranding,
  saveWorkspaceBranding,
  resetWorkspaceBranding,
} from '@/lib/domain/workspace'
import { leaveReminderDeps } from '@/lib/db/leave-reminders'
import {
  createGlobalReminder,
  deleteGlobalReminder as deleteGlobalReminderDomain,
  dismissGlobalReminder as dismissGlobalReminderDomain,
} from '@/lib/domain/leave-reminders'

// --- activity types ---

export async function addActivityType(name: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await createActivityTypeDomain(gate.actor, { name }, referenceDeps())
  return result.ok ? {} : { error: result.error.message }
}

export async function renameActivityType(id: string, name: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await renameActivityTypeDomain(gate.actor, id, name, referenceDeps())
  return result.ok ? {} : { error: result.error.message }
}

export async function setActivityTypeActive(id: string, isActive: boolean): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await setActivityTypeActiveDomain(gate.actor, id, isActive, referenceDeps())
  return result.ok ? {} : { error: result.error.message }
}

/** Admin: set (or clear) the Telegram bot number for an activity type. */
export async function setActivityTypeTelegramNo(
  id: string,
  telegramNo: number | null
): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await setActivityTypeTelegramNoDomain(gate.actor, id, telegramNo, referenceDeps())
  return result.ok ? {} : { error: result.error.message }
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

  const result = await createGlobalReminder(
    gate.actor,
    { message: input.message.trim(), remindAt: remindAt.toISOString() },
    leaveReminderDeps()
  )
  return result.ok ? {} : { error: result.error.message }
}

export async function deleteGlobalReminder(id: string): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await deleteGlobalReminderDomain(gate.actor, id, leaveReminderDeps())
  return result.ok ? {} : { error: result.error.message }
}

export async function dismissGlobalReminder(reminderId: string): Promise<ActionResult> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }

  const result = await dismissGlobalReminderDomain(gate.actor, reminderId, leaveReminderDeps())
  return result.ok ? {} : { error: result.error.message }
}

/**
 * Set the app-wide backfill window. Admin only.
 */
export async function setBackfillWindow(settings: BackfillSettings): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await setBackfillSettings(gate.actor, settings, workspaceDeps())
  return result.ok ? {} : { error: result.error.message }
}

// --- dashboard layout (own profile) ---

/** Save the current user's dashboard tile order/visibility. */
export async function saveDashboardLayout(layout: DashboardLayout): Promise<ActionResult> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }

  const result = await saveDashboardLayoutDomain(gate.actor, layout, workspaceDeps())
  return result.ok ? {} : { error: result.error.message }
}

/** Save the current user's admin-panel tile order/visibility. */
export async function saveAdminLayout(layout: AdminDashboardLayout): Promise<ActionResult> {
  const gate = await requireActor(['admin'])
  if ('error' in gate) return { error: gate.error }

  const result = await saveAdminLayoutDomain(gate.actor, layout, workspaceDeps())
  return result.ok ? {} : { error: result.error.message }
}

/** Read the global default panel order (any active signed-in user). */
export async function getDefaultLayouts(): Promise<
  { dashboard: DashboardLayout; admin: AdminDashboardLayout } | { error: string }
> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { error: gate.error }

  try {
    const result = await getDefaultLayoutsDomain(gate.actor, workspaceDeps())
    if (!result.ok) {
      return { error: result.error.message }
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
    const result = await listTitlesDomain(gate.actor, referenceDeps())
    if (!result.ok) return { titles: [], error: result.error.message }
    return { titles: result.data }
  } catch (err) {
    return { titles: [], error: err instanceof Error ? err.message : 'Failed to fetch titles.' }
  }
}

export async function getTitleRecords(): Promise<{ titles: TitleRecord[]; error?: string }> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { titles: [], error: gate.error }

  try {
    const result = await listTitleRecordsDomain(gate.actor, referenceDeps())
    if (!result.ok) return { titles: [], error: result.error.message }
    return { titles: result.data }
  } catch (err) {
    return { titles: [], error: err instanceof Error ? err.message : 'Failed to fetch title records.' }
  }
}

// --- workspace branding ---

export async function getBranding(): Promise<{ branding: WorkspaceBranding; error?: string }> {
  const gate = await requireActiveActor()
  if ('error' in gate) return { branding: DEFAULT_BRANDING, error: gate.error }

  const result = await getWorkspaceBranding(gate.actor, workspaceDeps())
  if (!result.ok) {
    return { branding: DEFAULT_BRANDING, error: result.error.message }
  }
  return { branding: result.data }
}

export async function saveBranding(input: unknown): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: gate.error }

  const result = await saveWorkspaceBranding(gate.actor, input, workspaceDeps())
  if (!result.ok) {
    if (result.error.code === 'VALIDATION_ERROR') {
      const firstError = result.error.fieldErrors
        ? Object.values(result.error.fieldErrors)[0]
        : 'Invalid branding input.'
      return { error: firstError ?? result.error.message }
    }
    return { error: result.error.message }
  }

  revalidatePath('/', 'layout')
  return {}
}

export async function resetBranding(): Promise<ActionResult> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: gate.error }

  const result = await resetWorkspaceBranding(gate.actor, workspaceDeps())
  if (!result.ok) return { error: result.error.message }

  revalidatePath('/', 'layout')
  return {}
}
