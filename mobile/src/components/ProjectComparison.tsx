// "Compare periods" section of the privileged reports: one project, two date
// ranges, two getReports calls, side-by-side totals and the delta. Mirrors the
// web's "Compare Project Across Periods". Errors stay inside this section.
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { presetRange, type Preset } from '@vsis/core';
import { borderRadius, fonts, spacing, typography, numeralSizes, type Palette } from '../theme';
import { PressableScale } from './PressableScale';
import { DateChooserModal } from './DateChooserModal';
import { Chip } from './Chip';
import type { ReportParams, ReportTotals } from '../api/contracts';
import { isValidISODate, todayISO } from '../utils/dates';

type ComparePreset = Extract<Preset, 'this' | 'last' | 'prev2' | 'custom'>;

interface Period {
  preset: ComparePreset;
  from: string;
  to: string;
}

const PRESETS: { key: ComparePreset; label: string }[] = [
  { key: 'this', label: 'This month' },
  { key: 'last', label: 'Last month' },
  { key: 'prev2', label: '2 months ago' },
  { key: 'custom', label: 'Custom' },
];

export interface ProjectComparisonProps {
  projects: { id: string; name: string }[];
  getReports: (params?: ReportParams) => Promise<ReportTotals>;
  palette: Palette;
}

function rangeOf(p: Period): { from: string; to: string } {
  const r = presetRange(p.preset, p.from, p.to);
  return { from: r.start, to: r.end };
}

function periodError(label: string, p: Period): string | null {
  if (p.preset !== 'custom') return null;
  if (!isValidISODate(p.from) || !isValidISODate(p.to)) return `${label}: choose a start and end date.`;
  if (p.from > p.to) return `${label}: "From" must be on or before "To".`;
  return null;
}

export function formatDelta(a: number, b: number): { hours: string; percent: string } {
  const diff = b - a;
  const sign = diff > 0 ? '+' : '';
  const percent = a === 0 ? (b === 0 ? '0%' : 'n/a') : `${sign}${((diff / a) * 100).toFixed(1)}%`;
  return { hours: `${sign}${diff.toFixed(1)} hrs`, percent };
}

export function ProjectComparison({ projects, getReports, palette }: ProjectComparisonProps) {
  const [projectId, setProjectId] = useState('');
  const monthStart = `${todayISO().slice(0, 7)}-01`;
  const [a, setA] = useState<Period>({ preset: 'this', from: monthStart, to: todayISO() });
  const [b, setB] = useState<Period>({ preset: 'last', from: monthStart, to: todayISO() });
  const [picker, setPicker] = useState<{ which: 'a' | 'b'; field: 'from' | 'to' } | null>(null);
  const [totals, setTotals] = useState<{ a: number; b: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTotals(null);
    if (!projectId) {
      setError(null);
      return;
    }
    const invalid = periodError('Period A', a) ?? periodError('Period B', b);
    if (invalid) {
      setError(invalid);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const ra = rangeOf(a);
    const rb = rangeOf(b);
    Promise.all([
      getReports({ project: projectId, from: ra.from, to: ra.to }),
      getReports({ project: projectId, from: rb.from, to: rb.to }),
    ])
      .then(([resA, resB]) => {
        if (cancelled) return;
        setTotals({ a: Number(resA?.totalHours) || 0, b: Number(resB?.totalHours) || 0 });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error && err.message ? err.message : 'Could not load comparison data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, a, b, getReports]);

  const renderPeriod = (which: 'a' | 'b', label: string, period: Period, set: (p: Period) => void) => (
    <View style={styles.periodBlock}>
      <Text style={[styles.label, { color: palette.muted }]}>{label}</Text>
      <View style={styles.row}>
        {PRESETS.map((p) => (
          <Chip
            key={p.key}
            accessibilityLabel={`${label} ${p.label}`}
            active={period.preset === p.key}
            label={p.label}
            onPress={() => set({ ...period, preset: p.key })}
            palette={palette}
          />
        ))}
      </View>
      {period.preset === 'custom' ? (
        <View style={styles.row}>
          {(['from', 'to'] as const).map((field) => (
            <PressableScale
              key={field}
              accessibilityLabel={`${label} ${field} date: ${period[field]}`}
              accessibilityRole="button"
              onPress={() => setPicker({ which, field })}
              style={[styles.dateBtn, { borderColor: palette.controlBorder }]}
            >
              <Text style={[styles.dateText, { color: palette.foreground }]}>
                {field === 'from' ? 'From' : 'To'}: {period[field]}
              </Text>
            </PressableScale>
          ))}
        </View>
      ) : (
        <Text style={[styles.caption, { color: palette.muted }]}>
          {rangeOf(period).from} to {rangeOf(period).to}
        </Text>
      )}
    </View>
  );

  const delta = totals ? formatDelta(totals.a, totals.b) : null;
  const pickerPeriod = picker?.which === 'a' ? a : b;

  return (
    <View
      accessibilityLabel="Compare periods"
      style={[styles.section, { borderBottomColor: palette.hairline }]}
    >
      <Text style={[styles.title, { color: palette.foreground }]}>Compare periods</Text>
      <Text style={[styles.label, { color: palette.muted }]}>Project</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.projectScroll}>
        {projects.map((p) => (
          <View key={p.id} style={styles.projectChip}>
            <Chip
              accessibilityLabel={`Compare project ${p.name}`}
              active={projectId === p.id}
              label={p.name}
              onPress={() => setProjectId(projectId === p.id ? '' : p.id)}
              palette={palette}
            />
          </View>
        ))}
      </ScrollView>

      {renderPeriod('a', 'Period A', a, setA)}
      {renderPeriod('b', 'Period B', b, setB)}

      {!projectId ? (
        <Text style={[styles.caption, { color: palette.muted }]}>Pick a project to compare.</Text>
      ) : error ? (
        <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.error }]}>
          Comparison failed: {error}
        </Text>
      ) : loading ? (
        <Text style={[styles.caption, { color: palette.muted }]}>Comparing…</Text>
      ) : totals && delta ? (
        <View style={styles.results}>
          <View style={styles.row}>
            <Text style={[styles.stat, { color: palette.foreground }]}>A: {totals.a.toFixed(1)} hrs</Text>
            <Text style={[styles.stat, { color: palette.foreground }]}>B: {totals.b.toFixed(1)} hrs</Text>
          </View>
          <Text accessibilityLabel="Comparison delta" style={[styles.delta, { color: palette.primary }]}>
            Change (B vs A): {delta.hours} ({delta.percent})
          </Text>
        </View>
      ) : null}

      <DateChooserModal
        visible={picker !== null}
        title={picker ? `${picker.which === 'a' ? 'Period A' : 'Period B'} ${picker.field === 'from' ? 'start' : 'end'} date` : ''}
        initialDate={picker ? pickerPeriod[picker.field] : undefined}
        dateInputLabel="Comparison date"
        previewLabel="Selected:"
        confirmLabel="Use date"
        confirmAccessibilityLabel="Confirm comparison date"
        cancelAccessibilityLabel="Cancel comparison date"
        palette={palette}
        onCancel={() => setPicker(null)}
        onConfirm={(date) => {
          if (picker) {
            const set = picker.which === 'a' ? setA : setB;
            set({ ...pickerPeriod, [picker.field]: date });
          }
          setPicker(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: spacing.md,
    gap: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: typography.heading, fontWeight: '600' },
  label: { fontSize: typography.caption, fontWeight: '600' },
  caption: { fontSize: typography.caption },
  projectScroll: { flexDirection: 'row' },
  periodBlock: { gap: spacing.xs, marginTop: spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  projectChip: { marginRight: spacing.sm },
  dateBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.control,
    borderWidth: 1,
  },
  dateText: { fontSize: typography.caption },
  results: { gap: spacing.xs, marginTop: spacing.xs },
  stat: {
    fontFamily: fonts.numeral,
    fontSize: numeralSizes.sm,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginRight: spacing.md,
  },
  delta: { fontSize: typography.body, fontWeight: '600' },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
});
