import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing, typography, borderRadius, shadows, type Palette } from '../theme';
import { PressableScale } from './PressableScale';

interface PasswordChangeFormProps {
  onSubmit: (data: { currentPassword: string; newPassword: string }) => Promise<void>;
  onCancel: () => void;
  palette: Palette;
}

export function PasswordChangeForm({
  onSubmit,
  onCancel,
  palette,
}: PasswordChangeFormProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  async function handleSubmit() {
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
      await onSubmit({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('Success', 'Your password has been changed successfully.');
      onCancel();
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Failed to change password.');
    } finally {
      setIsChangingPassword(false);
    }
  }

  return (
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
          autoComplete="current-password"
          autoCorrect={false}
          onChangeText={setCurrentPassword}
          placeholder="••••••••"
          placeholderTextColor={palette.placeholder}
          secureTextEntry
          textContentType="password"
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
          autoComplete="new-password"
          autoCorrect={false}
          onChangeText={setNewPassword}
          placeholder="••••••••"
          placeholderTextColor={palette.placeholder}
          secureTextEntry
          textContentType="newPassword"
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
          autoComplete="new-password"
          autoCorrect={false}
          onChangeText={setConfirmPassword}
          placeholder="••••••••"
          placeholderTextColor={palette.placeholder}
          secureTextEntry
          textContentType="newPassword"
          style={[
            styles.input,
            { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground },
          ]}
          value={confirmPassword}
        />
      </View>

      <PressableScale
        accessibilityLabel="Save new password"
        accessibilityRole="button"
        accessibilityState={{ busy: isChangingPassword }}
        disabled={isChangingPassword}
        onPress={handleSubmit}
        style={[styles.savePwButton, { backgroundColor: palette.primary }]}
      >
        {isChangingPassword ? (
          <ActivityIndicator color={palette.onPrimary} />
        ) : (
          <Text style={[styles.savePwButtonText, { color: palette.onPrimary }]}>Update Password</Text>
        )}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  passwordForm: {
    marginTop: spacing.md,
  },
  errorBox: {
    borderRadius: borderRadius.sm,
    marginBottom: spacing.md,
    padding: spacing.sm,
  },
  errorText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  fieldGroup: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  input: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    fontSize: typography.body,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 48,
  },
  savePwButton: {
    alignItems: 'center',
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    marginTop: spacing.xs,
    minHeight: 48,
    paddingVertical: spacing.sm,
    ...shadows.sm,
  },
  savePwButtonText: {
    fontSize: typography.body,
    fontWeight: '700',
  },
});
