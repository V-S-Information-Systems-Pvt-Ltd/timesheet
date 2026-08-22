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
