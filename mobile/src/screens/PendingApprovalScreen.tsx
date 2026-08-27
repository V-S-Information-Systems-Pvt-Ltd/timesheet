import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';
import { PressableScale } from '../components/PressableScale';

interface PendingApprovalScreenProps {
  isDarkMode: boolean;
}

export function PendingApprovalScreen({ isDarkMode }: PendingApprovalScreenProps) {
  const palette = getPalette(isDarkMode);
  const { actor, signOut, loadDashboard } = useSession();
  const [isChecking, setIsChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function handleCheckStatus() {
    setIsChecking(true);
    setStatusMessage(null);
    try {
      await loadDashboard();
      setStatusMessage('Account is still pending administrator approval.');
    } catch {
      setStatusMessage('Unable to reach server. Please check your connection.');
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <View style={[styles.iconContainer, { backgroundColor: palette.badgeBg }]}>
          <Text style={styles.iconText}>⏳</Text>
        </View>
        <Text style={[styles.title, { color: palette.foreground }]}>Account Pending Approval</Text>
        <Text style={[styles.body, { color: palette.muted }]}>
          Your account ({actor?.email}) has been created, but an administrator has not activated it yet.
        </Text>
        <Text style={[styles.caption, { color: palette.muted }]}>
          Please contact your VSIS team administrator to activate your access.
        </Text>

        {statusMessage ? (
          <View style={[styles.statusBox, { backgroundColor: palette.badgeBg }]}>
            <Text style={[styles.statusBoxText, { color: colors.primary }]}>{statusMessage}</Text>
          </View>
        ) : null}

        <PressableScale
          accessibilityLabel="Check approval status"
          accessibilityRole="button"
          accessibilityState={{ busy: isChecking }}
          disabled={isChecking}
          onPress={handleCheckStatus}
          style={styles.primaryButton}
        >
          {isChecking ? (
            <ActivityIndicator color={colors.onPrimary} size="small" />
          ) : (
            <Text style={styles.primaryButtonText}>Check Status ⟳</Text>
          )}
        </PressableScale>

        <PressableScale
          accessibilityLabel="Sign out"
          accessibilityRole="button"
          onPress={signOut}
          style={[styles.secondaryButton, { borderColor: palette.border }]}
        >
          <Text style={[styles.secondaryButtonText, { color: palette.foreground }]}>Sign Out</Text>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  card: {
    alignItems: 'center',
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing.xl,
    ...shadows.md,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  iconText: {
    fontSize: 36,
  },
  title: {
    fontSize: typography.heading,
    fontWeight: '800',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  body: {
    fontSize: typography.body,
    lineHeight: 22,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  caption: {
    fontSize: typography.caption,
    lineHeight: 20,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  statusBox: {
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginBottom: spacing.md,
    width: '100%',
  },
  statusBoxText: {
    fontSize: typography.caption,
    fontWeight: '600',
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    width: '100%',
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    width: '100%',
  },
  secondaryButtonText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
