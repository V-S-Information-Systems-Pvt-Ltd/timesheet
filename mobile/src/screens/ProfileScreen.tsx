import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { colors, spacing, typography } from '../theme';

interface ProfileScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function ProfileScreen({ isDarkMode, onBack }: ProfileScreenProps) {
  const palette = getPalette(isDarkMode);
  const { actor, serverUrl, config, signOut, disconnectServer, changePassword } = useSession();

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  async function handleChangePassword() {
    if (!currentPassword) {
      setPwError('Current password is required.');
      return;
    }
    if (newPassword.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('New passwords do not match.');
      return;
    }

    setIsChangingPassword(true);
    setPwError(null);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordForm(false);
      Alert.alert('Success', 'Your password has been changed successfully.');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Failed to change password.');
    } finally {
      setIsChangingPassword(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back to dashboard"
            accessibilityRole="button"
            onPress={onBack}
            style={styles.backButton}
          >
            <Text style={[styles.backButtonText, { color: colors.primary }]}>‹ Dashboard</Text>
          </Pressable>
          <Text style={[styles.title, { color: palette.foreground }]}>My Profile</Text>
        </View>

        {/* User Card */}
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {actor?.email ? actor.email[0].toUpperCase() : 'U'}
            </Text>
          </View>
          <Text style={[styles.email, { color: palette.foreground }]}>{actor?.email}</Text>
          <View style={[styles.badge, { backgroundColor: palette.badgeBg }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>
              {actor?.role?.toUpperCase() ?? 'USER'}
            </Text>
          </View>
        </View>

        {/* Details Card */}
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Text style={[styles.cardTitle, { color: palette.foreground }]}>Account Details</Text>

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: palette.muted }]}>User ID</Text>
            <Text style={[styles.detailValue, { color: palette.foreground }]}>{actor?.id ?? '—'}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: palette.muted }]}>Permission Role</Text>
            <Text style={[styles.detailValue, { color: palette.foreground }]}>
              {actor?.permissionRole ?? actor?.role ?? '—'}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: palette.muted }]}>Hierarchy Role</Text>
            <Text style={[styles.detailValue, { color: palette.foreground }]}>
              {actor?.hierarchyRole ?? 'user'}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: palette.muted }]}>Status</Text>
            <Text style={[styles.detailValue, { color: colors.success }]}>Active</Text>
          </View>
        </View>

        {/* Security & Password Card */}
        <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.cardTitle, { color: palette.foreground, marginBottom: 0 }]}>Security</Text>
            <Pressable
              accessibilityLabel={showPasswordForm ? 'Cancel change password' : 'Change password'}
              accessibilityRole="button"
              onPress={() => {
                setShowPasswordForm(!showPasswordForm);
                setPwError(null);
              }}
              style={styles.changePwToggle}
            >
              <Text style={[styles.changePwToggleText, { color: colors.primary }]}>
                {showPasswordForm ? 'Cancel' : 'Change Password'}
              </Text>
            </Pressable>
          </View>

          {showPasswordForm ? (
            <View style={styles.passwordForm}>
              {pwError ? (
                <View style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
                  <Text style={[styles.errorText, { color: colors.error }]}>{pwError}</Text>
                </View>
              ) : null}

              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Current Password</Text>
                <TextInput
                  accessibilityLabel="Current password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setCurrentPassword}
                  placeholder="••••••••"
                  placeholderTextColor={palette.placeholder}
                  secureTextEntry
                  style={[
                    styles.input,
                    { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground },
                  ]}
                  value={currentPassword}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: palette.foreground }]}>New Password</Text>
                <TextInput
                  accessibilityLabel="New password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setNewPassword}
                  placeholder="••••••••"
                  placeholderTextColor={palette.placeholder}
                  secureTextEntry
                  style={[
                    styles.input,
                    { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground },
                  ]}
                  value={newPassword}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Confirm New Password</Text>
                <TextInput
                  accessibilityLabel="Confirm new password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setConfirmPassword}
                  placeholder="••••••••"
                  placeholderTextColor={palette.placeholder}
                  secureTextEntry
                  style={[
                    styles.input,
                    { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground },
                  ]}
                  value={confirmPassword}
                />
              </View>

              <Pressable
                accessibilityLabel="Save new password"
                accessibilityRole="button"
                accessibilityState={{ busy: isChangingPassword }}
                disabled={isChangingPassword}
                onPress={handleChangePassword}
                style={({ pressed }) => [styles.savePwButton, pressed && styles.buttonPressed]}
              >
                {isChangingPassword ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text style={styles.savePwButtonText}>Update Password</Text>
                )}
              </Pressable>
            </View>
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

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: palette.muted }]}>Backend Engine</Text>
            <Text style={[styles.detailValue, { color: palette.foreground }]}>
              {config?.backend ? config.backend.toUpperCase() : 'NATIVE'}
            </Text>
          </View>
        </View>

        {/* Actions */}
        <Pressable
          accessibilityLabel="Sign out"
          accessibilityRole="button"
          onPress={signOut}
          style={({ pressed }) => [styles.signOutButton, pressed && styles.buttonPressed]}
        >
          <Text style={[styles.signOutText, { color: colors.error }]}>Sign Out</Text>
        </Pressable>

        <Pressable
          accessibilityLabel="Disconnect workspace"
          accessibilityRole="button"
          onPress={disconnectServer}
          style={({ pressed }) => [styles.disconnectButton, pressed && styles.buttonPressed]}
        >
          <Text style={[styles.disconnectText, { color: palette.muted }]}>Disconnect Workspace</Text>
        </Pressable>
      </ScrollView>
    </View>
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
        badgeBg: '#1C2C4E',
        placeholder: colors.darkPlaceholder,
        errorBoxBg: '#3A1E1E',
      }
    : {
        background: colors.background,
        foreground: colors.foreground,
        muted: colors.muted,
        card: colors.card,
        border: colors.border,
        badgeBg: colors.primaryLight,
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
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  avatar: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: {
    color: colors.onPrimary,
    fontSize: 28,
    fontWeight: '800',
  },
  email: {
    fontSize: typography.heading,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  badge: {
    alignSelf: 'center',
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: { fontSize: typography.badge, fontWeight: '700' },
  cardTitle: { fontSize: typography.heading, fontWeight: '700', marginBottom: spacing.md },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  changePwToggle: { paddingVertical: spacing.xs },
  changePwToggleText: { fontSize: typography.caption, fontWeight: '700' },
  passwordForm: { marginTop: spacing.md },
  fieldGroup: { marginBottom: spacing.sm },
  fieldLabel: { fontSize: typography.caption, fontWeight: '700', marginBottom: 2 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: typography.body,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  savePwButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: spacing.xs,
    minHeight: 44,
  },
  savePwButtonText: { color: colors.onPrimary, fontSize: typography.body, fontWeight: '700' },
  securityNotice: { fontSize: typography.caption, marginTop: spacing.sm },
  errorBox: {
    borderRadius: 8,
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  detailLabel: { fontSize: typography.caption, fontWeight: '600' },
  detailValue: { fontSize: typography.body, fontWeight: '500' },
  divider: { height: 1, backgroundColor: 'rgba(0,0,0,0.05)', marginVertical: spacing.xs },
  signOutButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error,
    justifyContent: 'center',
    minHeight: 48,
    marginTop: spacing.md,
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
  buttonPressed: { opacity: 0.75 },
});
