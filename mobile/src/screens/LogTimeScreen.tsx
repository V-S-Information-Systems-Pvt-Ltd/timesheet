import React, { useEffect, useMemo, useState, useCallback } from 'react';
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
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';

import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { SearchablePickerModal, type PickerItem } from '../components/SearchablePickerModal';

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

  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const [isActivityPickerOpen, setIsActivityPickerOpen] = useState(false);

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

  const selectedProject = useMemo(
    () => reference?.projects?.find((p) => p.id === projectId),
    [reference?.projects, projectId]
  );

  const projectPickerItems: PickerItem[] = useMemo(
    () =>
      reference?.projects?.map((p) => ({
        id: p.id,
        name: p.name,
        subtitle: p.code ? `Code: ${p.code}` : undefined,
        badge: p.status ? p.status.toUpperCase() : undefined,
      })) ?? [],
    [reference?.projects]
  );

  const activityPickerItems: PickerItem[] = useMemo(
    () =>
      reference?.activityTypes?.map((a) => ({
        id: a.id,
        name: a.name,
        subtitle: a.code ? `Code: ${a.code}` : undefined,
      })) ?? [],
    [reference?.activityTypes]
  );

  const handleSelectProject = useCallback((item: PickerItem) => {
    setProjectId(item.id);
  }, []);

  const handleSelectActivity = useCallback((item: PickerItem) => {
    setActivityTypeId(item.id);
  }, []);

  function addHours(delta: number) {
    const current = parseFloat(hoursWorked) || 0;
    const updated = Math.min(24, Math.max(0, current + delta));
    setHoursWorked(updated > 0 ? String(updated) : '');
  }

  function setDirectHours(hrs: number) {
    setHoursWorked(String(hrs));
  }

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

  const quickProjects = reference?.projects?.slice(0, 4) ?? [];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: palette.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <ScreenHeader
          title="Log Time"
          onBack={onBack}
          backLabel="‹ Cancel"
          palette={palette}
        />

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
            <PressableScale
              accessibilityLabel="Set to today"
              accessibilityRole="button"
              accessibilityState={{ selected: logDate === today }}
              onPress={() => setLogDate(today)}
              style={[
                styles.presetButton,
                logDate === today && styles.presetButtonActive,
                { borderColor: palette.border, backgroundColor: palette.card },
              ]}
            >
              <Text style={[styles.presetText, logDate === today ? styles.presetTextActive : { color: palette.foreground }]}>
                Today
              </Text>
            </PressableScale>
            <PressableScale
              accessibilityLabel="Set to yesterday"
              accessibilityRole="button"
              accessibilityState={{ selected: logDate === yesterday }}
              onPress={() => setLogDate(yesterday)}
              style={[
                styles.presetButton,
                logDate === yesterday && styles.presetButtonActive,
                { borderColor: palette.border, backgroundColor: palette.card },
              ]}
            >
              <Text style={[styles.presetText, logDate === yesterday ? styles.presetTextActive : { color: palette.foreground }]}>
                Yesterday
              </Text>
            </PressableScale>
          </View>
        </View>

        {/* Project Selection */}
        <View style={styles.fieldGroup}>
          <View style={styles.fieldLabelRow}>
            <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Project</Text>
            <Pressable
              accessibilityLabel="Browse and search all projects"
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => setIsProjectPickerOpen(true)}
            >
              <Text style={[styles.browseLink, { color: colors.primary }]}>Search / All →</Text>
            </Pressable>
          </View>

          {/* Main Selected Project Trigger Card */}
          <PressableScale
            accessibilityLabel={`Selected project: ${selectedProject?.name || 'None'}. Tap to search or change project`}
            accessibilityRole="button"
            onPress={() => setIsProjectPickerOpen(true)}
            style={[
              styles.pickerTriggerCard,
              { backgroundColor: palette.card, borderColor: palette.border },
            ]}
          >
            <View style={styles.pickerTriggerLeft}>
              <View style={[styles.pickerIconBadge, { backgroundColor: palette.badgeBg }]}>
                <Text style={styles.pickerIconText}>📁</Text>
              </View>
              <View style={styles.pickerTriggerInfo}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.pickerTriggerName,
                    { color: selectedProject ? palette.foreground : palette.placeholder },
                  ]}
                >
                  {selectedProject?.name || 'Select a project...'}
                </Text>
                {selectedProject?.code ? (
                  <Text style={[styles.pickerTriggerSubtitle, { color: palette.muted }]}>
                    Code: {selectedProject.code}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.pickerTriggerRight}>
              <Text style={[styles.pickerActionLabel, { color: colors.primary }]}>Change ▾</Text>
            </View>
          </PressableScale>

          {/* Quick Select Project Chips */}
          {quickProjects.length > 0 ? (
            <View style={styles.quickProjectsContainer}>
              <Text style={[styles.quickLabel, { color: palette.muted }]}>Quick select:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionsScroll}>
                {quickProjects.map((proj) => {
                  const active = proj.id === projectId;
                  return (
                    <PressableScale
                      key={proj.id}
                      accessibilityLabel={`Quick select project ${proj.name}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => setProjectId(proj.id)}
                      style={[
                        styles.chip,
                        active
                          ? styles.chipActive
                          : { backgroundColor: palette.card, borderColor: palette.border },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.chipText,
                          active ? styles.chipTextActive : { color: palette.foreground },
                        ]}
                      >
                        {proj.name}
                      </Text>
                    </PressableScale>
                  );
                })}
                <PressableScale
                  accessibilityLabel="Browse more projects"
                  accessibilityRole="button"
                  onPress={() => setIsProjectPickerOpen(true)}
                  style={[
                    styles.chip,
                    styles.moreChip,
                    { backgroundColor: palette.badgeBg, borderColor: palette.border },
                  ]}
                >
                  <Text style={[styles.chipText, styles.moreChipText, { color: colors.primary }]}>
                    + Browse ({reference?.projects?.length ?? 0})
                  </Text>
                </PressableScale>
              </ScrollView>
            </View>
          ) : null}
        </View>

        {/* Activity Type Selection */}
        <View style={styles.fieldGroup}>
          <View style={styles.fieldLabelRow}>
            <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Activity Type</Text>
            {activityPickerItems.length > 4 ? (
              <Pressable
                accessibilityLabel="Browse all activity types"
                accessibilityRole="button"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => setIsActivityPickerOpen(true)}
              >
                <Text style={[styles.browseLink, { color: colors.primary }]}>All →</Text>
              </Pressable>
            ) : null}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionsScroll}>
            {reference?.activityTypes?.map((act) => {
              const active = act.id === activityTypeId;
              return (
                <PressableScale
                  key={act.id}
                  accessibilityLabel={act.name}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setActivityTypeId(act.id)}
                  style={[
                    styles.chip,
                    active ? styles.chipActive : { backgroundColor: palette.card, borderColor: palette.border },
                  ]}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : { color: palette.foreground }]}>
                    {act.name}
                  </Text>
                </PressableScale>
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
          {/* Quick hour step chips */}
          <View style={styles.hourStepRow}>
            <PressableScale
              accessibilityLabel="Add 0.5 hours"
              accessibilityRole="button"
              onPress={() => addHours(0.5)}
              style={[styles.hourStepChip, { borderColor: palette.border, backgroundColor: palette.card }]}
            >
              <Text style={[styles.hourStepText, { color: colors.primary }]}>+0.5h</Text>
            </PressableScale>
            <PressableScale
              accessibilityLabel="Add 1.0 hour"
              accessibilityRole="button"
              onPress={() => addHours(1.0)}
              style={[styles.hourStepChip, { borderColor: palette.border, backgroundColor: palette.card }]}
            >
              <Text style={[styles.hourStepText, { color: colors.primary }]}>+1.0h</Text>
            </PressableScale>
            <PressableScale
              accessibilityLabel="Set to 4.0 hours (half day)"
              accessibilityRole="button"
              onPress={() => setDirectHours(4.0)}
              style={[styles.hourStepChip, { borderColor: palette.border, backgroundColor: palette.card }]}
            >
              <Text style={[styles.hourStepText, { color: colors.primary }]}>4.0h</Text>
            </PressableScale>
            <PressableScale
              accessibilityLabel="Set to 8.0 hours (full day)"
              accessibilityRole="button"
              onPress={() => setDirectHours(8.0)}
              style={[styles.hourStepChip, { borderColor: palette.border, backgroundColor: palette.card }]}
            >
              <Text style={[styles.hourStepText, { color: colors.primary }]}>8.0h</Text>
            </PressableScale>
            {hoursWorked ? (
              <PressableScale
                accessibilityLabel="Clear hours"
                accessibilityRole="button"
                onPress={() => setHoursWorked('')}
                style={[styles.hourStepChip, { borderColor: palette.border, backgroundColor: palette.card }]}
              >
                <Text style={[styles.hourStepText, { color: colors.error }]}>Clear</Text>
              </PressableScale>
            ) : null}
          </View>
        </View>

        {/* Work Description */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Work Done / Description</Text>
          <TextInput
            accessibilityLabel="Work Done"
            autoCapitalize="sentences"
            autoCorrect={true}
            multiline
            numberOfLines={4}
            onChangeText={setWorkDone}
            placeholder="Describe what you worked on..."
            placeholderTextColor={palette.placeholder}
            returnKeyType="done"
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
        <PressableScale
          accessibilityLabel="Save timesheet entry"
          accessibilityRole="button"
          accessibilityState={{ busy: isSubmitting }}
          disabled={isSubmitting}
          onPress={handleSubmit}
          style={styles.button}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>Save Timesheet</Text>
          )}
        </PressableScale>
      </ScrollView>

      {/* Project Search Modal */}
      <SearchablePickerModal
        items={projectPickerItems}
        onClose={() => setIsProjectPickerOpen(false)}
        onSelect={handleSelectProject}
        palette={palette}
        searchPlaceholder="Search projects by name or code..."
        selectedId={projectId}
        title="Select Project"
        visible={isProjectPickerOpen}
      />

      {/* Activity Type Search Modal */}
      <SearchablePickerModal
        items={activityPickerItems}
        onClose={() => setIsActivityPickerOpen(false)}
        onSelect={handleSelectActivity}
        palette={palette}
        searchPlaceholder="Search activity types..."
        selectedId={activityTypeId}
        title="Select Activity Type"
        visible={isActivityPickerOpen}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  errorBox: {
    borderRadius: borderRadius.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  fieldGroup: { marginBottom: spacing.md },
  fieldLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  fieldLabel: { fontSize: typography.caption, fontWeight: '700' },
  browseLink: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  pickerTriggerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 52,
    ...shadows.sm,
  },
  pickerTriggerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: spacing.sm,
  },
  pickerIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  pickerIconText: {
    fontSize: 16,
  },
  pickerTriggerInfo: {
    flex: 1,
  },
  pickerTriggerName: {
    fontSize: typography.body,
    fontWeight: '700',
  },
  pickerTriggerSubtitle: {
    fontSize: typography.badge,
    marginTop: 1,
  },
  pickerTriggerRight: {
    alignItems: 'flex-end',
  },
  pickerActionLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  quickProjectsContainer: {
    marginTop: spacing.xs,
  },
  quickLabel: {
    fontSize: typography.badge,
    fontWeight: '600',
    marginTop: spacing.xs,
    marginBottom: 2,
  },
  input: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    fontSize: typography.body,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  dateRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: spacing.xs },
  dateInput: { flex: 1 },
  presetButton: {
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.sm,
  },
  presetButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetText: { fontSize: typography.caption, fontWeight: '700' },
  presetTextActive: { color: colors.onPrimary },
  optionsScroll: { flexDirection: 'row', marginVertical: spacing.xs },
  chip: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
    minHeight: 38,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.sm,
  },
  moreChip: {
    borderStyle: 'dashed',
  },
  moreChipText: {
    fontWeight: '700',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: typography.caption, fontWeight: '600' },
  chipTextActive: { color: colors.onPrimary, fontWeight: '700' },
  hourStepRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  hourStepChip: {
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.sm,
  },
  hourStepText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  textArea: { minHeight: 96, paddingTop: spacing.sm, marginTop: spacing.xs },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    ...shadows.sm,
  },
  buttonText: { color: colors.onPrimary, fontSize: typography.body, fontWeight: '700' },
});
