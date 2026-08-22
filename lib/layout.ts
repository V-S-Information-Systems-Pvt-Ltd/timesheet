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
 * Normalizes a saved layout against the defaults:
 *  - Preserves saved tile ordering and enabled states for all known tiles.
 *  - Discards obsolete tiles that no longer exist in defaults.
 *  - Appends newly added tiles from defaults (with their default enabled state).
 */
export function normalizeLayout<T extends LayoutLike>(
  saved: T | null | undefined,
  defaults: T
): T {
  if (!saved || !Array.isArray(saved.tiles)) return defaults
  const known = new Set(defaults.tiles.map((t) => t.id))
  const savedTiles = saved.tiles.filter(
    (t) => known.has(t.id) && typeof t.enabled === 'boolean'
  )
  const seen = new Set(savedTiles.map((t) => t.id))
  const missing = defaults.tiles.filter((t) => !seen.has(t.id))
  return {
    ...defaults,
    tiles: [...savedTiles, ...missing],
  } as T
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
  const normalized = normalizeLayout(saved, defaults)
  return normalized.tiles.filter((t) => t.enabled).map((t) => t.id)
}