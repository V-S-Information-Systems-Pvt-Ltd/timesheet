import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { ApiClientError } from './api/client';
import type { ApiErrorCode } from './api/contracts';
import { colors, spacing, typography } from './theme';

export interface Palette {
  background: string;
  card: string;
  foreground: string;
  muted: string;
  border: string;
  placeholder: string;
}

export function getPalette(isDarkMode: boolean): Palette {
  return isDarkMode
    ? {
      background: colors.darkBackground,
      card: colors.darkCard,
      foreground: colors.darkForeground,
      muted: colors.darkMuted,
      border: colors.darkBorder,
      placeholder: colors.darkPlaceholder,
    }
    : {
      background: colors.background,
      card: colors.card,
      foreground: colors.foreground,
      muted: colors.muted,
      border: colors.border,
      placeholder: colors.placeholder,
    };
}

/** Maps stable server error codes to user-facing copy. */
export function describeApiError(reason: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (!(reason instanceof ApiClientError)) {
    return reason instanceof Error && reason.message ? reason.message : fallback;
  }
  switch (reason.code as ApiErrorCode) {
    case 'INVALID_CREDENTIALS':
      return 'Email or password is incorrect.';
    case 'ACCOUNT_INACTIVE':
      return 'This account is waiting for administrator approval.';
    case 'RATE_LIMITED': {
      const wait = reason.retryAfterSeconds;
      return wait
        ? `Too many attempts. Try again in ${Math.max(1, Math.ceil(wait / 60))} minute(s).`
        : 'Too many attempts. Try again later.';
    }
    case 'VALIDATION_ERROR':
      return 'Check the highlighted fields and try again.';
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
      return 'Cannot reach the server. Check your connection.';
    default:
      return reason.message || fallback;
  }
}

export function Card({ palette, style, children }: { palette: Palette; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  return (
    <View style={[ui.card, { backgroundColor: palette.card, borderColor: palette.border }, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ palette, children }: { palette: Palette; children: React.ReactNode }) {
  return <Text style={[ui.sectionTitle, { color: palette.foreground }]}>{children}</Text>;
}

export function MutedText({ palette, style, children }: { palette: Palette; style?: StyleProp<TextStyle>; children: React.ReactNode }) {
  return <Text style={[ui.muted, { color: palette.muted }, style]}>{children}</Text>;
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[ui.feedback, ui.errorText, { color: colors.error }]}>
      {children}
    </Text>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
  busyLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
}) {
  const inactive = Boolean(disabled) || Boolean(busy);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: Boolean(busy), disabled: inactive }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [ui.button, (pressed || inactive) && ui.buttonPressed]}
    >
      {busy ? (
        <>
          <ActivityIndicator color={colors.onPrimary} />
          <Text style={ui.buttonText}>{busyLabel ? ` ${busyLabel}` : ''}</Text>
        </>
      ) : (
        <Text style={ui.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
}

export const ui = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: spacing.lg },
  sectionTitle: { fontSize: typography.body, fontWeight: '700' },
  muted: { fontSize: typography.caption, lineHeight: 20 },
  feedback: { fontSize: typography.caption, lineHeight: 20, marginTop: spacing.md },
  errorText: { fontWeight: '600' },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  buttonPressed: { opacity: 0.72 },
  buttonText: { color: colors.onPrimary, fontSize: typography.body, fontWeight: '700' },
});
