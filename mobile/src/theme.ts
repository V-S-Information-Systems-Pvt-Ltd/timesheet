export const colors = {
  background: '#F8FAFC',
  card: '#FFFFFF',
  foreground: '#3D3D3D',
  muted: '#526077',
  border: '#E2E8F0',
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
  darkBackground: '#0F172A',
  darkForeground: '#F8FAFC',
  darkMuted: '#94A3B8',
  darkCard: '#1E293B',
  darkBorder: '#334155',
  darkPlaceholder: '#94A3B8',
  placeholder: '#64748B',
  error: '#E11D48',
  errorLight: '#FFF1F2',
  danger: '#E11D48',
  dangerLight: '#FFF1F2',
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
  hero: 36,
  eyebrow: 12,
  title: 32,
  subtitle: 20,
  heading: 18,
  body: 15,
  caption: 13,
  badge: 11,
} as const;

export const borderRadius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  round: 9999,
  full: 9999,
} as const;

export const shadows = {
  sm: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
} as const;

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
  info: string;
  infoLight: string;
  success: string;
  warning: string;
  error: string;
  danger: string;
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
  const dark = { r: 15, g: 23, b: 42 };

  const lightTint = blendRgb(rgb, white, 0.92);
  const darkTint = blendRgb(rgb, dark, 0.75);

  return isDarkMode
    ? {
        background: colors.darkBackground,
        foreground: colors.darkForeground,
        muted: colors.darkMuted,
        card: colors.darkCard,
        border: colors.darkBorder,
        placeholder: colors.darkPlaceholder,
        errorBoxBg: '#3A1E1E',
        badgeBg: darkTint,
        successBoxBg: '#133529',
        warningBoxBg: '#382B14',
        infoBoxBg: '#1C2C4E',
        progressTrack: 'rgba(255, 255, 255, 0.1)',
        divider: colors.darkBorder,
        primary: cleanPrimary,
        primaryLight: darkTint,
        info: colors.info,
        infoLight: '#1C2C4E',
        success: colors.success,
        warning: colors.warning,
        error: colors.error,
        danger: colors.error,
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
        progressTrack: 'rgba(15, 23, 42, 0.06)',
        divider: colors.border,
        primary: cleanPrimary,
        primaryLight: lightTint,
        info: colors.info,
        infoLight: colors.infoLight,
        success: colors.success,
        warning: colors.warning,
        error: colors.error,
        danger: colors.error,
      };
}

export { ThemeProvider, useScreenPalette, useTheme, type ThemeContextValue, type ThemeProviderProps } from './theme/ThemeContext';
export { themeStore, type ThemePreference } from './storage/theme-store';
