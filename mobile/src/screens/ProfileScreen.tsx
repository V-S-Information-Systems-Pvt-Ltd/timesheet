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
import { colors, spacing, typography, borderRadius, shadows, useTheme } from '../theme';
import { PasswordChangeForm } from '../components/PasswordChangeForm';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';

interface ProfileScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function ProfileScreen({ isDarkMode: _isDarkMode, onBack }: ProfileScreenProps) {
  const palette = useTheme().palette;
  const { actor, effectiveActor, serverUrl, config } = useSessionActor();
  const { reference, loadReference } = useSessionReference();
  const { updateProfile, signOut, logoutAll, disconnectServer, changePassword } = useSessionActions();

  const currentActor = effectiveActor || actor;

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [department, setDepartment] = useState(currentActor?.department || '');
  const [title, setTitle] = useState(currentActor?.title || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
      setProfileMsg({ type: 'success', text: 'Profile updated successfully.' });
      setIsEditingProfile(false);
    } catch (err) {
      setProfileMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update profile.',
      });
    } finally {
      setIsSavingProfile(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <ScreenHeader
          title="My Profile"
          onBack={onBack}
          backLabel="‹ Dashboard"
          palette={palette}
        />

        {profileMsg ? (
          <View
            accessibilityRole="alert"
            style={[
              styles.msgBox,
              {
                backgroundColor: profileMsg.type === 'success' ? palette.badgeBg : palette.errorBoxBg,
                borderColor: profileMsg.type === 'success' ? palette.primary : colors.error,
              },
            ]}
          >
            <Text
              style={[
                styles.msgText,
                { color: profileMsg.type === 'success' ? palette.primary : colors.error },
              ]}
            >
              {profileMsg.text}
            </Text>
          </View>
        ) : null}

        {/* User Card */}
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={[styles.avatar, { backgroundColor: palette.primary }]}>
            <Text style={[styles.avatarText, { color: palette.onPrimary }]}>
              {currentActor?.name ? currentActor.name[0].toUpperCase() : currentActor?.email ? currentActor.email[0].toUpperCase() : 'U'}
            </Text>
          </View>
          {currentActor?.name ? (
            <Text style={[styles.userName, { color: palette.foreground }]}>{currentActor.name}</Text>
          ) : null}
          <Text style={[styles.email, { color: palette.muted }]}>{currentActor?.email}</Text>
          <View style={[styles.badge, { backgroundColor: palette.badgeBg }]}>
            <Text style={[styles.badgeText, { color: palette.primary }]}>
              {currentActor?.role?.toUpperCase() ?? 'USER'}
            </Text>
          </View>
        </View>

        {/* Professional Details Card */}
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.cardTitle, { color: palette.foreground }]}>Professional Info</Text>
            <PressableScale
              accessibilityLabel={isEditingProfile ? 'Cancel editing profile' : 'Edit profile'}
              accessibilityRole="button"
              onPress={() => {
                setIsEditingProfile(!isEditingProfile);
                setProfileMsg(null);
              }}
              style={styles.editToggle}
            >
              <Text style={[styles.editToggleText, { color: palette.primary }]}>
                {isEditingProfile ? 'Cancel' : 'Edit'}
              </Text>
            </PressableScale>
          </View>

          {isEditingProfile ? (
            <View style={styles.editForm}>
              <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Department</Text>
              <TextInput
                accessibilityLabel="Department"
                onChangeText={setDepartment}
                placeholder="e.g. Engineering, Delivery"
                placeholderTextColor={palette.placeholder}
                style={[
                  styles.input,
                  { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground },
                ]}
                value={department}
              />

              <Text style={[styles.fieldLabel, { color: palette.foreground, marginTop: spacing.sm }]}>Job Title</Text>
              <TextInput
                accessibilityLabel="Job Title"
                onChangeText={setTitle}
                placeholder="e.g. Senior Software Engineer"
                placeholderTextColor={palette.placeholder}
                style={[
                  styles.input,
                  { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground },
                ]}
                value={title}
              />

              {reference?.titles && reference.titles.length > 0 ? (
                <View style={styles.titleSuggestions}>
                  <Text style={[styles.suggestionLabel, { color: palette.muted }]}>Standard Titles:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.optionsScroll}>
                    {reference.titles.map((t, idx) => (
                      <PressableScale
                        key={idx}
                        accessibilityLabel={`Select title ${t}`}
                        accessibilityRole="button"
                        onPress={() => setTitle(t)}
                        style={[
                          styles.chip,
                          title === t ? [styles.chipActive, { backgroundColor: palette.primary, borderColor: palette.primary }] : { backgroundColor: palette.card, borderColor: palette.border },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            title === t ? [styles.chipTextActive, { color: palette.onPrimary }] : { color: palette.foreground },
                          ]}
                        >
                          {t}
                        </Text>
                      </PressableScale>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              <PressableScale
                accessibilityLabel="Save profile changes"
                accessibilityRole="button"
                accessibilityState={{ busy: isSavingProfile }}
                disabled={isSavingProfile}
                onPress={handleSaveProfile}
                style={[styles.saveProfileBtn, { backgroundColor: palette.primary }]}
              >
                {isSavingProfile ? (
                  <ActivityIndicator color={palette.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.saveProfileText, { color: palette.onPrimary }]}>Save Changes</Text>
                )}
              </PressableScale>
            </View>
          ) : (
            <>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: palette.muted }]}>Department</Text>
                <Text style={[styles.detailValue, { color: palette.foreground }]}>
                  {currentActor?.department || '—'}
                </Text>
              </View>

              <View style={[styles.divider, { backgroundColor: palette.divider }]} />

              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: palette.muted }]}>Job Title</Text>
                <Text style={[styles.detailValue, { color: palette.foreground }]}>
                  {currentActor?.title || '—'}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Account Details Card */}
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Text style={[styles.cardTitle, { color: palette.foreground }]}>Account Details</Text>

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: palette.muted }]}>User ID</Text>
            <Text style={[styles.detailValue, { color: palette.foreground }]}>{currentActor?.id ?? '—'}</Text>
          </View>

          <View style={[styles.divider, { backgroundColor: palette.divider }]} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: palette.muted }]}>Permission Role</Text>
            <Text style={[styles.detailValue, { color: palette.foreground }]}>
              {currentActor?.permissionRole ?? currentActor?.role ?? '—'}
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: palette.divider }]} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: palette.muted }]}>Hierarchy Role</Text>
            <Text style={[styles.detailValue, { color: palette.foreground }]}>
              {currentActor?.hierarchyRole ?? 'user'}
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: palette.divider }]} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: palette.muted }]}>Status</Text>
            <Text style={[styles.detailValue, { color: colors.success }]}>Active</Text>
          </View>
        </View>

        {/* Security & Password Card */}
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.cardTitle, styles.securityCardTitle, { color: palette.foreground }]}>Security</Text>
            <PressableScale
              accessibilityLabel={showPasswordForm ? 'Cancel change password' : 'Change password'}
              accessibilityRole="button"
              onPress={() => setShowPasswordForm(!showPasswordForm)}
              style={styles.changePwToggle}
            >
              <Text style={[styles.changePwToggleText, { color: palette.primary }]}>
                {showPasswordForm ? 'Cancel' : 'Change Password'}
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
              Keep your credentials secure. Never share your password.
            </Text>
          )}
        </View>

        {/* Workspace Card */}
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Text style={[styles.cardTitle, { color: palette.foreground }]}>Workspace</Text>

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: palette.muted }]}>Address</Text>
            <Text style={[styles.detailValue, { color: palette.foreground }]}>{serverUrl ?? '—'}</Text>
          </View>

          <View style={[styles.divider, { backgroundColor: palette.divider }]} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: palette.muted }]}>Backend Engine</Text>
            <Text style={[styles.detailValue, { color: palette.foreground }]}>
              {config?.backend ? config.backend.toUpperCase() : 'NATIVE'}
            </Text>
          </View>
        </View>

        {/* Actions */}
        <PressableScale
          accessibilityLabel="Sign out"
          accessibilityRole="button"
          onPress={signOut}
          style={[styles.signOutButton, { backgroundColor: palette.card }]}
        >
          <Text style={[styles.signOutText, { color: colors.error }]}>Sign Out</Text>
        </PressableScale>

        <PressableScale
          accessibilityLabel="Sign out of all devices"
          accessibilityRole="button"
          onPress={logoutAll}
          style={[styles.signOutButton, { marginTop: spacing.sm, backgroundColor: palette.card }]}
        >
          <Text style={[styles.signOutText, { color: colors.error }]}>Sign Out of All Devices</Text>
        </PressableScale>

        <PressableScale
          accessibilityLabel="Disconnect workspace"
          accessibilityRole="button"
          onPress={disconnectServer}
          style={styles.disconnectButton}
        >
          <Text style={[styles.disconnectText, { color: palette.muted }]}>Disconnect Workspace</Text>
        </PressableScale>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  msgBox: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  msgText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  card: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  avatar: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '800',
  },
  userName: {
    fontSize: typography.heading,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 2,
  },
  email: {
    fontSize: typography.caption,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  badge: {
    alignSelf: 'center',
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: spacing.xs,
  },
  badgeText: { fontSize: typography.badge, fontWeight: '700' },
  cardTitle: { fontSize: typography.heading, fontWeight: '700', marginBottom: spacing.md },
  securityCardTitle: { marginBottom: 0 },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  editToggle: { paddingVertical: spacing.xs },
  editToggleText: { fontSize: typography.caption, fontWeight: '700' },
  editForm: { marginTop: spacing.xs },
  fieldLabel: { fontSize: typography.caption, fontWeight: '700', marginBottom: spacing.xs },
  input: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    fontSize: typography.body,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  titleSuggestions: { marginTop: spacing.xs },
  suggestionLabel: { fontSize: typography.badge, fontWeight: '600', marginBottom: 2 },
  optionsScroll: { flexDirection: 'row', marginVertical: spacing.xs },
  chip: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
    minHeight: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipActive: {},
  chipText: { fontSize: typography.badge, fontWeight: '600' },
  chipTextActive: { fontWeight: '700' },
  saveProfileBtn: {
    borderRadius: borderRadius.md,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    ...shadows.sm,
  },
  saveProfileText: { fontSize: typography.body, fontWeight: '700' },
  changePwToggle: { paddingVertical: spacing.xs },
  changePwToggleText: { fontSize: typography.caption, fontWeight: '700' },
  securityNotice: { fontSize: typography.caption, marginTop: spacing.sm },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  detailLabel: { fontSize: typography.caption, fontWeight: '600' },
  detailValue: { fontSize: typography.body, fontWeight: '500' },
  divider: { height: 1, marginVertical: spacing.xs },
  signOutButton: {
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.error,
    justifyContent: 'center',
    minHeight: 48,
    marginTop: spacing.md,
    ...shadows.sm,
  },
  signOutText: { fontSize: typography.body, fontWeight: '700' },
  disconnectButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  disconnectText: { fontSize: typography.caption, fontWeight: '600' },
});
