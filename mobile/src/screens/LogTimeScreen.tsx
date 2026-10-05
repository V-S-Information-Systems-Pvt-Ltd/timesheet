import React, { useCallback, useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { useSessionActions } from '../auth/SessionProvider';
import { spacing, useTheme } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { TimeEntryForm, type TimeEntryFormInitialValues } from '../components/TimeEntryForm';
import type { CreateTimesheetInput } from '../api/contracts';

interface LogTimeScreenProps {
  isDarkMode: boolean;
  initialValues?: TimeEntryFormInitialValues;
  replacementId?: string;
  onBack: () => void;
  /** Receives whether the write reached the server or only the offline queue. */
  onSuccess: (outcome: { queued: boolean }) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}

export function LogTimeScreen({
  isDarkMode,
  initialValues,
  replacementId,
  onBack,
  onSuccess,
  onDirtyChange,
}: LogTimeScreenProps) {
  const palette = useTheme().palette;
  const { createTimesheet, replaceLegacyTimesheet } = useSessionActions();
  // The form validates below the fold on a long entry; it needs this ref to
  // bring the first invalid field back into view on a failed submit.
  const scrollRef = useRef<ScrollView>(null);
  // A save can outlive its form: the user may discard the entry and start a new
  // draft while the write is still in flight. Reporting that completion would
  // navigate away from the newer draft and clear its unsaved-changes guard, so
  // the result is dropped once this screen is gone.
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleSubmit = useCallback(
    async (values: CreateTimesheetInput) => {
      const result = replacementId
        ? await replaceLegacyTimesheet(replacementId, values)
        : await createTimesheet(values);
      if (!isMountedRef.current) return;
      onSuccess({ queued: result.queued });
    },
    [createTimesheet, replaceLegacyTimesheet, replacementId, onSuccess]
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
          backLabel="‹ Cancel"
          onBack={onBack}
          palette={palette}
          subtitle="Record daily project work hours"
          title="Log Time"
        />
        <TimeEntryForm
          initialValues={initialValues}
          isDarkMode={isDarkMode}
          mode="create"
          onDirtyChange={onDirtyChange}
          onSubmit={handleSubmit}
          scrollViewRef={scrollRef}
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
