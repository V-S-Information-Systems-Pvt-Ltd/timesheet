import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSessionActor, useSessionReference, useSessionActions } from '../auth/SessionProvider';
import { fonts, numeralSizes, spacing, typography, borderRadius, useTheme } from '../theme';
import { PasswordChangeForm } from '../components/PasswordChangeForm';
import { DepartmentField } from '../components/DepartmentField';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Chip } from '../components/Chip';

interface ProfileScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

type ConfirmKind = 'logout-all' | 'disconnect' | null;

/** 'team_lead' -> 'Team lead'. */
function humanize(value: string): string {
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function ProfileScreen({ isDarkMode: _isDarkMode, onBack }: ProfileScreenProps) {
  const palette = useTheme().palette;
  const { actor, effectiveActor, serverUrl, config } = useSessionActor();
  const { reference, loadReference } = useSessionReference();
  const { listDepartments, updateProfile, signOut, logoutAll, disconnectServer, changePassword } = useSessionActions();

  const currentActor = effectiveActor || actor;

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [department, setDepartment] = useState(currentActor?.department || '');
  const [title, setTitle] = useState(currentActor?.title || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);

  useEffect(() => {
    loadReference();
  }, [loadReference]);

  useEffect(() => {
    if (currentActor) {
      setDepartment(currentActor.department || '');
      setTitle(currentActor.title || '');
    }
  }, [currentActor]);

  async function handleSaveProfile() {
    setIsSavingProfile(true);
    setProfileMsg(null);
    try {
      await updateProfile({
        department: department.trim(),
        title: title.trim(),
      });
      setProfileMsg({ type: 'success', text: 'Profile updated.' });
      setIsEditingProfile(false);
    } catch (err) {
      setProfileMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not update your profile. Check your connection and try again.',
      });
    } finally {
      setIsSavingProfile(false);
    }
  }

  const renderValueRow = (label: string, value: string, valueColor?: string) => (
    <View style={[styles.row, { borderBottomColor: palette.hairline }]}>
      <Text style={[styles.rowLabel, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor ?? palette.foreground }]}>{value}</Text>
    </View>
  );

  const displayName = currentActor?.name || currentActor?.email || 'User';
  const roleText = humanize(currentActor?.permissionRole ?? currentActor?.role ?? 'user');
  const hierarchyText = humanize(currentActor?.hierarchyRole ?? 'user');

  return (
    <View style={[styles.container, { backgroundColor: palette.paper }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <ScreenHeader
          title="Profile"
          onBack={onBack}
          backLabel="‹ Dashboard"
          palette={palette}
        />

        {/* Identity: plain text on paper. */}
        <View style={styles.identity}>
          <Text style={[styles.userName, { color: palette.foreground }]}>{displayName}</Text>
          {currentActor?.name ? (
            <Text style={[styles.email, { color: palette.muted }]}>{currentActor.email}</Text>
          ) : null}
          <Text style={[styles.role, { color: palette.muted }]}>{roleText}</Text>
        </View>

        <View style={[styles.sheet, { backgroundColor: palette.sheet }]}>
          {profileMsg ? (
            <View
              accessibilityRole="alert"
              style={[
                styles.msgBox,
                { backgroundColor: profileMsg.type === 'success' ? palette.loggedTint : palette.errorBoxBg },
              ]}
            >
              <Text
                style={[
                  styles.msgText,
                  { color: profileMsg.type === 'success' ? palette.loggedText : palette.error },
                ]}
              >
                {profileMsg.text}
              </Text>
            </View>
          ) : null}

          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: palette.foreground }]}>Professional info</Text>
            <PressableScale
              accessibilityLabel={isEditingProfile ? 'Cancel editing profile' : 'Edit profile'}
              accessibilityRole="button"
              onPress={() => {
                setIsEditingProfile(!isEditingProfile);
                setProfileMsg(null);
              }}
              style={styles.textAction}
            >
              <Text style={[styles.textActionLabel, { color: palette.primaryText }]}>
                {isEditingProfile ? 'Cancel' : 'Edit'}
              </Text>
            </PressableScale>
          </View>

          {isEditingProfile ? (
            <View>
              <View style={[styles.row, { borderBottomColor: palette.hairline }]}>
                <Text style={[styles.rowLabel, { color: palette.muted }]}>Department</Text>
                <DepartmentField
                  listDepartments={listDepartments}
                  onChange={setDepartment}
                  palette={palette}
                  value={department}
                />
              </View>

              <View style={[styles.row, { borderBottomColor: palette.hairline }]}>
                <Text style={[styles.rowLabel, { color: palette.muted }]}>Job title</Text>
                <TextInput
                  accessibilityLabel="Job Title"
                  onChangeText={setTitle}
                  placeholder="Senior software engineer"
                  placeholderTextColor={palette.placeholder}
                  style={[styles.input, { color: palette.foreground }]}
                  value={title}
                />
                {reference?.titles && reference.titles.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionsScroll}>
                    <View style={styles.chipScroll}>
                      {reference.titles.map((t, idx) => (
                        <Chip
                          key={idx}
                          accessibilityLabel={`Select title ${t}`}
                          active={title === t}
                          label={t}
                          onPress={() => setTitle(t)}
                          palette={palette}
                        />
                      ))}
                    </View>
                  </ScrollView>
                ) : null}
              </View>

              <PressableScale
                accessibilityLabel="Save profile changes"
                accessibilityRole="button"
                accessibilityState={{ busy: isSavingProfile }}
                disabled={isSavingProfile}
                onPress={handleSaveProfile}
                style={[styles.primaryButton, { backgroundColor: palette.primary }]}
              >
                {isSavingProfile ? (
                  <ActivityIndicator color={palette.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.primaryButtonText, { color: palette.onPrimary }]}>Save changes</Text>
                )}
              </PressableScale>
            </View>
          ) : (
            <>
              {renderValueRow('Department', currentActor?.department || '—')}
              {renderValueRow('Job title', currentActor?.title || '—')}
            </>
          )}

          <Text style={[styles.sectionTitle, styles.sectionGap, { color: palette.foreground }]}>Account</Text>
          {renderValueRow('User ID', currentActor?.id ?? '—')}
          {renderValueRow('Permission role', roleText)}
          {renderValueRow('Hierarchy role', hierarchyText)}
          {renderValueRow('Status', 'Active', palette.loggedText)}

          <View style={[styles.sectionHeaderRow, styles.sectionGap]}>
            <Text style={[styles.sectionTitle, { color: palette.foreground }]}>Security</Text>
            <PressableScale
              accessibilityLabel={showPasswordForm ? 'Cancel change password' : 'Change password'}
              accessibilityRole="button"
              onPress={() => setShowPasswordForm(!showPasswordForm)}
              style={styles.textAction}
            >
              <Text style={[styles.textActionLabel, { color: palette.primaryText }]}>
                {showPasswordForm ? 'Cancel' : 'Change password'}
              </Text>
            </PressableScale>
          </View>

          {showPasswordForm ? (
            <PasswordChangeForm
              onSubmit={changePassword}
              onCancel={() => setShowPasswordForm(false)}
              palette={palette}
            />
          ) : (
            <Text style={[styles.securityNotice, { color: palette.muted }]}>
              Keep your password private. Choose one you do not use anywhere else.
            </Text>
          )}

          <Text style={[styles.sectionTitle, styles.sectionGap, { color: palette.foreground }]}>Workspace</Text>
          {renderValueRow('Address', serverUrl ?? '—')}
          {renderValueRow('Backend', humanize(config?.backend ?? 'native'))}

          {/* Destructive actions: red text rows at the bottom. */}
          <View style={styles.dangerZone}>
            <PressableScale
              accessibilityLabel="Sign out"
              accessibilityRole="button"
              onPress={() => signOut()}
              scaleTo={1}
              style={[styles.dangerRow, { borderBottomColor: palette.hairline }]}
            >
              <Text style={[styles.dangerText, { color: palette.error }]}>Sign out</Text>
            </PressableScale>
            <PressableScale
              accessibilityLabel="Sign out of all devices"
              accessibilityRole="button"
              onPress={() => setConfirmKind('logout-all')}
              scaleTo={1}
              style={[styles.dangerRow, { borderBottomColor: palette.hairline }]}
            >
              <Text style={[styles.dangerText, { color: palette.error }]}>Sign out of all devices</Text>
            </PressableScale>
            <PressableScale
              accessibilityLabel="Disconnect workspace"
              accessibilityRole="button"
              onPress={() => setConfirmKind('disconnect')}
              scaleTo={1}
              style={[styles.dangerRow, { borderBottomColor: palette.hairline }]}
            >
              <Text style={[styles.dangerText, { color: palette.error }]}>Disconnect workspace</Text>
            </PressableScale>
          </View>

        <ConfirmDialog
          visible={confirmKind === 'logout-all'}
          title="Sign out of every device?"
          message="This revokes every session of your account, including this one. You will need to sign in again."
          confirmLabel="Sign out everywhere"
          destructive
          onConfirm={() => {
            setConfirmKind(null);
            logoutAll();
          }}
          onCancel={() => setConfirmKind(null)}
          palette={palette}
        />

        <ConfirmDialog
          visible={confirmKind === 'disconnect'}
          title="Disconnect this workspace?"
          message="This removes the workspace address and stored credentials from this device. Queued offline changes are kept."
          confirmLabel="Disconnect"
          destructive
          onConfirm={() => {
            setConfirmKind(null);
            disconnectServer();
          }}
          onCancel={() => setConfirmKind(null)}
          palette={palette}
        />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  identity: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  userName: {
    fontFamily: fonts.numeral,
    fontSize: numeralSizes.md,
    fontWeight: '600',
  },
  email: { fontSize: typography.body, marginTop: 2 },
  role: { fontSize: typography.caption, marginTop: 2 },
  sheet: {
    flexGrow: 1,
    borderTopLeftRadius: borderRadius.sheet,
    borderTopRightRadius: borderRadius.sheet,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  msgBox: {
    borderRadius: borderRadius.control,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  msgText: { fontSize: typography.caption, fontWeight: '600' },
  sectionTitle: { fontSize: typography.heading, fontWeight: '600' },
  sectionGap: { marginTop: spacing.xl },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  textAction: { minHeight: 44, justifyContent: 'center', paddingLeft: spacing.md },
  textActionLabel: { fontSize: typography.caption, fontWeight: '600' },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: typography.caption, fontWeight: '600', marginBottom: 2 },
  rowValue: { fontSize: typography.body },
  input: {
    fontSize: typography.body,
    minHeight: 44,
    paddingHorizontal: 0,
  },
  optionsScroll: { marginTop: spacing.xs },
  chipScroll: { flexDirection: 'row', gap: spacing.sm },
  primaryButton: {
    alignItems: 'center',
    borderRadius: borderRadius.control,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: { fontSize: typography.body, fontWeight: '600' },
  securityNotice: { fontSize: typography.caption, marginTop: spacing.xs },
  dangerZone: { marginTop: spacing.xl },
  dangerRow: {
    justifyContent: 'center',
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dangerText: { fontSize: typography.body, fontWeight: '600' },
});
