import { describe, expect, it } from 'vitest'
import { deriveWebPalette } from '@/app/components/pulse-theme'
import { DEFAULT_BRANDING, derivePalette, getContrastRatio } from '@/lib/branding'

describe('Timecard web presentation', () => {
  it('uses the shared brand blue with readable action colors', () => {
    const palette = deriveWebPalette(DEFAULT_BRANDING.primaryColor)
    expect(palette.shades[600]).toBe('#1E73BE')
    expect(getContrastRatio(palette.shades[600], palette.onPrimary)).toBeGreaterThanOrEqual(4.5)
    expect(deriveWebPalette(null)).toEqual(palette)
    expect(deriveWebPalette('invalid')).toEqual(palette)
  })

  it('clamps primary text to 4.5:1 on sheet, paper, muted and tint in both modes', () => {
    for (const hex of ['#1E73BE', '#4F46E5', '#0E7490']) {
      const p = deriveWebPalette(hex)
      for (const bg of ['#FFFFFF', '#F3F6F9', '#EDF1F6', p.shades[50]]) {
        expect(getContrastRatio(p.primaryTextLight, bg)).toBeGreaterThanOrEqual(4.5)
      }
      for (const bg of ['#16243B', '#0E1A2E', '#1D2D49']) {
        expect(getContrastRatio(p.primaryTextDark, bg)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('preserves an explicitly customized workspace palette', () => {
    expect(deriveWebPalette('#4F46E5').shades).toEqual(derivePalette('#4F46E5').shades)
  })
})
