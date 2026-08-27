import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography, borderRadius, shadows, type Palette } from '../theme';

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  dateLabel?: string;
  isPrimary?: boolean;
  palette: Palette;
}

export function MetricCard({
  label,
  value,
  unit = 'hrs',
  dateLabel,
  isPrimary = false,
  palette,
}: MetricCardProps) {
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: palette.card,
          borderColor: palette.border,
        },
      ]}
    >
      <Text style={[styles.label, { color: palette.muted }]}>{label}</Text>
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
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    ...shadows.sm,
  },
  label: {
    fontSize: typography.caption,
    fontWeight: '600',
    marginBottom: spacing.xs,
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
