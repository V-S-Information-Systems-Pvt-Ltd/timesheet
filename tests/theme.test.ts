import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { parseTheme, THEME_INIT_SCRIPT } from '@/app/components/theme'

function resolveBeforePaint(cookie: string, osDark: boolean) {
  let dark = false
  runInNewContext(THEME_INIT_SCRIPT, {
    document: { cookie, documentElement: { classList: { toggle: (name: string, enabled: boolean) => { if (name === 'dark') dark = enabled } } } },
    window: { matchMedia: () => ({ matches: osDark }) },
  })
  return dark
}

describe('saved theme and pre-paint resolution', () => {
  it('accepts explicit light/dark and treats missing or invalid preferences as system', () => {
    expect(parseTheme('dark')).toBe('dark')
    expect(parseTheme('light')).toBe('light')
    for (const value of [undefined, '', 'system', 'unknown']) expect(parseTheme(value)).toBe('system')
  })

  it('respects explicit preferences even when the OS disagrees', () => {
    expect(resolveBeforePaint('theme=dark', false)).toBe(true)
    expect(resolveBeforePaint('other=1; theme=light', true)).toBe(false)
  })

  it('follows the OS for system, missing, and invalid preferences', () => {
    for (const cookie of ['', 'theme=system', 'theme=invalid']) {
      expect(resolveBeforePaint(cookie, true)).toBe(true)
      expect(resolveBeforePaint(cookie, false)).toBe(false)
    }
  })

  it('handles malformed cookies without interrupting page rendering', () => {
    expect(() => resolveBeforePaint('theme=%broken', true)).not.toThrow()
  })
})
