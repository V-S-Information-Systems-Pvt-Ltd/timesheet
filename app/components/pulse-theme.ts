import { DEFAULT_BRANDING, derivePalette, type BrandPalette } from '@/lib/branding'

/** Web-only styling for the built-in workspace; stored/mobile branding stays intact. */
export function deriveWebPalette(primaryColor?: string | null): BrandPalette {
  const palette = derivePalette(primaryColor)
  if (palette.primary !== DEFAULT_BRANDING.primaryColor) return palette

  return {
    primary: '#007867',
    primaryDark: '#006C5C',
    primaryLight: '#EBF8F2',
    onPrimary: '#FFFFFF',
    shades: {
      50: '#EBF8F2',
      100: '#C8FAD6',
      200: '#A0EDC0',
      300: '#5BE49B',
      400: '#2DCA8C',
      500: '#00A76F',
      600: '#007867',
      700: '#006C5C',
      800: '#005C52',
      900: '#004B50',
    },
  }
}
