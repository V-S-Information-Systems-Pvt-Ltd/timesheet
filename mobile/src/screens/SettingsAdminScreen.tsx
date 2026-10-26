import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { spacing, typography, borderRadius, useTheme } from '../theme';
import { DEFAULT_BRANDING } from '../api/contracts';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Chip } from '../components/Chip';
import { adminStyles } from '../components/adminStyles';
import { ConfirmDialog } from '../components/ConfirmDialog';
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
  const [primaryColor, setPrimaryColor] = useState(branding?.primaryColor || DEFAULT_BRANDING.primaryColor);
  const [logoUrl, setLogoUrl] = useState(branding?.logoUrl || '');
  const [savingBranding, setSavingBranding] = useState(false);
  const [resetConfirmVisible, setResetConfirmVisible] = useState(false);
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
      let userWarning: string | null = null;
      const [settings, userList] = await Promise.all([
        getBackfillSettings(),
        listAdminUsers().catch((err: unknown) => {
          userWarning = err instanceof Error ? `Team list could not be loaded: ${err.message}` : 'Team list could not be loaded.';
          return [];
        }),
        referenceRef.current ? Promise.resolve(referenceRef.current) : loadReference().catch(() => null),
      ]);
      setBackfillMode(settings.mode);
      setWindowDays(String(settings.windowDays));
      setExtraDays(String(settings.extraDays));
      setUsers(userList);
      if (userWarning) setErrorMessage(userWarning);
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
      setBrandingError(`Primary color must be a valid 6-digit hex code (e.g. ${DEFAULT_BRANDING.primaryColor}).`);
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
    // One quiet confirm: this rewrites workspace branding for every user.
    if (!resetConfirmVisible) {
      setResetConfirmVisible(true);
      return;
    }
    setResetConfirmVisible(false);
    setSavingBranding(true);
    setBrandingError(null);
    setBrandingSuccess(null);
    try {
      await resetBranding();
      setAppName('VSIS Timesheet');
      setPrimaryColor(DEFAULT_BRANDING.primaryColor);
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

  const renderModeButton = (label: string, a11y: string, mode: BackfillSettings['mode']) => (
    <Chip
      accessibilityLabel={a11y}
      active={backfillMode === mode}
      label={label}
      onPress={() => setBackfillMode(mode)}
      palette={palette}
    />
  );

  return (
    <View style={[adminStyles.container, { backgroundColor: palette.paper }]}>
      <ScreenHeader
        onBack={onBack}
        palette={palette}
        subtitle="Backfill policy and administrative time logging"
        title="Workspace settings"
      />

      <View style={[adminStyles.sheet, { backgroundColor: palette.sheet }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator color={palette.primary} size="large" />
            <Text style={[adminStyles.muted, { color: palette.muted }]}>Loading settings…</Text>
          </View>
        ) : (
          <>
            <View style={[styles.section, { borderBottomColor: palette.hairline }]}>
              <Text style={[styles.sectionTitle, { color: palette.foreground }]}>Backfill window policy</Text>
              <Text style={[styles.sectionDesc, { color: palette.muted }]}>
                Controls how far back regular users can log or edit timesheets. Administrators are always exempt.
              </Text>

              {errorMessage ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.messageText, { color: palette.error }]}>{errorMessage}</Text> : null}
              {successMessage ? <Text accessibilityLiveRegion="polite" style={[styles.messageText, { color: palette.loggedText }]}>{successMessage}</Text> : null}

              <Text style={[adminStyles.label, { color: palette.muted }]}>Policy mode</Text>
              <View style={adminStyles.chipRow}>
                {renderModeButton('Rolling days window', 'Fixed Days Mode', 'days')}
                {renderModeButton('Current month start', 'Current Month Mode', 'month_start')}
              </View>

              {backfillMode === 'days' ? (
                <>
                  <Text style={[adminStyles.label, { color: palette.muted }]}>Days window (0 to 365)</Text>
                  <TextInput
                    accessibilityLabel="Days Window"
                    keyboardType="number-pad"
                    onChangeText={setWindowDays}
                    style={[adminStyles.input, adminStyles.numeral, { borderColor: palette.controlBorder, color: palette.foreground }]}
                    value={windowDays}
                  />
                </>
              ) : (
                <>
                  <Text style={[adminStyles.label, { color: palette.muted }]}>Grace days into prior month (0 to 365)</Text>
                  <TextInput
                    accessibilityLabel="Extra Days"
                    keyboardType="number-pad"
                    onChangeText={setExtraDays}
                    style={[adminStyles.input, adminStyles.numeral, { borderColor: palette.controlBorder, color: palette.foreground }]}
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
                  <Text style={[adminStyles.btnText, { color: palette.onPrimary }]}>Save policy</Text>
                )}
              </PressableScale>
            </View>

            <View style={[styles.section, { borderBottomColor: palette.hairline }]}>
              <Text style={[styles.sectionTitle, { color: palette.foreground }]}>Log time for a user</Text>
              <Text style={[styles.sectionDesc, { color: palette.muted }]}>
                Record timesheet entries on behalf of team members. Exempt from backfill window constraints.
              </Text>

              {logSuccess ? <Text style={[styles.messageText, { color: palette.loggedText }]}>{logSuccess}</Text> : null}

              <Text style={[adminStyles.label, { color: palette.muted }]}>User</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={adminStyles.chipRow}>
                  {users.map((u) => (
                    <Chip
                      key={u.id}
                      accessibilityLabel={`Select user ${u.name || u.email}`}
                      active={selectedUserId === u.id}
                      label={u.name || u.email}
                      onPress={() => setSelectedUserId(u.id)}
                      palette={palette}
                    />
                  ))}
                </View>
              </ScrollView>

              <TimeEntryForm key={logFormVersion} mode="create" isDarkMode={_isDarkMode}
                onSubmit={handleAdminLogTime} submitLabel="Log entry" />
            </View>

            {effectiveActor?.capabilities?.canManageWorkspaceCustomization ? (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: palette.foreground }]}>Workspace branding</Text>
                <Text style={[styles.sectionDesc, { color: palette.muted }]}>
                  Customize application name, primary brand color, and logo across web and mobile.
                </Text>

                {brandingError ? <Text style={[styles.messageText, { color: palette.error }]}>{brandingError}</Text> : null}
                {brandingSuccess ? <Text style={[styles.messageText, { color: palette.loggedText }]}>{brandingSuccess}</Text> : null}

                <Text style={[adminStyles.label, { color: palette.muted }]}>Application name</Text>
                <TextInput
                  accessibilityLabel="App Name"
                  maxLength={50}
                  onChangeText={setAppName}
                  placeholder="VSIS Timesheet"
                  placeholderTextColor={palette.placeholder}
                  style={[adminStyles.input, { borderColor: palette.controlBorder, color: palette.foreground }]}
                  value={appName}
                />

                <Text style={[adminStyles.label, { color: palette.muted }]}>Primary color (6-digit hex)</Text>
                <View style={styles.colorRow}>
                  <View
                    style={[
                      styles.colorSwatch,
                      {
                        backgroundColor: /^#[0-9A-Fa-f]{6}$/.test(primaryColor) ? primaryColor : DEFAULT_BRANDING.primaryColor,
                        borderColor: palette.controlBorder,
                      },
                    ]}
                  />
                  <TextInput
                    accessibilityLabel="Primary Color"
                    autoCapitalize="characters"
                    maxLength={7}
                    onChangeText={(t) => setPrimaryColor(t.toUpperCase())}
                    placeholder={DEFAULT_BRANDING.primaryColor}
                    placeholderTextColor={palette.placeholder}
                    style={[
                      adminStyles.input,
                      adminStyles.numeral,
                      styles.colorInput,
                      { borderColor: palette.controlBorder, color: palette.foreground },
                    ]}
                    value={primaryColor}
                  />
                </View>

                <Text style={[adminStyles.label, { color: palette.muted }]}>Logo URL (HTTPS)</Text>
                <TextInput
                  accessibilityLabel="Logo URL"
                  autoCapitalize="none"
                  keyboardType="url"
                  onChangeText={setLogoUrl}
                  placeholder="https://example.com/logo.png"
                  placeholderTextColor={palette.placeholder}
                  style={[adminStyles.input, { borderColor: palette.controlBorder, color: palette.foreground }]}
                  value={logoUrl}
                />

                <View style={adminStyles.modalActions}>
                  <PressableScale
                    accessibilityLabel="Reset Branding"
                    accessibilityRole="button"
                    disabled={savingBranding || isOffline}
                    onPress={handleResetBranding}
                    style={[
                      adminStyles.btn,
                      adminStyles.btnOutline,
                      { borderColor: palette.controlBorder },
                      (savingBranding || isOffline) && adminStyles.disabled,
                    ]}
                  >
                    <Text style={[adminStyles.btnText, { color: palette.foreground }]}>Reset</Text>
                  </PressableScale>

                  <PressableScale
                    accessibilityLabel="Save Branding"
                    accessibilityRole="button"
                    disabled={savingBranding || isOffline}
                    onPress={handleSaveBranding}
                    style={[
                      adminStyles.btn,
                      { backgroundColor: palette.primary },
                      (savingBranding || isOffline) && adminStyles.disabled,
                    ]}
                  >
                    {savingBranding ? (
                      <ActivityIndicator color={palette.onPrimary} size="small" />
                    ) : (
                      <Text style={[adminStyles.btnText, { color: palette.onPrimary }]}>Save branding</Text>
                    )}
                  </PressableScale>
                </View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      </View>

      <ConfirmDialog
        visible={resetConfirmVisible}
        title="Restore default branding?"
        message="This replaces the workspace application name, brand color and logo for every user across web and mobile."
        confirmLabel="Restore defaults"
        destructive
        onConfirm={handleResetBranding}
        onCancel={() => setResetConfirmVisible(false)}
        palette={palette}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingBottom: spacing.xxl },
  centerContainer: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  section: {
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: { fontSize: typography.heading, fontWeight: '600' },
  sectionDesc: { fontSize: typography.caption, lineHeight: 18, marginTop: spacing.xs },
  messageText: { fontSize: typography.caption, fontWeight: '600', marginTop: spacing.sm },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  colorSwatch: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.control,
    borderWidth: 1,
  },
  colorInput: { flex: 1 },
  saveBtn: {
    marginTop: spacing.lg,
    minHeight: 52,
    borderRadius: borderRadius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
