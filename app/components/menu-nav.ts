// app/components/menu-nav.ts
// Pure keyboard-navigation helper for the Menu primitive. No React/DOM imports,
// so the roving-focus math is unit-testable in the node test environment (the
// same convention as tests/confirm-dialog.test.ts).

/**
 * The next active item index when ArrowDown (+1) or ArrowUp (-1) is pressed in
 * an open menu. Wraps around both ends. From "nothing active" (-1), ArrowDown
 * lands on the first item and ArrowUp on the last. Returns -1 for an empty menu.
 */
export function nextMenuIndex(current: number, length: number, delta: 1 | -1): number {
  if (length <= 0) return -1
  if (current < 0) return delta === 1 ? 0 : length - 1
  return (current + delta + length) % length
}

/** Keep a row menu in the viewport; flip above its trigger near the bottom. */
export function menuPosition(
  anchor: { left: number; right: number; top: number; bottom: number },
  menu: { width: number; height: number },
  viewportWidth: number,
  viewportHeight: number,
  align: 'start' | 'end'
): { left: number; top: number } {
  const margin = 8
  const left = align === 'start' ? anchor.left : anchor.right - menu.width
  const below = anchor.bottom + 4
  const top = below + menu.height <= viewportHeight - margin ? below : anchor.top - menu.height - 4
  return {
    left: Math.max(margin, Math.min(left, viewportWidth - menu.width - margin)),
    top: Math.max(margin, Math.min(top, viewportHeight - menu.height - margin)),
  }
}
