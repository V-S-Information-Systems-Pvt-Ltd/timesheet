import React from 'react';
import { StyleSheet, Text, View, type DimensionValue } from 'react-native';
import { fonts, spacing, typography, numeralSizes, type Palette } from '../theme';

interface BucketRowProps {
  label: string;
  hours: number;
  /** 0-100 share of the total; drives the thin bar. */
  percent: number;
  meta?: string;
  accessibilityLabel?: string;
  palette: Palette;
}

/** A grouped total as a ledger row: name left, hours numeral right, thin share bar. */
export function BucketRow({ label, hours, percent, meta, accessibilityLabel, palette }: BucketRowProps) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[styles.row, { borderBottomColor: palette.hairline }]}
    >
      <View style={styles.line}>
        <View style={styles.text}>
          <Text numberOfLines={1} style={[styles.name, { color: palette.foreground }]}>
            {label || 'Unknown'}
          </Text>
          {meta ? <Text style={[styles.meta, { color: palette.muted }]}>{meta}</Text> : null}
        </View>
        <Text style={[styles.hours, { color: palette.foreground }]}>
          {hours.toFixed(1)} <Text style={[styles.unit, { color: palette.muted }]}>hrs</Text>
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: palette.progressTrack }]}>
        <View
          style={[
            styles.bar,
            { backgroundColor: palette.primary, width: `${percent.toFixed(1)}%` as DimensionValue },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  text: { flex: 1, marginRight: spacing.md },
  name: { fontSize: typography.body, fontWeight: '600' },
  meta: { fontSize: typography.caption, marginTop: 2 },
  hours: {
    fontFamily: fonts.numeral,
    fontSize: numeralSizes.sm,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  unit: { fontSize: typography.caption, fontWeight: '500' },
  track: { height: 3, borderRadius: 2, overflow: 'hidden', marginTop: spacing.sm },
  bar: { height: '100%', borderRadius: 2 },
});
