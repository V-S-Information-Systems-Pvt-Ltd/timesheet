import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { useSessionActions, useSessionData } from '../auth/SessionProvider';
import type { BackfillSettings, PersonProfile } from '../api/contracts';

interface SettingsAdminScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function SettingsAdminScreen({ isDarkMode, onBack }: SettingsAdminScreenProps) {
  const palette = getPalette(isDarkMode);
  const { reference, loadReference } = useSessionData();
  const {
    getBackfillSettings,
    updateBackfillSettings,
    listAdminUsers,
    createTimesheet,
  } = useSessionActions();

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Backfill Policy State
  const [backfillMode, setBackfillMode] = useState<'days' | 'month_start'>('days');
  const [windowDays, setWindowDays] = useState('7');
  const [extraDays, setExtraDays] = useState('0');
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Admin Log For User State
  const [users, setUsers] = useState<PersonProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [logDate, setLogDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedActivityId, setSelectedActivityId] = useState<string>('');
  const [hours, setHours] = useState('8');
  const [workDone, setWorkDone] = useState('');
  const [loggingTime, setLoggingTime] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logSuccess, setLogSuccess] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setErrorMessage(null);
      const [settings, userList, refData] = await Promise.all([
        getBackfillSettings(),
        listAdminUsers().catch(() => []),
        reference ? Promise.resolve(reference) : loadReference().catch(() => null),
      ]);
      setBackfillMode(settings.mode);
      setWindowDays(String(settings.windowDays));
      setExtraDays(String(settings.extraDays));
      setUsers(userList);
      if (userList.length > 0 && !selectedUserId) {
        setSelectedUserId(userList[0].id);
      }
      const effectiveRef = refData || reference;
      if (effectiveRef?.projects && effectiveRef.projects.length > 0 && !selectedProjectId) {
        setSelectedProjectId(effectiveRef.projects[0].id);
      }
      if (effectiveRef?.activityTypes && effectiveRef.activityTypes.length > 0 && !selectedActivityId) {
        setSelectedActivityId(effectiveRef.activityTypes[0].id);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  }, [getBackfillSettings, listAdminUsers, loadReference, reference, selectedActivityId, selectedProjectId, selectedUserId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!selectedProjectId && reference?.projects?.length) {
      setSelectedProjectId(reference.projects[0].id);
    }
    if (!selectedActivityId && reference?.activityTypes?.length) {
      setSelectedActivityId(reference.activityTypes[0].id);
    }
  }, [reference, selectedProjectId, selectedActivityId]);

  const handleSaveBackfill = async () => {
    const w = parseInt(windowDays, 10);
    const e = parseInt(extraDays, 10);
    if (Number.isNaN(w) || w < 0 || w > 365) {
      setErrorMessage('Window days must be a whole number between 0 and 365.');
      return;
    }
    if (Number.isNaN(e) || e < 0 || e > 365) {
      setErrorMessage('Extra days must be a whole number between 0 and 365.');
      return;
    }

    setSavingPolicy(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const payload: BackfillSettings = {
        mode: backfillMode,
        windowDays: w,
        extraDays: e,
      };
      await updateBackfillSettings(payload);
      setSuccessMessage('Backfill policy saved successfully.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save backfill policy.');
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleAdminLogTime = async () => {
    const targetUid = selectedUserId || (users.length > 0 ? users[0].id : '');
    const targetPid = selectedProjectId || (reference?.projects?.[0]?.id ?? '');
    const targetAid = selectedActivityId || (reference?.activityTypes?.[0]?.id ?? '');

    if (!targetUid) {
      setLogError('Please select a user.');
      return;
    }
    if (!targetPid) {
      setLogError('Please select a project.');
      return;
    }
    if (!targetAid) {
      setLogError('Please select an activity type.');
      return;
    }
    const h = parseFloat(hours);
    if (Number.isNaN(h) || h <= 0 || h > 24) {
      setLogError('Hours must be between 0.25 and 24.');
      return;
    }
    if (!workDone.trim()) {
      setLogError('Work description is required.');
      return;
    }

    setLoggingTime(true);
    setLogError(null);
    setLogSuccess(null);
    try {
      await createTimesheet({
        userId: targetUid,
        projectId: targetPid,
        activityTypeId: targetAid,
        hoursWorked: h,
        workDone: workDone.trim(),
        logDate,
      });
      setLogSuccess('Timesheet logged successfully for user.');
      setWorkDone('');
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Failed to log timesheet for user.');
    } finally {
      setLoggingTime(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScreenHeader
        onBack={onBack}
        palette={palette}
        subtitle="Backfill policy and administrative time logging"
        title="Workspace Settings"
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[styles.loadingText, { color: palette.muted }]}>Loading settings…</Text>
          </View>
        ) : (
          <>
            {/* Section 1: Backfill Policy */}
            <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <View style={styles.sectionHeader}>
                <Icon color={colors.primary} name="calendar" size={20} />
                <Text style={[styles.sectionTitle, { color: palette.foreground }]}>Backfill Window Policy</Text>
              </View>
              <Text style={[styles.sectionDesc, { color: palette.muted }]}>
                Controls how far back regular users can log or edit timesheets. Administrators are always exempt.
              </Text>

              {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
              {successMessage ? <Text style={styles.successText}>{successMessage}</Text> : null}

              <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Policy Mode</Text>
              <View style={styles.modeRow}>
                <PressableScale
                  accessibilityLabel="Fixed Days Mode"
                  accessibilityRole="button"
                  onPress={() => setBackfillMode('days')}
                  style={[
                    styles.modeBtn,
                    {
                      backgroundColor: backfillMode === 'days' ? colors.primary : palette.badgeBg,
                      borderColor: backfillMode === 'days' ? colors.primary : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      { color: backfillMode === 'days' ? colors.onPrimary : palette.foreground },
                    ]}
                  >
                    Rolling Days Window
                  </Text>
                </PressableScale>

                <PressableScale
                  accessibilityLabel="Current Month Mode"
                  accessibilityRole="button"
                  onPress={() => setBackfillMode('month_start')}
                  style={[
                    styles.modeBtn,
                    {
                      backgroundColor: backfillMode === 'month_start' ? colors.primary : palette.badgeBg,
                      borderColor: backfillMode === 'month_start' ? colors.primary : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      { color: backfillMode === 'month_start' ? colors.onPrimary : palette.foreground },
                    ]}
                  >
                    Current Month Start
                  </Text>
                </PressableScale>
              </View>

              {backfillMode === 'days' ? (
                <>
                  <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Days Window (0 - 365)</Text>
                  <TextInput
                    accessibilityLabel="Days Window"
                    keyboardType="number-pad"
                    onChangeText={setWindowDays}
                    style={[styles.input, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
                    value={windowDays}
                  />
                </>
              ) : (
                <>
                  <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Grace Days Prior Month (0 - 365)</Text>
                  <TextInput
                    accessibilityLabel="Extra Days"
                    keyboardType="number-pad"
                    onChangeText={setExtraDays}
                    style={[styles.input, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
                    value={extraDays}
                  />
                </>
              )}

              <PressableScale
                accessibilityLabel="Save Backfill Policy"
                accessibilityRole="button"
                disabled={savingPolicy}
                onPress={handleSaveBackfill}
                style={[styles.saveBtn, { backgroundColor: colors.primary }]}
              >
                {savingPolicy ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Save Policy</Text>
                )}
              </PressableScale>
            </View>

            {/* Section 2: Admin Backfill (Log on behalf of another user) */}
            <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <View style={styles.sectionHeader}>
                <Icon color={colors.primary} name="time" size={20} />
                <Text style={[styles.sectionTitle, { color: palette.foreground }]}>Log Time For User</Text>
              </View>
              <Text style={[styles.sectionDesc, { color: palette.muted }]}>
                Record timesheet entries on behalf of team members. Exempt from backfill window constraints.
              </Text>

              {logError ? <Text style={styles.errorText}>{logError}</Text> : null}
              {logSuccess ? <Text style={styles.successText}>{logSuccess}</Text> : null}

              {/* User Selector */}
              <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Select User</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerScroll}>
                {users.map((u) => (
                  <PressableScale
                    key={u.id}
                    accessibilityLabel={`Select user ${u.name || u.email}`}
                    accessibilityRole="button"
                    onPress={() => setSelectedUserId(u.id)}
                    style={[
                      styles.pickerPill,
                      {
                        backgroundColor: selectedUserId === u.id ? colors.primary : palette.badgeBg,
                        borderColor: selectedUserId === u.id ? colors.primary : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.pickerPillText,
                        { color: selectedUserId === u.id ? colors.onPrimary : palette.foreground },
                      ]}
                    >
                      {u.name || u.email}
                    </Text>
                  </PressableScale>
                ))}
              </ScrollView>

              {/* Date Input */}
              <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Date (YYYY-MM-DD)</Text>
              <TextInput
                accessibilityLabel="Log Date"
                onChangeText={setLogDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={palette.placeholder}
                style={[styles.input, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
                value={logDate}
              />

              {/* Project Picker */}
              <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Project</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerScroll}>
                {(reference?.projects || []).map((p) => (
                  <PressableScale
                    key={p.id}
                    accessibilityLabel={`Select project ${p.name}`}
                    accessibilityRole="button"
                    onPress={() => setSelectedProjectId(p.id)}
                    style={[
                      styles.pickerPill,
                      {
                        backgroundColor: selectedProjectId === p.id ? colors.primary : palette.badgeBg,
                        borderColor: selectedProjectId === p.id ? colors.primary : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.pickerPillText,
                        { color: selectedProjectId === p.id ? colors.onPrimary : palette.foreground },
                      ]}
                    >
                      {p.name}
                    </Text>
                  </PressableScale>
                ))}
              </ScrollView>

              {/* Activity Type Picker */}
              <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Activity Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerScroll}>
                {(reference?.activityTypes || []).map((a) => (
                  <PressableScale
                    key={a.id}
                    accessibilityLabel={`Select activity ${a.name}`}
                    accessibilityRole="button"
                    onPress={() => setSelectedActivityId(a.id)}
                    style={[
                      styles.pickerPill,
                      {
                        backgroundColor: selectedActivityId === a.id ? colors.primary : palette.badgeBg,
                        borderColor: selectedActivityId === a.id ? colors.primary : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.pickerPillText,
                        { color: selectedActivityId === a.id ? colors.onPrimary : palette.foreground },
                      ]}
                    >
                      {a.name}
                    </Text>
                  </PressableScale>
                ))}
              </ScrollView>

              {/* Hours Worked */}
              <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Hours Worked</Text>
              <TextInput
                accessibilityLabel="Hours Worked"
                keyboardType="decimal-pad"
                onChangeText={setHours}
                placeholder="e.g. 8"
                placeholderTextColor={palette.placeholder}
                style={[styles.input, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
                value={hours}
              />

              {/* Work Description */}
              <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Work Description</Text>
              <TextInput
                accessibilityLabel="Work Description"
                multiline
                numberOfLines={3}
                onChangeText={setWorkDone}
                placeholder="What was completed…"
                placeholderTextColor={palette.placeholder}
                style={[styles.input, styles.multilineInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
                value={workDone}
              />

              <PressableScale
                accessibilityLabel="Submit User Timesheet"
                accessibilityRole="button"
                disabled={loggingTime}
                onPress={handleAdminLogTime}
                style={[styles.saveBtn, { backgroundColor: colors.primary }]}
              >
                {loggingTime ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Log Entry</Text>
                )}
              </PressableScale>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  centerContainer: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: typography.caption,
  },
  card: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    ...shadows.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: typography.title,
    fontWeight: '700',
  },
  sectionDesc: {
    fontSize: typography.caption,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: typography.caption,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.body,
    marginBottom: spacing.xs,
  },
  multilineInput: {
    height: 80,
    textAlignVertical: 'top',
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeBtnText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  pickerScroll: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  pickerPill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    marginRight: spacing.xs,
  },
  pickerPillText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  saveBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: colors.onPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.caption,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  successText: {
    color: '#059669',
    fontSize: typography.caption,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
});
