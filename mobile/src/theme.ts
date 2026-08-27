export const colors = {
  background: '#F8FAFC',
  card: '#FFFFFF',
  foreground: '#0F172A',
  muted: '#526077',
  border: '#E2E8F0',
  primary: '#E4282F',
  primaryDark: '#C01E25',
  primaryLight: '#FFF1F2',
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
        badgeBg: '#3B181E',
        successBoxBg: '#133529',
        warningBoxBg: '#382B14',
        infoBoxBg: '#1C2C4E',
        progressTrack: 'rgba(255, 255, 255, 0.1)',
        divider: colors.darkBorder,
        primary: colors.primary,
        primaryLight: '#3B181E',
        info: colors.info,
        infoLight: '#1C2C4E',
        success: colors.success,
        warning: colors.warning,
        error: colors.error,
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
        infoBoxBg: colors.infoLight,
        progressTrack: 'rgba(15, 23, 42, 0.06)',
        divider: colors.border,
        primary: colors.primary,
        primaryLight: colors.primaryLight,
        info: colors.info,
        infoLight: colors.infoLight,
        success: colors.success,
        warning: colors.warning,
        error: colors.error,
      };
}
