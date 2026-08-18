// tests/layout.test.ts
// Regression tests for the tile-layout resolver: disabled panels must stay
// hidden (not re-added at the bottom), reordering must be respected, and new
// tiles introduced by upgrades must still appear.
import { describe, expect, it } from 'vitest'
import { resolveLayout } from '../lib/layout'
import type { LayoutLike } from '../lib/layout'

const defaults: LayoutLike = {
  tiles: [
    { id: 'a', enabled: true },
    { id: 'b', enabled: true },
    { id: 'c', enabled: true },
  ],
}

describe('resolveLayout', () => {
  it('returns all defaults in order when no layout is saved', () => {
    expect(resolveLayout(null, defaults)).toEqual(['a', 'b', 'c'])
    expect(resolveLayout(undefined, defaults)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a disabled panel hidden instead of re-adding it at the bottom', () => {
    const saved: LayoutLike = {
      tiles: [
        { id: 'a', enabled: true },
        { id: 'b', enabled: true },
        { id: 'c', enabled: false }, // user unchecked it
      ],
    }
    expect(resolveLayout(saved, defaults)).toEqual(['a', 'b'])
  })

  it('respects the saved order', () => {
    const saved: LayoutLike = {
      tiles: [
        { id: 'c', enabled: true },
        { id: 'a', enabled: true },
        { id: 'b', enabled: true },
      ],
    }
    expect(resolveLayout(saved, defaults)).toEqual(['c', 'a', 'b'])
  })

  it('drops unknown tile ids from the saved layout', () => {
    const saved: LayoutLike = {
      tiles: [
        { id: 'a', enabled: true },
        { id: 'ghost', enabled: true },
        { id: 'b', enabled: true },
      ],
    }
    expect(resolveLayout(saved, defaults)).toEqual(['a', 'b', 'c'])
  })

  it('appends a tile introduced by an upgrade (missing from saved layout) at the end', () => {
    const saved: LayoutLike = {
      tiles: [
        { id: 'a', enabled: true },
        { id: 'b', enabled: false }, // disabled before 'c' existed
      ],
    }
    expect(resolveLayout(saved, defaults)).toEqual(['a', 'c'])
  })

  it('does not append default tiles that are disabled by default', () => {
    const withDisabledDefault: LayoutLike = {
      tiles: [
        { id: 'a', enabled: true },
        { id: 'b', enabled: false },
      ],
    }
    const saved: LayoutLike = { tiles: [{ id: 'a', enabled: true }] }
    expect(resolveLayout(saved, withDisabledDefault)).toEqual(['a'])
  })

  it('treats an empty saved tile list as the defaults', () => {
    const empty: LayoutLike = { tiles: [] }
    expect(resolveLayout(empty, defaults)).toEqual(['a', 'b', 'c'])
  })
})