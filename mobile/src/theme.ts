export const colors = {
  background: '#F7F9FC',
  card: '#FFFFFF',
  foreground: '#172033',
  muted: '#5E6B82',
  border: '#DCE3EE',
  primary: '#2457D6',
  primaryDark: '#1A43AC',
  primaryLight: '#EEF2FD',
  onPrimary: '#FFFFFF',
  darkBackground: '#101827',
  darkForeground: '#F2F5FA',
  darkMuted: '#A9B5C8',
  darkCard: '#182338',
  darkBorder: '#2A3851',
  darkPlaceholder: '#8491A6',
  placeholder: '#7A879A',
  error: '#D74747',
  errorLight: '#FDF2F2',
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
} as const;

export const shadows = {
  sm: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000000',
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
  progressTrack: string;
  divider: string;
}

export function getPalette(isDarkMode: boolean): Palette {
  return isDarkMode
    ? {
        background: colors.darkBackground,
        foreground: colors.darkForeground,
        muted: colors.darkMuted,
        card: colors.darkCard,
        border: colors.darkBorder,
        placeholder: colors.darkPlaceholder,
        errorBoxBg: '#3A1E1E',
        badgeBg: '#1C2C4E',
        successBoxBg: '#133529',
        warningBoxBg: '#382B14',
        progressTrack: 'rgba(255, 255, 255, 0.1)',
        divider: colors.darkBorder,
      }
    : {
        background: colors.background,
        foreground: colors.foreground,
        muted: colors.muted,
        card: colors.card,
        border: colors.border,
        placeholder: colors.placeholder,
        errorBoxBg: colors.errorLight,
        badgeBg: colors.primaryLight,
        successBoxBg: colors.successLight,
        warningBoxBg: colors.warningLight,
        progressTrack: 'rgba(0, 0, 0, 0.06)',
        divider: colors.border,
      };
}
