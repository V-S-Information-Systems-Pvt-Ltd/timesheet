import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { ENTRY_TYPES, ENTRY_TYPE_LABELS, ACTIVITY_CODES, ACTIVITIES_BY_TYPE, ACTIVITY_LABELS } from '@vsis/contracts';
import type { ReportParams } from '../api/contracts';
import { spacing, type Palette } from '../theme';
import { FilterTab } from './FilterTab';
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
    <View style={{ gap: spacing.xs, marginVertical: spacing.sm }}>
      <Text style={{ color: palette.foreground }}>Type</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        <FilterTab active={!value.entryType} label="All types" palette={palette} onPress={() => onChange({})} />
        {ENTRY_TYPES.map(type => <FilterTab key={type} active={value.entryType === type}
          label={ENTRY_TYPE_LABELS[type]} palette={palette} onPress={() => onChange({ entryType: type })} />)}
        <FilterTab active={value.entryType === 'legacy'} label="Legacy" palette={palette}
          onPress={() => onChange({ entryType: 'legacy' })} />
      </View>
      {value.entryType !== 'legacy' ? <Pressable accessibilityRole="button" accessibilityLabel="Filter activity"
        onPress={() => setOpen(true)} style={{ padding: spacing.sm }}>
        <Text style={{ color: palette.primary }}>Activity: {value.activityCode ? ACTIVITY_LABELS[value.activityCode] : 'All activities'}</Text>
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
