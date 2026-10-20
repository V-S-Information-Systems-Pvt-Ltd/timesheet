import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ENTRY_TYPES, ENTRY_TYPE_LABELS, ACTIVITIES_BY_TYPE, ACTIVITY_LABELS,
  newEntrySchema, logEntrySchema, normalizeClassification,
  requiresTicketNumber, requiresActivityOther,
  type EntryType, type ActivityCode, type CreateTimesheetInput,
} from '@vsis/contracts';
import { useSessionReference } from '../auth/SessionProvider';
import type { BatchUpdateTimesheetItem, TimesheetEntry } from '../api/contracts';
import { spacing, typography, borderRadius, type Palette } from '../theme';
import { PressableScale } from './PressableScale';
import { SearchablePickerModal, type PickerItem } from './SearchablePickerModal';
import { WindowsModal } from './WindowsModalHost';
import { entryWord } from '../utils/plural';

/** What the user changed; blank/unset fields keep each row's stored value. */
export interface BulkEditDraft {
  /** Historical rows only. */
  projectId: string;
  activityTypeId: string;
  /** New-format rows only; applied when `replaceClassification` is set. */
  replaceClassification: boolean;
  entryType: EntryType | '';
  classProjectId: string;
  activityCode: ActivityCode | '';
  ticketNumber: string;
  customer: string;
  activityOther: string;
}

export const emptyBulkEditDraft: BulkEditDraft = {
  projectId: '',
  activityTypeId: '',
  replaceClassification: false,
  entryType: '',
  classProjectId: '',
  activityCode: '',
  ticketNumber: '',
  customer: '',
  activityOther: '',
};

/** True when the draft would change at least one of the selected rows. */
export function hasBulkEditChanges(entries: TimesheetEntry[], draft: BulkEditDraft): boolean {
  const legacy = entries.some((e) => !e.entry_type);
  const current = entries.some((e) => Boolean(e.entry_type));
  return (legacy && Boolean(draft.projectId || draft.activityTypeId)) || (current && draft.replaceClassification);
}

/**
 * One payload row per entry, mirroring the web modal: stored format decides the
 * shape, so a v2 change never reclassifies a historical row. Every row is
 * validated with the same schemas as a single edit; the first problem is returned.
 */
export function buildBulkEditPayload(
  entries: TimesheetEntry[],
  draft: BulkEditDraft
): { payload: BatchUpdateTimesheetItem[]; error: string | null } {
  const payload: BatchUpdateTimesheetItem[] = [];
  for (const entry of entries) {
    const legacy = !entry.entry_type;
    const common = { hoursWorked: entry.hours_worked, workDone: entry.work_done, logDate: entry.log_date };
    let input: CreateTimesheetInput;
    if (legacy) {
      input = {
        ...common,
        projectId: draft.projectId || entry.project_id,
        activityTypeId: draft.activityTypeId || entry.activity_type_id,
      };
    } else if (draft.replaceClassification) {
      input = {
        ...common,
        projectId: draft.classProjectId || null,
        entryType: draft.entryType || null,
        activityCode: draft.activityCode || null,
        ticketNumber: draft.ticketNumber.trim() || null,
        customer: draft.customer.trim() || null,
        activityOther: draft.activityOther.trim() || null,
      };
    } else {
      input = {
        ...common,
        projectId: entry.project_id,
        entryType: entry.entry_type,
        activityCode: entry.activity_code ?? null,
        ticketNumber: entry.ticket_number ?? null,
        customer: entry.customer ?? null,
        activityOther: entry.activity_other ?? null,
      };
    }
    const parsed = (legacy ? logEntrySchema : newEntrySchema).safeParse(input);
    if (!parsed.success) {
      return { payload: [], error: parsed.error.issues[0]?.message ?? 'Check the selected values.' };
    }
    const checked = legacy
      ? input
      : { ...input, ...normalizeClassification(parsed.data as Parameters<typeof normalizeClassification>[0]), activityTypeId: null };
    payload.push({ ...checked, id: entry.id } as BatchUpdateTimesheetItem);
  }
  return { payload, error: null };
}

interface BulkEditModalProps {
  visible: boolean;
  entries: TimesheetEntry[];
  isLoading: boolean;
  onCancel: () => void;
  onSubmit: (payload: BatchUpdateTimesheetItem[]) => void;
  palette: Palette;
}

export function BulkEditModal({ visible, entries, isLoading, onCancel, onSubmit, palette }: BulkEditModalProps) {
  const { reference } = useSessionReference();
  const [draft, setDraft] = useState<BulkEditDraft>(emptyBulkEditDraft);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<'project' | 'activityType' | 'classProject' | null>(null);
  const isWindows = Platform.OS === 'windows';
  const ModalContainer = isWindows ? WindowsModal : Modal;

  // Reset whenever the modal is (re)opened for a new selection.
  const [lastEntries, setLastEntries] = useState(entries);
  if (lastEntries !== entries) {
    setLastEntries(entries);
    setDraft(emptyBulkEditDraft);
    setError(null);
  }

  const hasLegacy = entries.some((e) => !e.entry_type);
  const hasNew = entries.some((e) => Boolean(e.entry_type));
  const changed = hasBulkEditChanges(entries, draft);
  const patch = (next: Partial<BulkEditDraft>) => {
    setDraft((d) => ({ ...d, ...next }));
    setError(null);
  };

  const legacyProjects: PickerItem[] = useMemo(
    () => (reference?.projects ?? []).map((p) => ({ id: p.id, name: p.name, subtitle: p.so_number ? `SO: ${p.so_number}` : undefined })),
    [reference?.projects]
  );
  const timesheetProjects: PickerItem[] = useMemo(
    () =>
      (reference?.projects ?? [])
        .filter((p) => p.is_timesheet_project !== false)
        .map((p) => ({ id: p.id, name: p.name, subtitle: p.so_number ? `SO: ${p.so_number}` : undefined })),
    [reference?.projects]
  );
  const activityTypeItems: PickerItem[] = useMemo(
    () => (reference?.activityTypes ?? []).filter((a) => !a.entry_type).map((a) => ({ id: a.id, name: a.name })),
    [reference?.activityTypes]
  );
  const activityOptions = useMemo(() => {
    if (!draft.entryType) return [];
    const fromCatalogue = (reference?.activityTypes ?? [])
      .filter((a) => a.entry_type === draft.entryType && a.code && a.is_active !== false)
      .map((a) => ({ code: a.code as ActivityCode, label: a.name }));
    return fromCatalogue.length
      ? fromCatalogue
      : ACTIVITIES_BY_TYPE[draft.entryType].map((code) => ({ code, label: ACTIVITY_LABELS[code] }));
  }, [reference?.activityTypes, draft.entryType]);

  const nameOf = (items: PickerItem[], id: string) => items.find((i) => i.id === id)?.name;
  const needsTicket = Boolean(draft.entryType && draft.activityCode && requiresTicketNumber(draft.entryType, draft.activityCode));
  const needsOther = Boolean(draft.entryType && draft.activityCode && requiresActivityOther(draft.entryType, draft.activityCode));

  const handleSave = () => {
    const built = buildBulkEditPayload(entries, draft);
    if (built.error) {
      setError(built.error);
      return;
    }
    onSubmit(built.payload);
  };

  const field = (label: string, value: string, a11y: string, onPress: () => void) => (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: palette.foreground }]}>{label}</Text>
      <PressableScale
        accessibilityLabel={a11y}
        accessibilityRole="button"
        disabled={isLoading}
        onPress={onPress}
        style={[styles.select, { backgroundColor: palette.background, borderColor: palette.border }]}
      >
        <Text style={[styles.selectText, { color: value ? palette.foreground : palette.muted }]}>
          {value || 'Keep existing'}
        </Text>
      </PressableScale>
    </View>
  );

  const textField = (label: string, value: string, onChangeText: (v: string) => void, placeholder: string) => (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: palette.foreground }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!isLoading}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.placeholder}
        style={[styles.input, { backgroundColor: palette.background, color: palette.foreground, borderColor: palette.border }]}
        value={value}
      />
    </View>
  );

  const chip = (key: string, label: string, active: boolean, onPress: () => void) => (
    <PressableScale
      key={key}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      disabled={isLoading}
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: active ? palette.primary : palette.background, borderColor: active ? palette.primary : palette.border },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? palette.onPrimary : palette.foreground }]}>{label}</Text>
    </PressableScale>
  );

  return (
    <ModalContainer
      animationType="fade"
      onRequestClose={isLoading ? undefined : onCancel}
      transparent={true}
      visible={visible}
    >
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.safeContainer}>
          <View
            accessibilityViewIsModal
            style={[styles.dialog, { backgroundColor: palette.card, borderColor: palette.border }]}
          >
            <View style={[styles.header, { borderBottomColor: palette.border }]}>
              <Text style={[styles.title, { color: palette.foreground }]}>Edit Entries</Text>
              <Text style={[styles.subtitle, { color: palette.muted }]}>
                {`${entries.length} ${entryWord(entries.length)} selected. Only the fields you change are applied.`}
              </Text>
            </View>

            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" style={styles.bodyScroll}>
              {hasLegacy ? (
                <>
                  <Text style={[styles.hint, { color: palette.muted }]}>
                    Historical entries keep their stored Project + Activity Type format.
                  </Text>
                  {field('Project', nameOf(legacyProjects, draft.projectId) ?? '', 'Choose project', () => setPicker('project'))}
                  {field('Activity Type', nameOf(activityTypeItems, draft.activityTypeId) ?? '', 'Choose activity type', () => setPicker('activityType'))}
                </>
              ) : null}

              {hasNew ? (
                <>
                  {chip(
                    'replace',
                    draft.replaceClassification ? 'Changing Type / Activity (tap to cancel)' : 'Change Type / Activity for new-format entries',
                    draft.replaceClassification,
                    () => patch({ ...emptyBulkEditDraft, projectId: draft.projectId, activityTypeId: draft.activityTypeId, replaceClassification: !draft.replaceClassification })
                  )}
                  {draft.replaceClassification ? (
                    <>
                      <Text style={[styles.label, styles.chipLabel, { color: palette.foreground }]}>Type</Text>
                      <View style={styles.chipRow}>
                        {ENTRY_TYPES.map((type) =>
                          chip(type, ENTRY_TYPE_LABELS[type], draft.entryType === type, () =>
                            patch({ entryType: type, classProjectId: '', activityCode: '', ticketNumber: '', customer: '', activityOther: '' })
                          )
                        )}
                      </View>
                      {draft.entryType === 'project'
                        ? field('Project', nameOf(timesheetProjects, draft.classProjectId) ?? '', 'Choose project for new-format entries', () => setPicker('classProject'))
                        : null}
                      {draft.entryType ? (
                        <>
                          <Text style={[styles.label, styles.chipLabel, { color: palette.foreground }]}>Activity</Text>
                          <View style={styles.chipRow}>
                            {activityOptions.map(({ code, label }) =>
                              chip(code, label, draft.activityCode === code, () =>
                                patch({ activityCode: code, ticketNumber: '', customer: '', activityOther: '' })
                              )
                            )}
                          </View>
                        </>
                      ) : null}
                      {needsTicket ? textField('Customer', draft.customer, (customer) => patch({ customer }), 'Customer name') : null}
                      {needsTicket
                        ? textField('Ticket Number', draft.ticketNumber, (ticketNumber) => patch({ ticketNumber }), 'INC 00012345 or SVR 00012345')
                        : null}
                      {needsOther
                        ? textField('Other Activity', draft.activityOther, (activityOther) => patch({ activityOther }), 'Describe the activity')
                        : null}
                    </>
                  ) : null}
                </>
              ) : null}

              {error ? (
                <Text accessibilityRole="alert" style={[styles.error, { color: palette.error }]}>{error}</Text>
              ) : null}
            </ScrollView>

            <View style={[styles.footer, { borderTopColor: palette.border }]}>
              <PressableScale
                accessibilityLabel="Cancel bulk edit"
                accessibilityRole="button"
                disabled={isLoading}
                onPress={onCancel}
                style={[styles.cancelBtn, { borderColor: palette.border }]}
              >
                <Text style={[styles.cancelText, { color: palette.foreground }]}>Cancel</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Save changes"
                accessibilityRole="button"
                accessibilityState={{ disabled: isLoading || !changed }}
                disabled={isLoading || !changed}
                onPress={handleSave}
                style={[styles.saveBtn, { backgroundColor: changed ? palette.primary : palette.muted }]}
              >
                {isLoading ? (
                  <ActivityIndicator color={palette.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.saveText, { color: palette.onPrimary }]}>Save changes</Text>
                )}
              </PressableScale>
            </View>
          </View>
        </SafeAreaView>
      </View>

      <SearchablePickerModal
        items={picker === 'classProject' ? timesheetProjects : legacyProjects}
        onClose={() => setPicker(null)}
        onSelect={(item) => patch(picker === 'classProject' ? { classProjectId: item.id } : { projectId: item.id })}
        palette={palette}
        searchPlaceholder="Search projects by name or code..."
        selectedId={picker === 'classProject' ? draft.classProjectId : draft.projectId}
        title="Select Project"
        visible={picker === 'project' || picker === 'classProject'}
      />
      <SearchablePickerModal
        items={activityTypeItems}
        onClose={() => setPicker(null)}
        onSelect={(item) => patch({ activityTypeId: item.id })}
        palette={palette}
        searchPlaceholder="Search activity types..."
        selectedId={draft.activityTypeId}
        title="Select Activity Type"
        visible={picker === 'activityType'}
      />
    </ModalContainer>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  safeContainer: { width: '100%', maxWidth: 480, maxHeight: '100%', justifyContent: 'center' },
  dialog: { maxHeight: '100%', borderRadius: borderRadius.lg, borderWidth: 1, overflow: 'hidden' },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: typography.heading, fontWeight: '700' },
  subtitle: { fontSize: typography.caption, marginTop: 2 },
  bodyScroll: { flexGrow: 0, flexShrink: 1 },
  body: { padding: spacing.lg },
  hint: { fontSize: typography.caption, marginBottom: spacing.sm },
  fieldGroup: { marginBottom: spacing.md },
  label: { fontSize: typography.caption, fontWeight: '600', marginBottom: spacing.xs },
  chipLabel: { marginTop: spacing.md },
  select: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: borderRadius.md, borderWidth: 1 },
  selectText: { fontSize: typography.body },
  input: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    fontSize: typography.body,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: borderRadius.md, borderWidth: 1 },
  chipText: { fontSize: typography.caption, fontWeight: '600' },
  error: { fontSize: typography.caption, marginTop: spacing.xs },
  footer: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  cancelBtn: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.md, borderWidth: 1 },
  cancelText: { fontSize: typography.body, fontWeight: '600' },
  saveBtn: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.md },
  saveText: { fontSize: typography.body, fontWeight: '700' },
});
