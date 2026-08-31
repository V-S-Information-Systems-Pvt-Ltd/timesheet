import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BRANDING,
  getContrastRatio,
  getRelativeLuminance,
  isAccessiblePrimaryColor,
  normalizeBranding,
  validateBranding,
} from '../lib/branding'

describe('lib/branding', () => {
  it('calculates accurate relative luminance and contrast ratio', () => {
    const whiteLum = getRelativeLuminance('#FFFFFF')
    const blackLum = getRelativeLuminance('#000000')
    expect(whiteLum).toBeCloseTo(1.0, 2)
    expect(blackLum).toBeCloseTo(0.0, 2)

    const whiteBlackContrast = getContrastRatio('#FFFFFF', '#000000')
    expect(whiteBlackContrast).toBeCloseTo(21.0, 1)

    const vsisBlueContrast = getContrastRatio('#1E73BE', '#FFFFFF')
    expect(vsisBlueContrast).toBeGreaterThan(4.5)
  })

  it('validates primary color accessibility contrast', () => {
    // Accessible colors
    expect(isAccessiblePrimaryColor('#1E73BE')).toBe(true) // VSIS Blue
    expect(isAccessiblePrimaryColor('#4F46E5')).toBe(true) // Indigo 600
    expect(isAccessiblePrimaryColor('#0D9488')).toBe(true) // Teal 600
    expect(isAccessiblePrimaryColor('#DC2626')).toBe(true) // Red 600

    // Inaccessible colors
    expect(isAccessiblePrimaryColor('#FFFFFF')).toBe(false) // Pure white (no contrast on white text)
    expect(isAccessiblePrimaryColor('#FFFF00')).toBe(false) // Pure yellow (fails contrast on white text)
    expect(isAccessiblePrimaryColor('#000000')).toBe(false) // Pure black (fails contrast on dark theme bg)
    expect(isAccessiblePrimaryColor('#0F172A')).toBe(false) // Slate 900 (invisible on dark theme bg)
    expect(isAccessiblePrimaryColor('invalid-hex')).toBe(false)
  })

  it('validates app name, primary color, and logo URL', () => {
    const valid = validateBranding({
      appName: 'Acme Timesheet',
      primaryColor: '#0D9488',
      logoUrl: 'https://example.com/logo.png',
    })
    expect(valid.valid).toBe(true)
    expect(valid.data).toEqual({
      appName: 'Acme Timesheet',
      primaryColor: '#0D9488',
      logoUrl: 'https://example.com/logo.png',
    })
  })

  it('rejects empty or overlong app name', () => {
    const emptyName = validateBranding({ appName: '   ' })
    expect(emptyName.valid).toBe(false)
    expect(emptyName.errors?.appName).toBeDefined()

    const longName = validateBranding({ appName: 'a'.repeat(51) })
    expect(longName.valid).toBe(false)
    expect(longName.errors?.appName).toBeDefined()
  })

  it('rejects invalid or inaccessible primary colors', () => {
    const invalidHex = validateBranding({ primaryColor: '#12345' })
    expect(invalidHex.valid).toBe(false)
    expect(invalidHex.errors?.primaryColor).toBeDefined()

    const inaccessibleColor = validateBranding({ primaryColor: '#FFFF00' })
    expect(inaccessibleColor.valid).toBe(false)
    expect(inaccessibleColor.errors?.primaryColor).toContain('contrast')
  })

  it('rejects non-HTTPS and overlong logo URLs', () => {
    const httpUrl = validateBranding({ logoUrl: 'http://insecure.example.com/logo.png' })
    expect(httpUrl.valid).toBe(false)
    expect(httpUrl.errors?.logoUrl).toContain('HTTPS')

    const longUrl = validateBranding({ logoUrl: 'https://example.com/' + 'a'.repeat(2050) })
    expect(longUrl.valid).toBe(false)
    expect(longUrl.errors?.logoUrl).toBeDefined()
  })

  it('normalizes raw data with fallback to defaults', () => {
    expect(normalizeBranding(null)).toEqual(DEFAULT_BRANDING)
    expect(
      normalizeBranding({
        app_name: 'Custom',
        primary_color: '#4F46E5',
        logo_url: 'https://cdn.example.com/logo.png',
      })
    ).toEqual({
      appName: 'Custom',
      primaryColor: '#4F46E5',
      logoUrl: 'https://cdn.example.com/logo.png',
    })

    // Strips invalid non-HTTPS logo URLs
    expect(
      normalizeBranding({
        app_name: '',
        primary_color: 'invalid',
        logo_url: 'http://cdn.example.com/logo.png',
      })
    ).toEqual(DEFAULT_BRANDING)
  })
})
