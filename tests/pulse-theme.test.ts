import { describe, expect, it } from 'vitest'
import { deriveWebPalette } from '@/app/components/pulse-theme'
import { DEFAULT_BRANDING, derivePalette, getContrastRatio } from '@/lib/branding'

describe('Pulse web presentation', () => {
  it('adapts built-in branding with readable action and navigation colors', () => {
    const palette = deriveWebPalette(DEFAULT_BRANDING.primaryColor)
    expect(palette.shades[500]).toBe('#00A76F')
    expect(getContrastRatio(palette.shades[600], palette.onPrimary)).toBeGreaterThanOrEqual(4.5)
    expect(getContrastRatio(palette.shades[700], palette.shades[50])).toBeGreaterThanOrEqual(4.5)
    expect(deriveWebPalette(null)).toEqual(palette)
    expect(deriveWebPalette('invalid')).toEqual(palette)
  })

  it('preserves an explicitly customized workspace palette', () => {
    expect(deriveWebPalette('#4F46E5')).toEqual(derivePalette('#4F46E5'))
    expect(DEFAULT_BRANDING.primaryColor).toBe('#1E73BE')
  })
})
