import React, { useCallback, useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { useSessionActions } from '../auth/SessionProvider';
import { spacing, useTheme } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { TimeEntryForm } from '../components/TimeEntryForm';
import { formatDatePreview } from '../utils/dates';
import type { TimesheetEntry, CreateTimesheetInput } from '../api/contracts';

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
  const scrollRef = useRef<ScrollView>(null);
  // See LogTimeScreen: an update that outlives its form must not navigate away
  // from whatever draft replaced it.
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleSubmit = useCallback(
    async (values: CreateTimesheetInput) => {
      await updateTimesheet(entry.id, values);
      if (!isMountedRef.current) return;
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
        ref={scrollRef}
      >
        <ScreenHeader
          backLabel="‹ Timesheets"
          onBack={onBack}
          palette={palette}
          subtitle={`Editing entry on ${formatDatePreview(entry.log_date)}`}
          title="Edit Time"
        />
        <TimeEntryForm
          initialValues={{
            id: entry.id,
            projectId: entry.project_id,
            activityTypeId: entry.activity_type_id,
            entryType: entry.entry_type,
            activityCode: entry.activity_code,
            ticketNumber: entry.ticket_number,
            activityOther: entry.activity_other,
            hoursWorked: entry.hours_worked,
            workDone: entry.work_done,
            logDate: entry.log_date,
          }}
          isDarkMode={isDarkMode}
          mode="edit"
          onDirtyChange={onDirtyChange}
          onSubmit={handleSubmit}
          scrollViewRef={scrollRef}
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
