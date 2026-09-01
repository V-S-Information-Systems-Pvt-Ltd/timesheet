import React, { useCallback } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { useSessionActions } from '../auth/SessionProvider';
import { spacing, useScreenPalette } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { TimeEntryForm } from '../components/TimeEntryForm';

interface LogTimeScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
  onSuccess: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
}

export function LogTimeScreen({
  isDarkMode,
  onBack,
  onSuccess,
  onDirtyChange,
}: LogTimeScreenProps) {
  const palette = useScreenPalette(isDarkMode);
  const { createTimesheet } = useSessionActions();

  const handleSubmit = useCallback(
    async (values: {
      projectId: string;
      activityTypeId: string;
      hoursWorked: number;
      workDone: string;
      logDate: string;
    }) => {
      await createTimesheet(values);
      onSuccess();
    },
    [createTimesheet, onSuccess]
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
          backLabel="‹ Cancel"
          onBack={onBack}
          palette={palette}
          subtitle="Record daily project work hours"
          title="Log Time"
        />
        <TimeEntryForm
          isDarkMode={isDarkMode}
          mode="create"
          onDirtyChange={onDirtyChange}
          onSubmit={handleSubmit}
          submitLabel="Save Timesheet"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
});
