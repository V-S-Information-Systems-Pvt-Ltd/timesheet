// mobile/src/components/MissingDaysStrip.tsx
// Month strip for Home, matching the web dashboard's MissingRibbon
// (app/dashboard/missing-ribbon.tsx): every day of this month coloured as
// logged / missing / leave / holiday. Tapping a missing day starts Log Time
// on that date. The server still enforces the backfill window on save.
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { holidaysInYear } from '@vsis/core';
import type { LeaveRow, TimesheetListParams, TimesheetListResult } from '../api/contracts';
import { borderRadius, spacing, typography, useTheme } from '../theme';
import { PressableScale } from './PressableScale';

// ponytail: one 1000-row page (the server maximum) covers a user's month; a
// full page is treated as incomplete so the strip never reports false gaps.
const PAGE_SIZE = 1000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export type DayState = 'holiday' | 'leave' | 'logged' | 'weekend' | 'future' | 'missing';

/** Same precedence as the web `missingDayCell`: holiday, leave, logged, weekend, future, missing. */
export function dayState(iso: string, weekend: boolean, today: string, hours: Map<string, number>, leave: Set<string>, holidays: Map<string, string>): DayState {
  if (holidays.has(iso)) return 'holiday';
  if (leave.has(iso)) return 'leave';
  if (hours.get(iso)) return 'logged';
  if (weekend) return 'weekend';
  if (iso > today) return 'future';
  return 'missing';
}

interface MissingDaysStripProps {
  userId: string;
  /** Local ISO date (YYYY-MM-DD). */
  today: string;
  /** Changes whenever entries may have changed, to reload the month. */
  refreshKey?: unknown;
  listTimesheets: (params: TimesheetListParams) => Promise<TimesheetListResult>;
  listLeaves: (params: { from: string; to: string }) => Promise<LeaveRow[]>;
  onPick: (iso: string) => void;
  /** Earliest writable date; missing days before it stay red but are not tappable. */
  minLogDate?: string;
  /** Reports the month's totals once loaded, or null when the read fails. */
  onMonthLoaded?: (totals: { hours: number; entries: number } | null) => void;
}

export function MissingDaysStrip({ userId, today, refreshKey, listTimesheets, listLeaves, onPick, minLogDate, onMonthLoaded }: MissingDaysStripProps) {
  const palette = useTheme().palette;
  const [data, setData] = useState<{ hours: Map<string, number>; leave: Set<string> } | null>(null);
  const [failed, setFailed] = useState(false);
  const monthStart = `${today.slice(0, 7)}-01`;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [page, leaves] = await Promise.all([
          listTimesheets({ userId, dateFrom: monthStart, dateTo: today, from: 0, to: PAGE_SIZE - 1 }),
          listLeaves({ from: monthStart, to: today }),
        ]);
        if (!live) return;
        if (page.rows.length >= PAGE_SIZE) throw new Error('incomplete month');
        const hours = new Map<string, number>();
        for (const t of page.rows) {
          if (t.user_id !== userId) continue;
          hours.set(t.log_date, (hours.get(t.log_date) ?? 0) + Number(t.hours_worked));
        }
        const leave = new Set(leaves.filter(l => l.user_id === userId).map(l => l.leave_date));
        setFailed(false);
        setData({ hours, leave });
        onMonthLoaded?.({ hours: [...hours.values()].reduce((a, b) => a + b, 0), entries: page.rows.filter(t => t.user_id === userId).length });
      } catch {
        if (live) {
          setFailed(true);
          onMonthLoaded?.(null);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [userId, today, monthStart, refreshKey, listTimesheets, listLeaves, onMonthLoaded]);

  const days = useMemo(() => {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7)) - 1;
    const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Array.from({ length: count }, (_, i) => {
      const date = new Date(Date.UTC(year, month, i + 1));
      const weekday = date.getUTCDay();
      return { iso: date.toISOString().slice(0, 10), day: i + 1, weekday, weekend: weekday === 0 || weekday === 6 };
    });
  }, [today]);

  const holidays = useMemo(
    () => new Map(holidaysInYear(Number(today.slice(0, 4))).filter(h => h.mercantile).map(h => [h.date, h.name])),
    [today]
  );

  if (failed) return null;

  const states = data ? days.map(d => dayState(d.iso, d.weekend, today, data.hours, data.leave, holidays)) : null;
  const missing = states ? states.filter(s => s === 'missing').length : 0;
  const monthName = MONTHS[Number(today.slice(5, 7)) - 1];
  const summary = !states
    ? 'Checking your month…'
    : missing === 0
      ? 'Nothing missing so far.'
      : `${missing} working day${missing === 1 ? '' : 's'} missing. Tap one to log it.`;

  const look: Record<DayState, { bg?: string; fg: string; border?: string; bold?: boolean; dim?: boolean }> = {
    holiday: { bg: palette.primary, fg: palette.onPrimary, bold: true },
    leave: { bg: palette.infoBoxBg, fg: palette.info },
    logged: { bg: palette.successBoxBg, fg: palette.successText },
    weekend: { fg: palette.muted, dim: true },
    future: { fg: palette.muted },
    missing: { bg: palette.errorBoxBg, fg: palette.error, border: palette.error, bold: true },
  };

  return (
    <View
      accessibilityLabel={`${monthName} logging`}
      style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}
    >
      <Text style={[styles.title, { color: palette.foreground }]}>{monthName}</Text>
      <Text accessibilityLiveRegion="polite" style={[styles.summary, { color: palette.muted }]}>{summary}</Text>
      <View style={styles.grid}>
        {days.map((d, i) => {
          const state = states?.[i];
          const s = state ? look[state] : { fg: palette.muted, dim: true };
          const title = state === 'holiday' ? holidays.get(d.iso)
            : state === 'leave' ? 'Leave'
            : state === 'logged' ? `${data!.hours.get(d.iso)}h logged`
            : state === 'missing' ? 'Missing' : undefined;
          const cellStyle = [
            styles.cell,
            { backgroundColor: s.bg ?? 'transparent', borderColor: s.border ?? 'transparent', opacity: s.dim ? 0.6 : 1 },
            d.iso === today && [styles.today, { borderColor: palette.primary }],
          ];
          const inner = (
            <>
              <Text style={[styles.weekday, { color: s.fg }]}>{'SMTWTFS'[d.weekday]}</Text>
              <Text style={[styles.day, s.bold && styles.bold, { color: s.fg }]}>{d.day}</Text>
            </>
          );
          const label = `${d.iso}${title ? `: ${title}` : ''}`;
          return state === 'missing' && !(minLogDate && d.iso < minLogDate) ? (
            <PressableScale
              key={d.iso}
              accessibilityLabel={`${label}, log time for this day`}
              accessibilityRole="button"
              onPress={() => onPick(d.iso)}
              style={cellStyle}
            >
              {inner}
            </PressableScale>
          ) : (
            <View key={d.iso} accessibilityLabel={label} accessible style={cellStyle}>
              {inner}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  title: { fontSize: typography.body, fontWeight: '600' },
  summary: { fontSize: typography.caption, marginTop: 2, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  cell: {
    width: 34,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
  },
  today: { borderWidth: 2 },
  bold: { fontWeight: '700' },
  weekday: { fontSize: 9, lineHeight: 10, opacity: 0.7 },
  day: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
