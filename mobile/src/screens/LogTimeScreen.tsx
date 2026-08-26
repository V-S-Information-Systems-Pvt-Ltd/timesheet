import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { colors, spacing, typography } from '../theme';

interface LogTimeScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
  onSuccess: () => void;
}

export function LogTimeScreen({ isDarkMode, onBack, onSuccess }: LogTimeScreenProps) {
  const palette = getPalette(isDarkMode);
  const { reference, loadReference, createTimesheet } = useSession();

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const [logDate, setLogDate] = useState(today);
  const [projectId, setProjectId] = useState('');
  const [activityTypeId, setActivityTypeId] = useState('');
  const [hoursWorked, setHoursWorked] = useState('');
  const [workDone, setWorkDone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadReference();
  }, [loadReference]);

  // Set default project & activity if available
  useEffect(() => {
    if (reference?.projects?.length && !projectId) {
      setProjectId(reference.projects[0].id);
    }
    if (reference?.activityTypes?.length && !activityTypeId) {
      setActivityTypeId(reference.activityTypes[0].id);
    }
  }, [reference, projectId, activityTypeId]);

  async function handleSubmit() {
    setError(null);
    const parsedHours = parseFloat(hoursWorked);

    if (!logDate) {
      setError('Date is required.');
      return;
    }
    if (!projectId) {
      setError('Please select a project.');
      return;
    }
    if (!activityTypeId) {
      setError('Please select an activity type.');
      return;
    }
    if (isNaN(parsedHours) || parsedHours <= 0 || parsedHours > 24) {
      setError('Please enter valid hours between 0.25 and 24.');
      return;
    }
    if (!workDone.trim()) {
      setError('Work description is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      await createTimesheet({
        projectId,
        activityTypeId,
        hoursWorked: parsedHours,
        workDone: workDone.trim(),
        logDate,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log timesheet entry.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: palette.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            onPress={onBack}
            style={styles.backButton}
          >
            <Text style={[styles.backButtonText, { color: colors.primary }]}>‹ Cancel</Text>
          </Pressable>
          <Text style={[styles.title, { color: palette.foreground }]}>Log Time</Text>
        </View>

        {error ? (
          <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
            <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          </View>
        ) : null}

        {/* Date Selector */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Log Date (YYYY-MM-DD)</Text>
          <View style={styles.dateRow}>
            <TextInput
              accessibilityLabel="Log Date"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setLogDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={palette.placeholder}
              style={[
                styles.input,
                styles.dateInput,
                { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground },
              ]}
              value={logDate}
            />
            <Pressable
              accessibilityLabel="Set to today"
              accessibilityRole="button"
              onPress={() => setLogDate(today)}
              style={[
                styles.presetButton,
                logDate === today && styles.presetButtonActive,
                { borderColor: palette.border },
              ]}
            >
              <Text style={[styles.presetText, logDate === today ? styles.presetTextActive : { color: palette.foreground }]}>
                Today
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Set to yesterday"
              accessibilityRole="button"
              onPress={() => setLogDate(yesterday)}
              style={[
                styles.presetButton,
                logDate === yesterday && styles.presetButtonActive,
                { borderColor: palette.border },
              ]}
            >
              <Text style={[styles.presetText, logDate === yesterday ? styles.presetTextActive : { color: palette.foreground }]}>
                Yesterday
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Project Selection */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Project</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionsScroll}>
            {reference?.projects?.map((proj) => {
              const active = proj.id === projectId;
              return (
                <Pressable
                  key={proj.id}
                  accessibilityLabel={proj.name}
                  accessibilityRole="button"
                  onPress={() => setProjectId(proj.id)}
                  style={[
                    styles.chip,
                    active ? styles.chipActive : { backgroundColor: palette.card, borderColor: palette.border },
                  ]}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : { color: palette.foreground }]}>
                    {proj.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Activity Type Selection */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Activity Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionsScroll}>
            {reference?.activityTypes?.map((act) => {
              const active = act.id === activityTypeId;
              return (
                <Pressable
                  key={act.id}
                  accessibilityLabel={act.name}
                  accessibilityRole="button"
                  onPress={() => setActivityTypeId(act.id)}
                  style={[
                    styles.chip,
                    active ? styles.chipActive : { backgroundColor: palette.card, borderColor: palette.border },
                  ]}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : { color: palette.foreground }]}>
                    {act.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Hours Worked */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Hours Worked</Text>
          <TextInput
            accessibilityLabel="Hours Worked"
            keyboardType="decimal-pad"
            onChangeText={setHoursWorked}
            placeholder="e.g. 7.5"
            placeholderTextColor={palette.placeholder}
            style={[
              styles.input,
              { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground },
            ]}
            value={hoursWorked}
          />
        </View>

        {/* Work Description */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Work Done / Description</Text>
          <TextInput
            accessibilityLabel="Work Done"
            multiline
            numberOfLines={4}
            onChangeText={setWorkDone}
            placeholder="Describe what you worked on..."
            placeholderTextColor={palette.placeholder}
            style={[
              styles.input,
              styles.textArea,
              { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground },
            ]}
            textAlignVertical="top"
            value={workDone}
          />
        </View>

        {/* Submit Button */}
        <Pressable
          accessibilityLabel="Save timesheet entry"
          accessibilityRole="button"
          accessibilityState={{ busy: isSubmitting }}
          disabled={isSubmitting}
          onPress={handleSubmit}
          style={({ pressed }) => [
            styles.button,
            (pressed || isSubmitting) && styles.buttonPressed,
          ]}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>Save Timesheet</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function getPalette(isDarkMode: boolean) {
  return isDarkMode
    ? {
        background: colors.darkBackground,
        foreground: colors.darkForeground,
        muted: colors.darkMuted,
        card: colors.darkCard,
        border: colors.darkBorder,
        placeholder: colors.darkPlaceholder,
        errorBoxBg: '#3A1E1E',
      }
    : {
        background: colors.background,
        foreground: colors.foreground,
        muted: colors.muted,
        card: colors.card,
        border: colors.border,
        placeholder: colors.placeholder,
        errorBoxBg: colors.errorLight,
      };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: spacing.lg },
  header: { marginBottom: spacing.md },
  backButton: { alignSelf: 'flex-start', marginBottom: spacing.xs, paddingVertical: spacing.xs },
  backButtonText: { fontSize: typography.body, fontWeight: '600' },
  title: { fontSize: typography.title, fontWeight: '800', letterSpacing: -0.5 },
  errorBox: {
    borderRadius: 10,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  fieldGroup: { marginBottom: spacing.md },
  fieldLabel: { fontSize: typography.caption, fontWeight: '700', marginBottom: spacing.xs },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: typography.body,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  dateRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  dateInput: { flex: 1 },
  presetButton: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  presetButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetText: { fontSize: typography.caption, fontWeight: '600' },
  presetTextActive: { color: colors.onPrimary },
  optionsScroll: { flexDirection: 'row', marginVertical: spacing.xs },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: typography.caption, fontWeight: '600' },
  chipTextActive: { color: colors.onPrimary },
  textArea: { minHeight: 96, paddingTop: spacing.sm },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  buttonPressed: { opacity: 0.75 },
  buttonText: { color: colors.onPrimary, fontSize: typography.body, fontWeight: '700' },
});
