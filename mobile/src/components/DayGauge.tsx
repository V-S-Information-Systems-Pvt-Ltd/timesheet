import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, spacing, typography, borderRadius, type Palette } from '../theme';

export const GAUGE_HOURS = 8;

interface DayGaugeProps {
  /** Hours logged for the day; fractions fill a segment partially. */
  hours: number;
  palette: Palette;
}

/** 6.5 -> "6.5", 8 -> "8", 7.25 -> "7.3" (one decimal, no trailing zero). */
export function formatGaugeHours(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * Eight one-hour segments for the working day. Hours beyond eight show as one
 * extra ink-outlined segment and a "+N h" count.
 */
export const DayGauge = React.memo(function DayGaugeComponent({ hours, palette }: DayGaugeProps) {
  const logged = Number.isFinite(hours) && hours > 0 ? hours : 0;
  const overtime = Math.max(0, logged - GAUGE_HOURS);

  return (
    <View
      accessible
      accessibilityLabel={`${formatGaugeHours(logged)} of ${GAUGE_HOURS} hours logged today`}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: GAUGE_HOURS, now: Math.min(logged, GAUGE_HOURS) }}
      style={styles.row}
    >
      {Array.from({ length: GAUGE_HOURS }, (_, i) => {
        const fill = Math.min(1, Math.max(0, logged - i));
        return (
          <View
            key={i}
            style={[styles.segment, { backgroundColor: palette.hairline }]}
            testID="day-gauge-segment"
          >
            {fill > 0 ? (
              <View style={[styles.fill, { width: `${fill * 100}%`, backgroundColor: palette.logged }]} />
            ) : null}
          </View>
        );
      })}
      {overtime > 0 ? (
        <>
          <View
            style={[styles.segment, styles.overtimeSegment, { borderColor: palette.foreground }]}
            testID="day-gauge-overtime"
          />
          <Text style={[styles.overtimeText, { color: palette.foreground }]}>
            {`+${formatGaugeHours(overtime)} h`}
          </Text>
        </>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  segment: {
    flex: 1,
    height: 14,
    borderRadius: borderRadius.xs,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
  overtimeSegment: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
  },
  overtimeText: {
    marginLeft: spacing.xs,
    fontFamily: fonts.numeral,
    fontSize: typography.body,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
