// Department picker: the server rejects any department not in
// public.departments, so mobile picks from the list instead of free text.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { borderRadius, spacing, typography, type Palette } from '../theme';
import { PressableScale } from './PressableScale';
import { SearchablePickerModal, type PickerItem } from './SearchablePickerModal';

const NONE_ID = '__none__';

interface DepartmentFieldProps {
  value: string;
  onChange: (department: string) => void;
  listDepartments: () => Promise<{ name: string }[]>;
  palette: Palette;
  accessibilityLabel?: string;
}

export function DepartmentField({ value, onChange, listDepartments, palette, accessibilityLabel = 'Department' }: DepartmentFieldProps) {
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listDepartments();
      setNames(rows.map(d => d.name));
      setError(null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not load departments.');
    } finally {
      setLoading(false);
    }
  }, [listDepartments]);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo<PickerItem[]>(() => {
    // Keep an unlisted current value visible so editing never silently clears it.
    const all = value && !names.includes(value) ? [value, ...names] : names;
    return [{ id: NONE_ID, name: 'None' }, ...all.map(n => ({ id: n, name: n }))];
  }, [names, value]);

  return (
    <>
      <PressableScale
        accessibilityLabel={`${accessibilityLabel}: ${value || 'None'}`}
        accessibilityRole="button"
        onPress={() => (error ? load() : setOpen(true))}
        style={[styles.field, { borderColor: palette.controlBorder }]}
      >
        <Text style={{ color: value ? palette.foreground : palette.placeholder, fontSize: typography.body }}>
          {value || 'None'}
        </Text>
      </PressableScale>
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: palette.error }]}>
          {error} Tap the field to retry.
        </Text>
      ) : null}
      <SearchablePickerModal
        visible={open}
        title="Department"
        items={items}
        selectedId={value || NONE_ID}
        onSelect={item => onChange(item.id === NONE_ID ? '' : item.name)}
        onClose={() => setOpen(false)}
        isLoading={loading}
        palette={palette}
      />
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    borderWidth: 1,
    borderRadius: borderRadius.control,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  error: { fontSize: typography.caption, marginTop: 4 },
});
