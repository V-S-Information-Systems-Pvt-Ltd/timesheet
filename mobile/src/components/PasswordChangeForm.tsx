import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { spacing, typography, borderRadius, type Palette } from '../theme';
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
      setPwError('Enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setPwError('Use at least 8 characters for the new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('The new passwords do not match. Retype them and try again.');
      return;
    }

    setIsChangingPassword(true);
    setPwError(null);
    try {
      await onSubmit({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('Password changed', 'Your password has been updated.');
      onCancel();
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Could not change your password. Check your connection and try again.');
    } finally {
      setIsChangingPassword(false);
    }
  }

  const renderField = (
    label: string,
    accessibilityLabel: string,
    value: string,
    onChange: (v: string) => void,
    autoComplete: 'current-password' | 'new-password',
    textContentType: 'password' | 'newPassword'
  ) => (
    <View style={[styles.row, { borderBottomColor: palette.hairline }]}>
      <Text style={[styles.rowLabel, { color: palette.muted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        autoCapitalize="none"
        autoComplete={autoComplete}
        autoCorrect={false}
        onChangeText={onChange}
        placeholderTextColor={palette.placeholder}
        secureTextEntry
        textContentType={textContentType}
        style={[styles.input, { color: palette.foreground }]}
        value={value}
      />
    </View>
  );

  return (
    <View style={styles.passwordForm}>
      {pwError ? (
        <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
          <Text style={[styles.errorText, { color: palette.error }]}>{pwError}</Text>
        </View>
      ) : null}

      {renderField('Current password', 'Current password', currentPassword, setCurrentPassword, 'current-password', 'password')}
      {renderField('New password', 'New password', newPassword, setNewPassword, 'new-password', 'newPassword')}
      {renderField('Confirm new password', 'Confirm new password', confirmPassword, setConfirmPassword, 'new-password', 'newPassword')}

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
          <Text style={[styles.savePwButtonText, { color: palette.onPrimary }]}>Update password</Text>
        )}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  passwordForm: {
    marginTop: spacing.xs,
  },
  errorBox: {
    borderRadius: borderRadius.control,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  errorText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    fontSize: typography.caption,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  input: {
    fontSize: typography.body,
    minHeight: 44,
    paddingHorizontal: 0,
  },
  savePwButton: {
    alignItems: 'center',
    borderRadius: borderRadius.control,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  savePwButtonText: {
    fontSize: typography.body,
    fontWeight: '600',
  },
});
