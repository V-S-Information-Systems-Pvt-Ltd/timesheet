// lib/layout.ts
// Pure helper that resolves a saved tile layout into the visible, ordered
// tile ids. Shared by the user dashboard and the admin panel.

export interface TileSettingLike {
  id: string
  enabled: boolean
}

export interface LayoutLike {
  tiles: TileSettingLike[]
}

/**
 * Resolve which tiles to render and in what order.
 *
 * - Tiles present in the saved layout keep their order; known ids only;
 *   disabled entries stay hidden (they are NOT re-added at the bottom).
 * - Tiles entirely absent from the saved layout (e.g. panels introduced in a
 *   later upgrade) are appended at the end, enabled, so upgrades never hide
 *   new panels.
 * - A null/empty saved layout falls back to the defaults.
 */
export function resolveLayout(
  saved: LayoutLike | null | undefined,
  defaults: LayoutLike
): string[] {
  const known = new Set(defaults.tiles.map(t => t.id))
  const savedTiles = (saved?.tiles ?? []).filter(t => known.has(t.id) && typeof t.enabled === 'boolean')
  const seen = new Set(savedTiles.map(t => t.id))
  const visible = savedTiles.filter(t => t.enabled).map(t => t.id)
  const added = defaults.tiles.filter(t => t.enabled && !seen.has(t.id)).map(t => t.id)
  return [...visible, ...added]
}

/**
 * Guarantee `tileId` is present and enabled in a layout. Used for role-gated
 * panels (e.g. the Super Admin panel) whose destructive controls must never be
 * hidden by a customizable saved/default layout. If the tile is already present
 * and enabled it keeps its position; otherwise it is appended, enforced-on.
 */
export function forceTileEnabled<TId extends string>(
  layout: { tiles: { id: TId; enabled: boolean }[] } | null | undefined,
  tileId: TId
): { tiles: { id: TId; enabled: boolean }[] } {
  const tiles = layout?.tiles ?? []
  if (tiles.some(t => t.id === tileId && t.enabled)) {
    return { tiles }
  }
  return { tiles: [...tiles.filter(t => t.id !== tileId), { id: tileId, enabled: true }] }
}

import type { MobileLayout, MobileModuleId, MobileModuleSetting } from '@/app/types'
import type { ActorCapabilities } from '@/lib/roles'

export const ESSENTIAL_MOBILE_MODULES: readonly MobileModuleId[] = ['log-time', 'timesheets', 'profile']

export const MODULE_CAPABILITY_REQUIREMENTS: Partial<Record<MobileModuleId, keyof ActorCapabilities>> = {
  team: 'canViewTeam',
  'admin-projects': 'canManageProjects',
  'admin-activities': 'canManageActivities',
  'admin-users': 'canManageUsers',
  'admin-settings': 'canManageSettings',
  'admin-leaves': 'canManageSettings',
  'admin-reminders': 'canManageSettings',
  'admin-reports': 'canManageSettings',
}

export const DEFAULT_MOBILE_LAYOUT: MobileLayout = {
  modules: [
    { id: 'log-time', enabled: true, placement: 'home' },
    { id: 'timesheets', enabled: true, placement: 'home' },
    { id: 'reports', enabled: true, placement: 'home' },
    { id: 'leaves', enabled: true, placement: 'home' },
    { id: 'reminders', enabled: true, placement: 'more' },
    { id: 'team', enabled: true, placement: 'more' },
    { id: 'profile', enabled: true, placement: 'more' },
    { id: 'admin-projects', enabled: true, placement: 'more' },
    { id: 'admin-activities', enabled: true, placement: 'more' },
    { id: 'admin-users', enabled: true, placement: 'more' },
    { id: 'admin-settings', enabled: true, placement: 'more' },
    { id: 'admin-leaves', enabled: true, placement: 'more' },
    { id: 'admin-reminders', enabled: true, placement: 'more' },
    { id: 'admin-reports', enabled: true, placement: 'more' },
  ],
}

/**
 * Resolves effective mobile layout by:
 * 1. Filtering by known module IDs and valid enabled/placement structure.
 * 2. Merging missing default modules.
 * 3. Enforcing essential modules (log-time, timesheets, profile) to be present and enabled.
 * 4. Filtering out modules the actor lacks capabilities for.
 */
export function resolveMobileLayout(
  saved: MobileLayout | null | undefined,
  defaults: MobileLayout = DEFAULT_MOBILE_LAYOUT,
  capabilities?: ActorCapabilities | null
): MobileLayout {
  const defaultMap = new Map(defaults.modules.map(m => [m.id, m]))
  const savedModules: MobileModuleSetting[] = []
  const seen = new Set<MobileModuleId>()

  for (const m of saved?.modules ?? []) {
    if (defaultMap.has(m.id) && !seen.has(m.id)) {
      seen.add(m.id)
      const def = defaultMap.get(m.id)!
      const isEssential = ESSENTIAL_MOBILE_MODULES.includes(m.id)
      savedModules.push({
        id: m.id,
        enabled: isEssential ? true : Boolean(m.enabled),
        placement: m.placement === 'home' || m.placement === 'more' ? m.placement : def.placement ?? 'more',
      })
    }
  }

  // Append any default modules not present in saved layout
  for (const def of defaults.modules) {
    if (!seen.has(def.id)) {
      seen.add(def.id)
      savedModules.push({ ...def })
    }
  }

  // Filter modules by actor capabilities
  const filteredModules = savedModules.filter(m => {
    const req = MODULE_CAPABILITY_REQUIREMENTS[m.id]
    if (!req) return true
    if (!capabilities) return false
    return Boolean(capabilities[req])
  })

  return { modules: filteredModules }
}

