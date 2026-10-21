import { Platform } from 'react-native';

export const colors = {
  // Timecard palette: ink for text and structure, paper behind white sheets.
  ink: '#13294B',
  background: '#F3F6F9',
  paper: '#F3F6F9',
  card: '#FFFFFF',
  sheet: '#FFFFFF',
  foreground: '#13294B',
  muted: '#55657E',
  border: '#E1E7EF',
  hairline: '#E1E7EF',
  controlBorder: '#C9D3E0',
  subtle: '#A3AEBE',
  primary: '#1E73BE',
  primaryDark: '#185B98',
  primaryLight: '#EFF8FF',
  brandRed: '#EA2B32',
  accent: '#1BB0CE',
  onPrimary: '#FFFFFF',
  info: '#2457D6',
  infoDark: '#1A43AC',
  infoLight: '#EEF2FD',
  onInfo: '#FFFFFF',
  logged: '#2E8B57',
  loggedText: '#1F6B43',
  loggedTint: '#E3F1E8',
  leave: '#5B4590',
  leaveTint: '#ECE7F5',
  missing: '#EA2B32',
  missingText: '#C8232A',
  missingTint: '#FDE7E8',
  darkBackground: '#0E1A2E',
  darkForeground: '#EAF0F7',
  darkMuted: '#9AA8BD',
  darkCard: '#16243B',
  darkBorder: '#24344F',
  darkControlBorder: '#3A4C6B',
  darkPlaceholder: '#9AA8BD',
  placeholder: '#667589',
  error: '#C8232A',
  errorLight: '#FDE7E8',
  danger: '#C8232A',
  dangerLight: '#FDE7E8',
  success: '#10B981',
  successLight: '#ECFDF5',
  warning: '#F59E0B',
  warningLight: '#FFFBEB',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 28,
  xxl: 36,
} as const;

export const typography = {
  hero: 56,
  eyebrow: 12,
  title: 26,
  subtitle: 20,
  heading: 15,
  body: 15,
  caption: 12,
  badge: 11,
} as const;

/** Numeral sizes (Barlow Semi Condensed): day gauge, metric values, list hours, small counts. */
export const numeralSizes = { xl: 56, lg: 40, md: 26, sm: 20 } as const;

export const borderRadius = {
  xs: 4,
  sm: 8,
  md: 10,
  lg: 18,
  xl: 18,
  control: 10,
  sheet: 18,
  round: 9999,
  full: 9999,
} as const;

// Hierarchy comes from paper vs sheet and hairlines, not from shadows.
const noShadow = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0,
  shadowRadius: 0,
  elevation: 0,
} as const;

export const shadows = {
  sm: noShadow,
  md: noShadow,
} as const;

export interface FontFamilies {
  /** Barlow Semi Condensed SemiBold (600). undefined falls back to the system font. */
  numeral: string | undefined;
  /** Barlow Semi Condensed Medium (500). */
  numeralMedium: string | undefined;
}

export function resolveFonts(os: string): FontFamilies {
  switch (os) {
    case 'android':
    case 'ios':
      // File basename (Android assets/fonts) == PostScript name (iOS UIAppFonts).
      return { numeral: 'BarlowSemiCondensed-SemiBold', numeralMedium: 'BarlowSemiCondensed-Medium' };
    // Windows: RNW Fabric text reads only the system font collection, and the
    // Store rejects the windows.sharedFonts extension that would register Barlow
    // there, so numerals use the system font.
    default:
      return { numeral: undefined, numeralMedium: undefined };
  }
}

export const fonts = resolveFonts(Platform.OS);

export interface Palette {
  background: string;
  foreground: string;
  muted: string;
  card: string;
  border: string;
  placeholder: string;
  errorBoxBg: string;
  badgeBg: string;
  successBoxBg: string;
  warningBoxBg: string;
  infoBoxBg: string;
  progressTrack: string;
  divider: string;
  primary: string;
  primaryLight: string;
  primaryDark: string;
  onPrimary: string;
  info: string;
  infoLight: string;
  success: string;
  warning: string;
  successText: string;
  warningText: string;
  error: string;
  danger: string;
  paper: string;
  sheet: string;
  hairline: string;
  controlBorder: string;
  logged: string;
  loggedText: string;
  loggedTint: string;
  leave: string;
  leaveTint: string;
  missing: string;
  missingText: string;
  missingTint: string;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const sanitized = hex.replace(/^#/, '');
  const num = parseInt(sanitized, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) + (clamp(r) << 16) + (clamp(g) << 8) + clamp(b)).toString(16).slice(1).toUpperCase()}`;
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
  );
}

export function getPalette(isDarkMode: boolean, primaryColor?: string | null): Palette {
  const cleanPrimary =
    primaryColor && /^#[0-9A-Fa-f]{6}$/.test(primaryColor.trim())
      ? primaryColor.trim().toUpperCase()
      : colors.primary;

  const rgb = hexToRgb(cleanPrimary);
  const white = { r: 255, g: 255, b: 255 };
  const dark = { r: 14, g: 26, b: 46 };

  const lightTint = blendRgb(rgb, white, 0.92);
  const darkTint = blendRgb(rgb, dark, 0.75);
  const black = { r: 0, g: 0, b: 0 };
  const primaryDark = blendRgb(rgb, black, 0.22);

  return isDarkMode
    ? {
        background: colors.darkBackground,
        foreground: colors.darkForeground,
        muted: colors.darkMuted,
        card: colors.darkCard,
        border: colors.darkBorder,
        placeholder: colors.darkPlaceholder,
        errorBoxBg: '#3A1D26',
        badgeBg: darkTint,
        successBoxBg: '#12332A',
        warningBoxBg: '#382B14',
        infoBoxBg: '#1B2D52',
        progressTrack: 'rgba(255, 255, 255, 0.1)',
        divider: colors.darkBorder,
        primary: cleanPrimary,
        primaryLight: darkTint,
        primaryDark,
        onPrimary: '#FFFFFF',
        info: colors.info,
        infoLight: '#1B2D52',
        success: colors.success,
        warning: colors.warning,
        successText: '#6EE7B7',
        warningText: '#FCD34D',
        error: '#FF7A80',
        danger: '#FF7A80',
        paper: colors.darkBackground,
        sheet: colors.darkCard,
        hairline: colors.darkBorder,
        controlBorder: colors.darkControlBorder,
        logged: '#4FB381',
        loggedText: '#7FD3A5',
        loggedTint: '#14332A',
        leave: '#B3A2E0',
        leaveTint: '#2A2347',
        missing: '#EA2B32',
        missingText: '#FF8A8F',
        missingTint: '#3A1D26',
      }
    : {
        background: colors.background,
        foreground: colors.foreground,
        muted: colors.muted,
        card: colors.card,
        border: colors.border,
        placeholder: colors.placeholder,
        errorBoxBg: colors.errorLight,
        badgeBg: lightTint,
        successBoxBg: colors.successLight,
        warningBoxBg: colors.warningLight,
        infoBoxBg: colors.infoLight,
        progressTrack: 'rgba(19, 41, 75, 0.07)',
        divider: colors.border,
        primary: cleanPrimary,
        primaryLight: lightTint,
        primaryDark,
        onPrimary: '#FFFFFF',
        info: colors.info,
        infoLight: colors.infoLight,
        success: colors.success,
        warning: colors.warning,
        successText: '#047857',
        warningText: '#92400E',
        error: colors.error,
        danger: colors.error,
        paper: colors.paper,
        sheet: colors.sheet,
        hairline: colors.hairline,
        controlBorder: colors.controlBorder,
        logged: colors.logged,
        loggedText: colors.loggedText,
        loggedTint: colors.loggedTint,
        leave: colors.leave,
        leaveTint: colors.leaveTint,
        missing: colors.missing,
        missingText: colors.missingText,
        missingTint: colors.missingTint,
      };
}

export { ThemeProvider, useTheme, type ThemeContextValue, type ThemeProviderProps } from './theme/ThemeContext';
export { themeStore, type ThemePreference } from './storage/theme-store';
