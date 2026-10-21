import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, spacing, typography, numeralSizes, borderRadius, type Palette } from '../theme';
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

/**
 * A large Barlow numeral with a small label. Plain text on the surface; only a
 * pressable metric gets a (subtle) pressed background.
 */
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
    <View style={styles.content}>
      <Text style={[styles.label, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.value, { color: isPrimary ? palette.primary : palette.foreground }]}>
        {value} <Text style={[styles.unit, { color: palette.muted }]}>{unit}</Text>
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
          rippleColor={palette.progressTrack}
          scaleTo={1}
          style={styles.pressable}
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
  pressable: {
    width: '100%',
    borderRadius: borderRadius.md,
  },
  content: {
    width: '100%',
    paddingVertical: spacing.xs,
  },
  label: {
    fontSize: typography.caption,
    fontWeight: '500',
    marginBottom: spacing.xs,
  },
  value: {
    fontFamily: fonts.numeral,
    fontSize: numeralSizes.md,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
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
