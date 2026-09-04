import React, { useCallback } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { useSessionActions } from '../auth/SessionProvider';
import { spacing, useTheme } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { TimeEntryForm } from '../components/TimeEntryForm';
import type { TimesheetEntry } from '../api/contracts';

interface EditTimeScreenProps {
  entry: TimesheetEntry;
  isDarkMode: boolean;
  onBack: () => void;
  onSuccess: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
}

export function EditTimeScreen({
  entry,
  isDarkMode,
  onBack,
  onSuccess,
  onDirtyChange,
}: EditTimeScreenProps) {
  const palette = useTheme().palette;
  const { updateTimesheet } = useSessionActions();

  const handleSubmit = useCallback(
    async (values: {
      projectId: string;
      activityTypeId: string;
      hoursWorked: number;
      workDone: string;
      logDate: string;
    }) => {
      await updateTimesheet(entry.id, values);
      onSuccess();
    },
    [updateTimesheet, entry.id, onSuccess]
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: palette.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader
          backLabel="‹ Timesheets"
          onBack={onBack}
          palette={palette}
          subtitle={`Editing entry on ${entry.log_date}`}
          title="Edit Time"
        />
        <TimeEntryForm
          initialValues={{
            id: entry.id,
            projectId: entry.project_id,
            activityTypeId: entry.activity_type_id,
            hoursWorked: entry.hours_worked,
            workDone: entry.work_done,
            logDate: entry.log_date,
          }}
          isDarkMode={isDarkMode}
          mode="edit"
          onDirtyChange={onDirtyChange}
          onSubmit={handleSubmit}
          submitLabel="Update Timesheet"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
});
