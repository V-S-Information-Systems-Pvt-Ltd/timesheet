import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { colors, spacing, typography } from '../theme';

interface ProfileScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function ProfileScreen({ isDarkMode, onBack }: ProfileScreenProps) {
  const palette = getPalette(isDarkMode);
  const { actor, serverUrl, config, signOut, disconnectServer } = useSession();

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
      }
    : {
        background: colors.background,
        foreground: colors.foreground,
        muted: colors.muted,
        card: colors.card,
        border: colors.border,
        badgeBg: colors.primaryLight,
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
