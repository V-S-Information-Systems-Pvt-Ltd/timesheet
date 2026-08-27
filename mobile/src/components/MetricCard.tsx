import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography, borderRadius, shadows, type Palette } from '../theme';
import { PressableScale } from './PressableScale';

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  dateLabel?: string;
  isPrimary?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  palette: Palette;
}

export const MetricCard = React.memo(function MetricCardComponent({
  label,
  value,
  unit = 'hrs',
  dateLabel,
  isPrimary = false,
  onPress,
  accessibilityLabel,
  palette,
}: MetricCardProps) {
  const content = (
    <View
      style={[
        styles.card,
        {
          backgroundColor: palette.card,
          borderColor: isPrimary ? colors.primary : palette.border,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.label, { color: palette.muted }]}>{label}</Text>
        {onPress ? (
          <Text style={[styles.chevron, { color: isPrimary ? colors.primary : palette.muted }]}>›</Text>
        ) : null}
      </View>
      <Text
        style={[
          styles.value,
          { color: isPrimary ? colors.primary : palette.foreground },
        ]}
      >
        {value} <Text style={styles.unit}>{unit}</Text>
      </Text>
      {dateLabel ? (
        <Text style={[styles.date, { color: palette.muted }]}>{dateLabel}</Text>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <View style={styles.wrapper}>
        <PressableScale
          accessibilityLabel={accessibilityLabel || `${label}: ${value} ${unit}`}
          accessibilityRole="button"
          onPress={onPress}
        >
          {content}
        </PressableScale>
      </View>
    );
  }

  return <View style={styles.wrapper}>{content}</View>;
});

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  card: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    ...shadows.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  label: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 14,
    fontWeight: '700',
  },
  value: {
    fontSize: typography.title,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  unit: {
    fontSize: typography.caption,
    fontWeight: '500',
  },
  date: {
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
});
