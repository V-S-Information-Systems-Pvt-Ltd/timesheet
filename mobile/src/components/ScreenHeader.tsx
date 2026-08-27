import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography, type Palette } from '../theme';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  backAccessibilityLabel?: string;
  rightAction?: React.ReactNode;
  palette: Palette;
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  backLabel = '‹ Dashboard',
  backAccessibilityLabel,
  rightAction,
  palette,
}: ScreenHeaderProps) {
  const resolvedBackAccessibilityLabel =
    backAccessibilityLabel ??
    (backLabel.includes('Cancel') ? 'Back' : 'Back to dashboard');

  return (
    <View style={styles.header}>
      {(onBack || rightAction) ? (
        <View style={styles.actionRow}>
          {onBack ? (
            <Pressable
              accessibilityLabel={resolvedBackAccessibilityLabel}
              accessibilityRole="button"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={onBack}
              style={styles.backButton}
            >
              <Text style={[styles.backButtonText, { color: colors.primary }]}>{backLabel}</Text>
            </Pressable>
          ) : (
            <View />
          )}
          {rightAction ? <View>{rightAction}</View> : null}
        </View>
      ) : null}
      <Text style={[styles.title, { color: palette.foreground }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: palette.muted }]}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    paddingRight: spacing.sm,
  },
  backButtonText: {
    fontSize: typography.body,
    fontWeight: '600',
  },
  title: {
    fontSize: typography.title,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
});
