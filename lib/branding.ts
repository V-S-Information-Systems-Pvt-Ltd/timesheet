import type { WorkspaceBranding } from '@/app/types'

export const DEFAULT_BRANDING: WorkspaceBranding = {
  appName: 'VSIS Timesheet',
  primaryColor: '#1E73BE',
  logoUrl: null,
}

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/
const HTTPS_URL_REGEX = /^https:\/\/[^\s$.?#].[^\s]*$/i

/**
 * Calculates standard WCAG 2.1 relative luminance for a 6-digit hex color.
 */
export function getRelativeLuminance(hex: string): number {
  const sanitized = hex.replace(/^#/, '')
  const r = parseInt(sanitized.substring(0, 2), 16) / 255
  const g = parseInt(sanitized.substring(2, 4), 16) / 255
  const b = parseInt(sanitized.substring(4, 6), 16) / 255

  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

  const rLinear = toLinear(r)
  const gLinear = toLinear(g)
  const bLinear = toLinear(b)

  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear
}

/**
 * Calculates WCAG contrast ratio between two hex colors.
 */
export function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getRelativeLuminance(hex1)
  const lum2 = getRelativeLuminance(hex2)
  const brightest = Math.max(lum1, lum2)
  const darkest = Math.min(lum1, lum2)
  return (brightest + 0.05) / (darkest + 0.05)
}

/**
 * Verifies that a primary color maintains accessible action contrast.
 * White text (#FFFFFF) on the primary color button must achieve at least 3.0:1 contrast,
 * and the color must achieve at least 1.8:1 contrast on dark surface (#0F172A).
 */
export function isAccessiblePrimaryColor(hex: string): boolean {
  if (!HEX_COLOR_REGEX.test(hex)) return false
  const contrastWithWhite = getContrastRatio(hex, '#FFFFFF')
  const contrastWithDark = getContrastRatio(hex, '#0F172A')

  return contrastWithWhite >= 3.0 && contrastWithDark >= 1.8
}

export interface BrandingValidationResult {
  valid: boolean
  data?: WorkspaceBranding
  errors?: Record<string, string>
}

/**
 * Validates workspace branding input.
 */
export function validateBranding(input: unknown): BrandingValidationResult {
  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      errors: { branding: 'Branding settings must be an object.' },
    }
  }

  const record = input as Record<string, unknown>
  const errors: Record<string, string> = {}

  // 1. appName
  let appName = DEFAULT_BRANDING.appName
  if (record.appName !== undefined) {
    if (typeof record.appName !== 'string') {
      errors.appName = 'App name must be a string.'
    } else {
      const trimmed = record.appName.trim()
      if (trimmed.length < 1) {
        errors.appName = 'App name cannot be empty.'
      } else if (trimmed.length > 50) {
        errors.appName = 'App name must not exceed 50 characters.'
      } else {
        appName = trimmed
      }
    }
  }

  // 2. primaryColor
  let primaryColor = DEFAULT_BRANDING.primaryColor
  if (record.primaryColor !== undefined) {
    if (typeof record.primaryColor !== 'string') {
      errors.primaryColor = 'Primary color must be a hex string.'
    } else {
      const hex = record.primaryColor.trim().toUpperCase()
      if (!HEX_COLOR_REGEX.test(hex)) {
        errors.primaryColor = 'Primary color must be a valid 6-digit hex code (e.g. #1E73BE).'
      } else if (!isAccessiblePrimaryColor(hex)) {
        errors.primaryColor =
          'Primary color does not meet accessibility contrast requirements for action buttons.'
      } else {
        primaryColor = hex
      }
    }
  }

  // 3. logoUrl
  let logoUrl: string | null = null
  if (record.logoUrl !== undefined && record.logoUrl !== null && record.logoUrl !== '') {
    if (typeof record.logoUrl !== 'string') {
      errors.logoUrl = 'Logo URL must be a string or null.'
    } else {
      const trimmedUrl = record.logoUrl.trim()
      if (trimmedUrl.length > 2048) {
        errors.logoUrl = 'Logo URL must not exceed 2048 characters.'
      } else if (!trimmedUrl.startsWith('https://')) {
        errors.logoUrl = 'Logo URL must use a secure HTTPS protocol (https://).'
      } else if (!HTTPS_URL_REGEX.test(trimmedUrl)) {
        errors.logoUrl = 'Logo URL is not a valid HTTPS URL.'
      } else {
        logoUrl = trimmedUrl
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    data: {
      appName,
      primaryColor,
      logoUrl,
    },
  }
}

/**
 * Normalizes raw settings row or input into valid WorkspaceBranding.
 */
export function normalizeBranding(
  raw?: { app_name?: string | null; primary_color?: string | null; logo_url?: string | null } | null
): WorkspaceBranding {
  if (!raw) return { ...DEFAULT_BRANDING }

  const appName =
    typeof raw.app_name === 'string' && raw.app_name.trim().length > 0
      ? raw.app_name.trim().slice(0, 50)
      : DEFAULT_BRANDING.appName

  const primaryColor =
    typeof raw.primary_color === 'string' && HEX_COLOR_REGEX.test(raw.primary_color.trim())
      ? raw.primary_color.trim().toUpperCase()
      : DEFAULT_BRANDING.primaryColor

  const logoUrl =
    typeof raw.logo_url === 'string' &&
    raw.logo_url.trim().startsWith('https://') &&
    raw.logo_url.trim().length <= 2048
      ? raw.logo_url.trim()
      : null

  return {
    appName,
    primaryColor,
    logoUrl,
  }
}

export interface BrandPalette {
  primary: string
  primaryDark: string
  primaryLight: string
  onPrimary: string
  shades: {
    50: string
    100: string
    200: string
    300: string
    400: string
    500: string
    600: string
    700: string
    800: string
    900: string
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const sanitized = hex.replace(/^#/, '')
  const num = parseInt(sanitized, 16)
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${((1 << 24) + (clamp(r) << 16) + (clamp(g) << 8) + clamp(b)).toString(16).slice(1).toUpperCase()}`
}

function blendRgb(
  base: { r: number; g: number; b: number },
  target: { r: number; g: number; b: number },
  weight: number
): string {
  return rgbToHex(
    base.r + (target.r - base.r) * weight,
    base.g + (target.g - base.g) * weight,
    base.b + (target.b - base.b) * weight
  )
}

/**
 * Derives a full 10-shade tonal scale and semantic action colors from a 6-digit hex primary.
 */
export function derivePalette(primaryHex?: string | null): BrandPalette {
  const cleanHex =
    primaryHex && HEX_COLOR_REGEX.test(primaryHex.trim())
      ? primaryHex.trim().toUpperCase()
      : DEFAULT_BRANDING.primaryColor

  const rgb = hexToRgb(cleanHex)
  const white = { r: 255, g: 255, b: 255 }
  const dark = { r: 15, g: 23, b: 42 }

  const shades = {
    50: blendRgb(rgb, white, 0.92),
    100: blendRgb(rgb, white, 0.82),
    200: blendRgb(rgb, white, 0.65),
    300: blendRgb(rgb, white, 0.45),
    400: blendRgb(rgb, white, 0.25),
    500: blendRgb(rgb, white, 0.10),
    600: cleanHex,
    700: blendRgb(rgb, dark, 0.20),
    800: blendRgb(rgb, dark, 0.38),
    900: blendRgb(rgb, dark, 0.55),
  }

  return {
    primary: shades[600],
    primaryDark: shades[700],
    primaryLight: shades[50],
    onPrimary: '#FFFFFF',
    shades,
  }
}

