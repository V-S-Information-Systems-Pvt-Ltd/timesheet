import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSessionStatus, useSessionActions } from '../auth/SessionProvider';
import { fonts, numeralSizes, spacing, typography, borderRadius, useTheme } from '../theme';
import { PressableScale } from '../components/PressableScale';
import { WorkspaceBrand } from '../components/WorkspaceBrand';

interface PendingApprovalScreenProps {
  isDarkMode: boolean;
}

export function PendingApprovalScreen({ isDarkMode: _isDarkMode }: PendingApprovalScreenProps) {
  const palette = useTheme().palette;
  const { actor, branding, checkStatus } = useSessionStatus();
  const { signOut } = useSessionActions();
  const [isChecking, setIsChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function handleCheckStatus() {
    setIsChecking(true);
    setStatusMessage(null);
    try {
      const state = await checkStatus();
      if (state.status === 'pending-approval') {
        setStatusMessage('Still waiting for an administrator to approve your account. Check again later.');
      }
    } catch {
      setStatusMessage('Could not reach the server. Check your connection and try again.');
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.paper }]}>
      <WorkspaceBrand branding={branding} palette={palette} />
      <Text style={[styles.title, { color: palette.foreground }]}>Waiting for approval</Text>
      <Text style={[styles.body, { color: palette.muted }]}>
        {`Your account (${actor?.email}) is created, but an administrator has not activated it yet. Ask your VSIS team administrator to activate your access, then check again.`}
      </Text>

      {statusMessage ? (
        <View accessibilityRole="alert" style={[styles.statusBox, { backgroundColor: palette.sheet, borderColor: palette.hairline }]}>
          <Text style={[styles.statusBoxText, { color: palette.foreground }]}>{statusMessage}</Text>
        </View>
      ) : null}

      <PressableScale
        accessibilityLabel="Check approval status"
        accessibilityRole="button"
        accessibilityState={{ busy: isChecking }}
        disabled={isChecking}
        onPress={handleCheckStatus}
        style={[styles.primaryButton, { backgroundColor: palette.primary }]}
      >
        {isChecking ? (
          <ActivityIndicator color={palette.onPrimary} size="small" />
        ) : (
          <Text style={[styles.primaryButtonText, { color: palette.onPrimary }]}>Check status</Text>
        )}
      </PressableScale>

      <PressableScale
        accessibilityLabel="Sign out"
        accessibilityRole="button"
        onPress={() => signOut()}
        style={styles.secondaryButton}
      >
        <Text style={[styles.secondaryButtonText, { color: palette.muted }]}>Sign out</Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  title: {
    fontFamily: fonts.numeral,
    fontSize: numeralSizes.md,
    fontWeight: '600',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: typography.body,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  statusBox: {
    borderRadius: borderRadius.control,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  statusBoxText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: borderRadius.control,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.xl,
  },
  primaryButtonText: {
    fontSize: typography.body,
    fontWeight: '600',
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: spacing.sm,
  },
  secondaryButtonText: {
    fontSize: typography.body,
    fontWeight: '600',
  },
});
