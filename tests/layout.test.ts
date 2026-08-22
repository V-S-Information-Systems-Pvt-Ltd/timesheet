// tests/layout.test.ts
// Regression tests for the tile-layout resolver: disabled panels must stay
// hidden (not re-added at the bottom), reordering must be respected, and new
// tiles introduced by upgrades must still appear.
import { describe, expect, it } from 'vitest'
import { forceTileEnabled, resolveLayout } from '../lib/layout'
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

describe('forceTileEnabled', () => {
  it('does nothing when the tile is already present and enabled (keeps its position)', () => {
    const layout: LayoutLike = {
      tiles: [
        { id: 'a', enabled: true },
        { id: 'super-admin', enabled: true },
        { id: 'b', enabled: false },
      ],
    }
    expect(forceTileEnabled(layout, 'super-admin')).toEqual(layout)
  })

  it('appends the tile enforced-on when it is disabled by default', () => {
    const layout: LayoutLike = {
      tiles: [
        { id: 'a', enabled: true },
        { id: 'super-admin', enabled: false }, // e.g. a group default that disabled it
      ],
    }
    expect(forceTileEnabled(layout, 'super-admin')).toEqual({
      tiles: [
        { id: 'a', enabled: true },
        { id: 'super-admin', enabled: true },
      ],
    })
  })

  it('appends the tile when it is entirely missing from the layout', () => {
    const layout: LayoutLike = { tiles: [{ id: 'a', enabled: true }] }
    expect(forceTileEnabled(layout, 'super-admin')).toEqual({
      tiles: [
        { id: 'a', enabled: true },
        { id: 'super-admin', enabled: true },
      ],
    })
  })

  it('handles a null/undefined layout', () => {
    expect(forceTileEnabled(null, 'super-admin')).toEqual({
      tiles: [{ id: 'super-admin', enabled: true }],
    })
    expect(forceTileEnabled(undefined, 'super-admin')).toEqual({
      tiles: [{ id: 'super-admin', enabled: true }],
    })
  })

  it('combined with resolveLayout, a disabled super-admin default still renders for a super admin', () => {
    // Simulate the real bug: saved per-user layout omits super-admin, and the
    // group default has it disabled. Forcing it on in the defaults makes the
    // resolver re-add it.
    const saved: LayoutLike = {
      tiles: [
        { id: 'a', enabled: true },
        { id: 'b', enabled: true },
      ],
    }
    const defaultsDisabled: LayoutLike = {
      tiles: [
        { id: 'a', enabled: true },
        { id: 'b', enabled: true },
        { id: 'super-admin', enabled: false },
      ],
    }
    const enforced = forceTileEnabled(defaultsDisabled, 'super-admin')
    expect(resolveLayout(saved, enforced)).toEqual(['a', 'b', 'super-admin'])
  })

  it('overrides an explicitly disabled saved super-admin tile', () => {
    const saved: LayoutLike = {
      tiles: [
        { id: 'a', enabled: true },
        { id: 'super-admin', enabled: false },
      ],
    }
    const defaults: LayoutLike = {
      tiles: [
        { id: 'a', enabled: true },
        { id: 'super-admin', enabled: true },
      ],
    }
    expect(resolveLayout(forceTileEnabled(saved, 'super-admin'), defaults)).toEqual(['a', 'super-admin'])
  })
})
