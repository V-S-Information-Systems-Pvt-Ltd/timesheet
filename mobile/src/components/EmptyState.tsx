import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography, borderRadius, type Palette } from '../theme';
import { PressableScale } from './PressableScale';

interface EmptyStateProps {
  icon?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  palette: Palette;
}

export function EmptyState({
  icon,
  message,
  actionLabel,
  onAction,
  palette,
}: EmptyStateProps) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      {icon ? <Text style={styles.icon}>{icon}</Text> : null}
      <Text style={[styles.text, { color: palette.muted }]}>{message}</Text>
      {actionLabel && onAction ? (
        <PressableScale
          accessibilityLabel={actionLabel}
          accessibilityRole="button"
          onPress={onAction}
          style={[styles.actionButton, { backgroundColor: palette.badgeBg }]}
        >
          <Text style={styles.actionButtonText}>{actionLabel}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.xl,
    marginTop: spacing.md,
  },
  icon: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  text: {
    fontSize: typography.body,
    textAlign: 'center',
    lineHeight: 22,
  },
  actionButton: {
    borderRadius: borderRadius.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonText: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
