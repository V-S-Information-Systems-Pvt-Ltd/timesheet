import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import { ApiClientError } from '../api/client';
import type { MobilePlatform } from '../api/contracts';
import { useSession } from '../auth/SessionProvider';
import { describeApiError, ErrorText, getPalette, PrimaryButton } from '../components';
import { colors, spacing, typography } from '../theme';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function devicePlatform(): MobilePlatform {
  const os = Platform.OS;
  return os === 'android' || os === 'ios' || os === 'windows' ? os : 'android';
}

function validate(email: string, password: string): Partial<Record<'email' | 'password', string>> {
  const errors: Partial<Record<'email' | 'password', string>> = {};
  if (!email.trim()) errors.email = 'Email is required.';
  else if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Password is required.';
  return errors;
}

/** Field-level server errors (VALIDATION_ERROR responses). */
function fieldErrorFrom(reason: unknown, field: 'email' | 'password'): string | undefined {
  if (reason instanceof ApiClientError && reason.fieldErrors) {
    return reason.fieldErrors[field]?.[0];
  }
  return undefined;
}

export function SignInScreen({ deviceName }: { deviceName?: string }) {
  const palette = getPalette(useColorScheme() === 'dark');
  const { state, controller } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'email' | 'password', string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const signingIn = state.status === 'signing-in';

  const statusMessage = useMemo<string | null>(() => {
    if (state.status === 'pending-approval') {
      return 'Your account is not active yet. An administrator must approve it before you can use the app.';
    }
    if (state.status === 'offline') return 'You appear to be offline. Reconnect and try again.';
    if (state.status === 'fatal') return state.message;
    return null;
  }, [state]);

  async function submit() {
    const validation = validate(email, password);
    setFieldErrors(validation);
    setSubmitError(null);
    if (Object.keys(validation).length > 0) return;
    try {
      await controller.signIn({
        email: email.trim(),
        password,
        deviceName,
        platform: devicePlatform(),
      });
    } catch (reason) {
      setSubmitError(
        fieldErrorFrom(reason, 'email') ??
          fieldErrorFrom(reason, 'password') ??
          describeApiError(reason),
      );
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.flex, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>
          Sign in
        </Text>
        <Text style={[styles.subtitle, { color: palette.muted }]}>Use your VSIS Timesheet work account.</Text>

        <View style={styles.fieldGroup}>
          <Text accessible style={[styles.label, { color: palette.foreground }]}>Email</Text>
          <TextInput
            accessibilityLabel="Email"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            onChangeText={(value) => {
              setEmail(value);
              if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
            }}
            onSubmitEditing={submit}
            placeholder="you@company.com"
            placeholderTextColor={palette.placeholder}
            style={[styles.input, styles.inputText, { backgroundColor: palette.card, borderColor: fieldErrors.email ? colors.error : palette.border, color: palette.foreground }]}
            value={email}
          />
          <ErrorText>{fieldErrors.email}</ErrorText>

          <Text accessible style={[styles.label, { color: palette.foreground }]}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              accessibilityLabel="Password"
              autoCapitalize="none"
              autoComplete="password"
              autoCorrect={false}
              onChangeText={(value) => {
                setPassword(value);
                if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
              }}
              onSubmitEditing={submit}
              placeholder="Your password"
              placeholderTextColor={palette.placeholder}
              secureTextEntry={!showPassword}
              style={[styles.input, styles.inputText, styles.passwordInput, { backgroundColor: palette.card, borderColor: fieldErrors.password ? colors.error : palette.border, color: palette.foreground }]}
              value={password}
            />
            <Pressable
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              accessibilityRole="button"
              onPress={() => setShowPassword((visible) => !visible)}
              style={styles.visibilityToggle}
            >
              <Text style={styles.toggleText}>{showPassword ? 'Hide' : 'Show'}</Text>
            </Pressable>
          </View>
          <ErrorText>{fieldErrors.password}</ErrorText>
        </View>

        <PrimaryButton busy={signingIn} busyLabel="Signing in…" disabled={signingIn} label="Sign in" onPress={() => void submit()} />

        <ErrorText>{submitError}</ErrorText>
        {statusMessage ? (
          <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: palette.muted }]}>
            {statusMessage}
          </Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  title: { fontSize: typography.title, fontWeight: '800' },
  subtitle: { fontSize: typography.body, marginTop: spacing.sm },
  fieldGroup: { marginTop: spacing.xl },
  label: { fontSize: typography.caption, fontWeight: '700', marginBottom: spacing.sm, marginTop: spacing.lg },
  input: { borderRadius: 12, borderWidth: 1, minHeight: 50, paddingHorizontal: spacing.md },
  inputText: { fontSize: typography.body },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1 },
  visibilityToggle: { paddingHorizontal: spacing.md, minHeight: 48, justifyContent: 'center' },
  toggleText: { color: colors.primary, fontWeight: '700' },
  feedback: { fontSize: typography.caption, lineHeight: 20, marginTop: spacing.md },
});
