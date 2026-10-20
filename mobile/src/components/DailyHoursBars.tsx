import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { rangeDates, STANDARD_DAY_HOURS } from '@vsis/core';
import { spacing, typography, type Palette } from '../theme';
import { formatDateRangeShort } from '../utils/dates';

/** Longest span drawn; wider ranges show their most recent days. */
export const MAX_BAR_DAYS = 31;
const CHART_HEIGHT = 120;

interface DailyHoursBarsProps {
  rows: Array<{ log_date: string; hours_worked: number }>;
  from: string;
  to: string;
  palette: Palette;
}

/** Plain-View daily totals with an 8h reference line; no chart library. */
export function DailyHoursBars({ rows, from, to, palette }: DailyHoursBarsProps) {
  const { days, scale } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of rows) totals.set(r.log_date, (totals.get(r.log_date) ?? 0) + Number(r.hours_worked));
    const dates = rangeDates(from, to).slice(-MAX_BAR_DAYS);
    const list = dates.map((date) => ({ date, hours: Math.round((totals.get(date) ?? 0) * 100) / 100 }));
    return { days: list, scale: Math.max(STANDARD_DAY_HOURS, ...list.map((d) => d.hours)) };
  }, [rows, from, to]);

  if (days.length === 0) return null;
  const refBottom = (STANDARD_DAY_HOURS / scale) * CHART_HEIGHT;

  return (
    <View style={[styles.section, { borderBottomColor: palette.hairline }]}>
      <Text style={[styles.title, { color: palette.foreground }]}>Daily hours</Text>
      <Text style={[styles.caption, { color: palette.muted }]}>
        {`${formatDateRangeShort(days[0].date, days[days.length - 1].date)}. The line marks ${STANDARD_DAY_HOURS} h.`}
      </Text>
      <View style={styles.chart} testID="daily-hours-bars">
        <View style={[styles.refLine, { bottom: refBottom, backgroundColor: palette.controlBorder }]} />
        {days.map((d) => (
          <View
            key={d.date}
            accessible
            accessibilityLabel={`${d.date}: ${d.hours} hours`}
            style={styles.barSlot}
          >
            <View
              style={[
                styles.bar,
                {
                  height: Math.max(d.hours > 0 ? 2 : 0, (d.hours / scale) * CHART_HEIGHT),
                  backgroundColor: d.hours > STANDARD_DAY_HOURS ? palette.warning : palette.primary,
                },
              ]}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: typography.heading, fontWeight: '600' },
  caption: { fontSize: typography.caption, marginTop: 2, marginBottom: spacing.md },
  chart: { height: CHART_HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  barSlot: { flex: 1, height: CHART_HEIGHT, justifyContent: 'flex-end' },
  bar: { width: '100%', borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  refLine: { position: 'absolute', left: 0, right: 0, height: 1 },
});
