import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography, borderRadius, type Palette } from '../theme';
import { PressableScale } from './PressableScale';
import { Icon, type IconName } from './Icon';

interface EmptyStateProps {
  icon?: IconName | string;
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
  const isKnownIcon =
    typeof icon === 'string' &&
    ['home', 'clock', 'plus', 'reports', 'calendar', 'bell', 'team', 'profile', 'folder', 'tag', 'search', 'close', 'check', 'more', 'filter'].includes(icon);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      {icon ? (
        isKnownIcon ? (
          <View style={styles.iconWrapper}>
            <Icon color={palette.muted} name={icon as IconName} size={36} />
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
