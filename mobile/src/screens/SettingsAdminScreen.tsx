import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing, typography, borderRadius, shadows, useTheme } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import {
  useSessionActions,
  useSessionActor,
  useSessionData,
  useSessionStatus,
  useSessionSync,
} from '../auth/SessionProvider';
import { TimeEntryForm } from '../components/TimeEntryForm';
import type { CreateTimesheetInput, BackfillSettings, PersonProfile } from '../api/contracts';

interface SettingsAdminScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function SettingsAdminScreen({ isDarkMode: _isDarkMode, onBack }: SettingsAdminScreenProps) {
  const palette = useTheme().palette;
  const { effectiveActor } = useSessionActor();
  const { branding } = useSessionStatus();
  const { isOffline } = useSessionSync();
  const { reference, loadReference } = useSessionData();
  const referenceRef = useRef(reference);
  referenceRef.current = reference;
  const {
    getBackfillSettings,
    updateBackfillSettings,
    listAdminUsers,
    createTimesheet,
    updateBranding,
    resetBranding,
  } = useSessionActions();

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Workspace Branding State
  const [appName, setAppName] = useState(branding?.appName || 'VSIS Timesheet');
  const [primaryColor, setPrimaryColor] = useState(branding?.primaryColor || '#1E73BE');
  const [logoUrl, setLogoUrl] = useState(branding?.logoUrl || '');
  const [savingBranding, setSavingBranding] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [brandingSuccess, setBrandingSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (branding) {
      setAppName(branding.appName);
      setPrimaryColor(branding.primaryColor);
      setLogoUrl(branding.logoUrl || '');
    }
  }, [branding]);

  // Backfill Policy State
  const [backfillMode, setBackfillMode] = useState<'days' | 'month_start'>('days');
  const [windowDays, setWindowDays] = useState('7');
  const [extraDays, setExtraDays] = useState('0');
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Admin Log For User State
  const [users, setUsers] = useState<PersonProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [logFormVersion, setLogFormVersion] = useState(0);
  const [logSuccess, setLogSuccess] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setErrorMessage(null);
      const [settings, userList] = await Promise.all([
        getBackfillSettings(),
        listAdminUsers().catch(() => []),
        referenceRef.current ? Promise.resolve(referenceRef.current) : loadReference().catch(() => null),
      ]);
      setBackfillMode(settings.mode);
      setWindowDays(String(settings.windowDays));
      setExtraDays(String(settings.extraDays));
      setUsers(userList);
      if (userList.length > 0) {
        setSelectedUserId((current) => current || userList[0].id);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  }, [getBackfillSettings, listAdminUsers, loadReference]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

  const handleSaveBranding = async () => {
    if (isOffline) {
      setBrandingError('Cannot update branding while offline.');
      return;
    }
    const trimmedName = appName.trim();
    if (!trimmedName) {
      setBrandingError('Application name cannot be empty.');
      return;
    }
    const trimmedColor = primaryColor.trim().toUpperCase();
    if (!/^#[0-9A-Fa-f]{6}$/.test(trimmedColor)) {
      setBrandingError('Primary color must be a valid 6-digit hex code (e.g. #1E73BE).');
      return;
    }
    const trimmedLogo = logoUrl.trim();
    if (trimmedLogo && !trimmedLogo.startsWith('https://')) {
      setBrandingError('Logo URL must use a secure HTTPS protocol (https://).');
      return;
    }
    setSavingBranding(true);
    setBrandingError(null);
    setBrandingSuccess(null);
    try {
      await updateBranding({
        appName: trimmedName,
        primaryColor: trimmedColor,
        logoUrl: trimmedLogo || null,
      });
      setBrandingSuccess('Workspace branding saved successfully.');
    } catch (err) {
      setBrandingError(err instanceof Error ? err.message : 'Failed to save branding.');
    } finally {
      setSavingBranding(false);
    }
  };

  const handleResetBranding = async () => {
    if (isOffline) {
      setBrandingError('Cannot reset branding while offline.');
      return;
    }
    setSavingBranding(true);
    setBrandingError(null);
    setBrandingSuccess(null);
    try {
      await resetBranding();
      setAppName('VSIS Timesheet');
      setPrimaryColor('#1E73BE');
      setLogoUrl('');
      setBrandingSuccess('Restored default workspace branding.');
    } catch (err) {
      setBrandingError(err instanceof Error ? err.message : 'Failed to reset branding.');
    } finally {
      setSavingBranding(false);
    }
  };

  const handleAdminLogTime = async (input: CreateTimesheetInput) => {
    if (!selectedUserId) throw new Error('Please select a user.');
    setLogSuccess(null);
    const result = await createTimesheet({ ...input, userId: selectedUserId });
    setLogSuccess(result.queued
      ? 'Saved offline for user — will sync when you reconnect.'
      : 'Timesheet logged successfully for user.');
    setLogFormVersion(version => version + 1);
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
            <ActivityIndicator color={palette.primary} size="large" />
            <Text style={[styles.loadingText, { color: palette.muted }]}>Loading settings…</Text>
          </View>
        ) : (
          <>
            {/* Section 1: Backfill Policy */}
            <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <View style={styles.sectionHeader}>
                <Icon color={palette.primary} name="calendar" size={20} />
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
                      backgroundColor: backfillMode === 'days' ? palette.primary : palette.badgeBg,
                      borderColor: backfillMode === 'days' ? palette.primary : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      { color: backfillMode === 'days' ? palette.onPrimary : palette.foreground },
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
                      backgroundColor: backfillMode === 'month_start' ? palette.primary : palette.badgeBg,
                      borderColor: backfillMode === 'month_start' ? palette.primary : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      { color: backfillMode === 'month_start' ? palette.onPrimary : palette.foreground },
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
                style={[styles.saveBtn, { backgroundColor: palette.primary }]}
              >
                {savingPolicy ? (
                  <ActivityIndicator color={palette.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.saveBtnText, { color: palette.onPrimary }]}>Save Policy</Text>
                )}
              </PressableScale>
            </View>

            {/* Section 2: Admin Backfill (Log on behalf of another user) */}
            <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <View style={styles.sectionHeader}>
                <Icon color={palette.primary} name="time" size={20} />
                <Text style={[styles.sectionTitle, { color: palette.foreground }]}>Log Time For User</Text>
              </View>
              <Text style={[styles.sectionDesc, { color: palette.muted }]}>
                Record timesheet entries on behalf of team members. Exempt from backfill window constraints.
              </Text>

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
                        backgroundColor: selectedUserId === u.id ? palette.primary : palette.badgeBg,
                        borderColor: selectedUserId === u.id ? palette.primary : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.pickerPillText,
                        { color: selectedUserId === u.id ? palette.onPrimary : palette.foreground },
                      ]}
                    >
                      {u.name || u.email}
                    </Text>
                  </PressableScale>
                ))}
              </ScrollView>

              <TimeEntryForm key={logFormVersion} mode="create" isDarkMode={_isDarkMode}
                onSubmit={handleAdminLogTime} submitLabel="Log Entry" />
            </View>

            {/* 3. Workspace Branding Customization (Super-Admin) */}
            {effectiveActor?.capabilities?.canManageWorkspaceCustomization ? (
              <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <View style={styles.sectionHeader}>
                  <Icon name="settings" size={18} color={palette.primary} />
                  <Text style={[styles.sectionTitle, { color: palette.foreground }]}>Workspace Branding</Text>
                </View>
                <Text style={[styles.sectionDesc, { color: palette.placeholder }]}>
                  Customize application name, primary brand color, and logo across web and mobile
                </Text>

                {brandingError ? <Text style={styles.errorText}>{brandingError}</Text> : null}
                {brandingSuccess ? <Text style={styles.successText}>{brandingSuccess}</Text> : null}

                <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Application Name</Text>
                <TextInput
                  accessibilityLabel="App Name"
                  maxLength={50}
                  onChangeText={setAppName}
                  placeholder="VSIS Timesheet"
                  placeholderTextColor={palette.placeholder}
                  style={[styles.input, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
                  value={appName}
                />

                <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Primary Color (6-digit Hex)</Text>
                <View style={styles.colorRow}>
                  <View
                    style={[
                      styles.colorSwatch,
                      { backgroundColor: /^#[0-9A-Fa-f]{6}$/.test(primaryColor) ? primaryColor : '#1E73BE' },
                    ]}
                  />
                  <TextInput
                    accessibilityLabel="Primary Color"
                    autoCapitalize="characters"
                    maxLength={7}
                    onChangeText={(t) => setPrimaryColor(t.toUpperCase())}
                    placeholder="#1E73BE"
                    placeholderTextColor={palette.placeholder}
                    style={[
                      styles.input,
                      styles.colorInput,
                      { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground },
                    ]}
                    value={primaryColor}
                  />
                </View>

                <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Logo URL (HTTPS)</Text>
                <TextInput
                  accessibilityLabel="Logo URL"
                  autoCapitalize="none"
                  keyboardType="url"
                  onChangeText={setLogoUrl}
                  placeholder="https://example.com/logo.png"
                  placeholderTextColor={palette.placeholder}
                  style={[styles.input, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
                  value={logoUrl}
                />

                <View style={styles.brandingButtonsRow}>
                  <PressableScale
                    accessibilityLabel="Reset Branding"
                    accessibilityRole="button"
                    disabled={savingBranding || isOffline}
                    onPress={handleResetBranding}
                    style={[
                      styles.resetBrandingBtn,
                      {
                        backgroundColor: palette.badgeBg,
                        borderColor: palette.border,
                        opacity: savingBranding || isOffline ? 0.5 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.resetBrandingText, { color: palette.foreground }]}>Reset</Text>
                  </PressableScale>

                  <PressableScale
                    accessibilityLabel="Save Branding"
                    accessibilityRole="button"
                    disabled={savingBranding || isOffline}
                    onPress={handleSaveBranding}
                    style={[
                      styles.saveBrandingBtn,
                      {
                        backgroundColor: palette.primary,
                        opacity: savingBranding || isOffline ? 0.5 : 1,
                      },
                    ]}
                  >
                    {savingBranding ? (
                      <ActivityIndicator color={palette.onPrimary} size="small" />
                    ) : (
                      <Text style={[styles.saveBtnText, { color: palette.onPrimary }]}>Save Branding</Text>
                    )}
                  </PressableScale>
                </View>
              </View>
            ) : null}
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
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  colorInput: {
    flex: 1,
    marginBottom: 0,
  },
  brandingButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  resetBrandingBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetBrandingText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  saveBrandingBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
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
