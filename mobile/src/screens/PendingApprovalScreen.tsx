import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';
import { PressableScale } from '../components/PressableScale';

interface PendingApprovalScreenProps {
  isDarkMode: boolean;
}

export function PendingApprovalScreen({ isDarkMode }: PendingApprovalScreenProps) {
  const palette = getPalette(isDarkMode);
  const { actor, signOut } = useSession();

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <View style={styles.iconContainer}>
          <Text style={styles.iconText}>⏳</Text>
        </View>
        <Text style={[styles.title, { color: palette.foreground }]}>Account Pending Approval</Text>
        <Text style={[styles.body, { color: palette.muted }]}>
          Your account ({actor?.email}) has been created, but an administrator has not activated it yet.
        </Text>
        <Text style={[styles.caption, { color: palette.muted }]}>
          Please contact your VSIS team administrator to activate your access.
        </Text>

        <PressableScale
          accessibilityLabel="Sign out"
          accessibilityRole="button"
          onPress={signOut}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Sign Out</Text>
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
    marginBottom: spacing.md,
  },
  iconText: {
    fontSize: 48,
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
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  caption: {
    fontSize: typography.caption,
    lineHeight: 20,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    width: '100%',
    ...shadows.sm,
  },
  buttonText: {
    color: colors.onPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
});
