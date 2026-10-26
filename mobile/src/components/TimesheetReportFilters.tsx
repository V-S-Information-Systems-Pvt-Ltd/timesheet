import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ENTRY_TYPES, ENTRY_TYPE_LABELS, ACTIVITY_CODES, ACTIVITIES_BY_TYPE, ACTIVITY_LABELS, activityLabel } from '@vsis/contracts';
import type { ReportParams } from '../api/contracts';
import { spacing, typography, type Palette } from '../theme';
import { Chip } from './Chip';
import { SearchablePickerModal } from './SearchablePickerModal';

type Filters = Pick<ReportParams, 'entryType' | 'activityCode'>;

export function TimesheetReportFilters({ value, onChange, palette }: {
  value: Filters;
  onChange: (value: Filters) => void;
  palette: Palette;
}) {
  const [open, setOpen] = useState(false);
  const codes = value.entryType && value.entryType !== 'legacy'
    ? ACTIVITIES_BY_TYPE[value.entryType] : ACTIVITY_CODES;
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: palette.muted }]}>Type</Text>
      <View style={styles.chips}>
        <Chip active={!value.entryType} label="All types" palette={palette} onPress={() => onChange({})} />
        {ENTRY_TYPES.map(type => <Chip key={type} active={value.entryType === type}
          label={ENTRY_TYPE_LABELS[type]} palette={palette} onPress={() => onChange({ entryType: type })} />)}
        <Chip active={value.entryType === 'legacy'} label="Legacy" palette={palette}
          onPress={() => onChange({ entryType: 'legacy' })} />
      </View>
      {value.entryType !== 'legacy' ? <Pressable accessibilityRole="button" accessibilityLabel="Filter activity"
        onPress={() => setOpen(true)} style={[styles.activityRow, { borderTopColor: palette.hairline }]}>
        <Text style={[styles.label, { color: palette.muted }]}>Activity</Text>
        <Text style={[styles.activityValue, { color: palette.primaryText }]}>
          {value.activityCode ? activityLabel(value.activityCode) : 'All activities'}
        </Text>
      </Pressable> : null}
      <SearchablePickerModal visible={open} title="Filter Activity" palette={palette}
        searchPlaceholder="Search activities" selectedId={value.activityCode || ''}
        items={[{ id: '', name: 'All activities' }, ...codes.map(code => ({ id: code, name: ACTIVITY_LABELS[code] }))]}
        onClose={() => setOpen(false)} onSelect={item => {
          onChange({ ...value, activityCode: item.id ? item.id as ReportParams['activityCode'] : undefined });
          setOpen(false);
        }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: spacing.sm },
  label: { fontSize: typography.caption, fontWeight: '600', marginBottom: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  activityRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  activityValue: { fontSize: typography.body, fontWeight: '600' },
});
