// tests/menu-nav.test.ts
// Unit tests for the Menu primitive's roving-focus index math (P0 primitives).
import { describe, expect, it } from 'vitest'
import { menuPosition, nextMenuIndex } from '@/app/components/menu-nav'

describe('nextMenuIndex', () => {
  it('returns -1 for an empty menu regardless of direction', () => {
    expect(nextMenuIndex(-1, 0, 1)).toBe(-1)
    expect(nextMenuIndex(0, 0, -1)).toBe(-1)
  })

  it('moves from no-selection (-1) to the first item on ArrowDown and the last on ArrowUp', () => {
    expect(nextMenuIndex(-1, 3, 1)).toBe(0)
    expect(nextMenuIndex(-1, 3, -1)).toBe(2)
  })

  it('advances and retreats within range', () => {
    expect(nextMenuIndex(0, 3, 1)).toBe(1)
    expect(nextMenuIndex(1, 3, 1)).toBe(2)
    expect(nextMenuIndex(2, 3, -1)).toBe(1)
  })

  it('wraps around both ends', () => {
    expect(nextMenuIndex(2, 3, 1)).toBe(0)
    expect(nextMenuIndex(0, 3, -1)).toBe(2)
  })

  it('handles a single-item menu', () => {
    expect(nextMenuIndex(0, 1, 1)).toBe(0)
    expect(nextMenuIndex(0, 1, -1)).toBe(0)
  })
})

describe('menuPosition', () => {
  const menu = { width: 176, height: 180 }

  it('aligns below the trigger when space is available', () => {
    const anchor = { left: 200, right: 240, top: 100, bottom: 140 }
    expect(menuPosition(anchor, menu, 375, 812, 'end')).toEqual({ left: 64, top: 144 })
    expect(menuPosition(anchor, menu, 1024, 812, 'start')).toEqual({ left: 200, top: 144 })
  })

  it('flips above a trigger near the viewport bottom', () => {
    const anchor = { left: 300, right: 340, top: 700, bottom: 740 }
    expect(menuPosition(anchor, menu, 375, 812, 'end')).toEqual({ left: 164, top: 516 })
  })

  it('clamps offscreen and oversized anchors to the viewport margins', () => {
    expect(menuPosition({ left: -100, right: -60, top: 0, bottom: 40 }, menu, 320, 200, 'end')).toEqual({ left: 8, top: 8 })
    expect(menuPosition({ left: 400, right: 440, top: 300, bottom: 340 }, menu, 320, 400, 'start')).toEqual({ left: 136, top: 116 })
  })
})
