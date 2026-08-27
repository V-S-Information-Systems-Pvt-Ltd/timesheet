import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';
import { PasswordChangeForm } from '../components/PasswordChangeForm';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';

interface ProfileScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function ProfileScreen({ isDarkMode, onBack }: ProfileScreenProps) {
  const palette = getPalette(isDarkMode);
  const { actor, serverUrl, config, signOut, logoutAll, disconnectServer, changePassword } = useSession();

  const [showPasswordForm, setShowPasswordForm] = useState(false);

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

          <View style={[styles.divider, { backgroundColor: palette.divider }]} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: palette.muted }]}>Permission Role</Text>
            <Text style={[styles.detailValue, { color: palette.foreground }]}>
              {actor?.permissionRole ?? actor?.role ?? '—'}
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: palette.divider }]} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: palette.muted }]}>Hierarchy Role</Text>
            <Text style={[styles.detailValue, { color: palette.foreground }]}>
              {actor?.hierarchyRole ?? 'user'}
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
              <Text style={[styles.changePwToggleText, { color: colors.primary }]}>
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
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    ...shadows.sm,
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
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: { fontSize: typography.badge, fontWeight: '700' },
  cardTitle: { fontSize: typography.heading, fontWeight: '700', marginBottom: spacing.md },
  securityCardTitle: { marginBottom: 0 },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
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
