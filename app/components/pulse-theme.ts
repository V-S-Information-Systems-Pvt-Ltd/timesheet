import { derivePalette, getContrastRatio, type BrandPalette } from '@/lib/branding'

export interface WebPalette extends BrandPalette {
  /** Primary clamped to 4.5:1 on sheet, paper, muted and tint; for primary-coloured text and icons. */
  primaryTextLight: string
  primaryTextDark: string
}

type Rgb = [number, number, number]

const hexToRgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (c: Rgb) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`
const blend = (a: Rgb, b: Rgb, w: number): Rgb => a.map((v, i) => v + (b[i] - v) * w) as Rgb

/** Blends `hex` toward `toward` until it reaches 4.5:1 on every surface (mirrors mobile `readableOn`). */
function readableOn(hex: string, surfaces: string[], toward: Rgb): string {
  const base = hexToRgb(hex)
  for (let w = 0; w <= 1; w += 0.02) {
    const candidate = toHex(blend(base, toward, w))
    if (surfaces.every((s) => getContrastRatio(candidate, s) >= 4.5)) return candidate
  }
  return toHex(toward)
}

// Timecard sheet, paper and muted surfaces; keep in sync with the light/dark tokens in globals.css.
const LIGHT_SURFACES = ['#FFFFFF', '#F3F6F9', '#EDF1F6']
const DARK_SURFACES = ['#16243B', '#0E1A2E', '#1D2D49']

/** Web presentation of the workspace palette: the timecard shades plus contrast-clamped text colours. */
export function deriveWebPalette(primaryColor?: string | null): WebPalette {
  const palette = derivePalette(primaryColor)
  const rgb = hexToRgb(palette.primary)
  const lightTint = toHex(blend(rgb, [255, 255, 255], 0.92))
  const darkTint = toHex(blend(rgb, [14, 26, 46], 0.75))
  return {
    ...palette,
    primaryTextLight: readableOn(palette.primary, [...LIGHT_SURFACES, lightTint], [0, 0, 0]),
    primaryTextDark: readableOn(palette.primary, [...DARK_SURFACES, darkTint], [255, 255, 255]),
  }
}
