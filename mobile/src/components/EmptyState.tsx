import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, typography, borderRadius, type Palette } from '../theme';
import { PressableScale } from './PressableScale';
import { Icon, ICON_NAMES, type IconName } from './Icon';

interface EmptyStateProps {
  icon?: IconName | string;
  /** Write as an invitation: what this place is for, then what to do next. */
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
  const isKnownIcon = typeof icon === 'string' && ICON_NAMES.has(icon);

  return (
    <View style={[styles.container, { borderColor: palette.hairline }]}>
      {icon ? (
        isKnownIcon ? (
          <View style={styles.iconWrapper}>
            <Icon color={palette.muted} name={icon as IconName} size={32} />
          </View>
        ) : (
          <Text style={[styles.icon, { color: palette.muted }]}>{icon}</Text>
        )
      ) : null}
      <Text style={[styles.text, { color: palette.muted }]}>{message}</Text>
      {actionLabel && onAction ? (
        <PressableScale
          accessibilityLabel={actionLabel}
          accessibilityRole="button"
          onPress={onAction}
          style={[styles.actionButton, { backgroundColor: palette.primary }]}
        >
          <Text style={[styles.actionButtonText, { color: palette.onPrimary }]}>{actionLabel}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderTopWidth: 1,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  iconWrapper: {
    marginBottom: spacing.sm,
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
    borderRadius: borderRadius.control,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: typography.body,
    fontWeight: '600',
  },
});
