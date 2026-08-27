import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';
import { PressableScale } from '../components/PressableScale';

interface SignInScreenProps {
  isDarkMode: boolean;
  onBackToConnect: () => void;
}

export function SignInScreen({ isDarkMode, onBackToConnect }: SignInScreenProps) {
  const palette = getPalette(isDarkMode);
  const { signIn, status, error, serverUrl, clearError } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const isSubmitting = status === 'signing-in';

  async function handleSubmit() {
    clearError();
    setValidationError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setValidationError('Please enter your email address.');
      return;
    }
    if (!password) {
      setValidationError('Please enter your password.');
      return;
    }

    try {
      await signIn({ email: trimmedEmail, password });
    } catch {
      // Handled via SessionProvider error state
    }
  }

  const activeError = validationError || error;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: palette.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityLabel="Back to workspace address"
          accessibilityRole="button"
          onPress={onBackToConnect}
          style={styles.backButton}
        >
          <Text style={[styles.backButtonText, { color: colors.primary }]}>‹ Change workspace</Text>
        </Pressable>

        <View style={styles.header}>
          <Brand />
          <Text style={[styles.eyebrow, { color: colors.primary }]}>VSIS TIMESHEET</Text>
          <Text style={[styles.title, { color: palette.foreground }]}>Sign In</Text>
          {serverUrl ? (
            <Text style={[styles.serverBadge, { color: palette.muted }]}>
              Workspace: {serverUrl}
            </Text>
          ) : null}
        </View>

        <View style={styles.form}>
          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Email address</Text>
            <TextInput
              accessibilityLabel="Email address"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              onChangeText={(text) => {
                setEmail(text);
                if (validationError) setValidationError(null);
                if (error) clearError();
              }}
              placeholder="you@example.com"
              placeholderTextColor={palette.placeholder}
              style={[
                styles.input,
                {
                  backgroundColor: palette.card,
                  borderColor: activeError ? colors.error : palette.border,
                  color: palette.foreground,
                },
              ]}
              value={email}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                accessibilityLabel="Password"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(text) => {
                  setPassword(text);
                  if (validationError) setValidationError(null);
                  if (error) clearError();
                }}
                placeholder="Enter your password"
                placeholderTextColor={palette.placeholder}
                secureTextEntry={!showPassword}
                style={[
                  styles.input,
                  styles.passwordInput,
                  {
                    backgroundColor: palette.card,
                    borderColor: activeError ? colors.error : palette.border,
                    color: palette.foreground,
                  },
                ]}
                value={password}
              />
              <Pressable
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                accessibilityRole="button"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeButton}
              >
                <Text style={[styles.eyeText, { color: palette.muted }]}>
                  {showPassword ? 'Hide' : 'Show'}
                </Text>
              </Pressable>
            </View>
          </View>

          {activeError ? (
            <View
              accessibilityRole="alert"
              style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}
            >
              <Text style={[styles.errorText, { color: colors.error }]}>{activeError}</Text>
            </View>
          ) : null}

          <PressableScale
            accessibilityLabel="Sign in button"
            accessibilityRole="button"
            accessibilityState={{ busy: isSubmitting }}
            disabled={isSubmitting}
            onPress={handleSubmit}
            style={styles.button}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </PressableScale>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Brand() {
  return (
    <View style={styles.brandMark}>
      <Text style={styles.brandMarkText}>V</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  backButton: { alignSelf: 'flex-start', marginBottom: spacing.md, paddingVertical: spacing.xs },
  backButtonText: { fontSize: typography.body, fontWeight: '600' },
  header: { marginBottom: spacing.lg },
  brandMark: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    height: 48,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: 48,
    ...shadows.sm,
  },
  brandMarkText: { color: colors.onPrimary, fontSize: 24, fontWeight: '800' },
  eyebrow: { fontSize: typography.eyebrow, fontWeight: '700', letterSpacing: 1.5, marginBottom: spacing.xs },
  title: { fontSize: typography.title, fontWeight: '800', letterSpacing: -0.5 },
  serverBadge: { fontSize: typography.caption, marginTop: spacing.xs },
  form: { width: '100%' },
  fieldGroup: { marginBottom: spacing.md },
  fieldLabel: { fontSize: typography.caption, fontWeight: '700', marginBottom: spacing.xs },
  input: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    fontSize: typography.body,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  passwordContainer: { position: 'relative', justifyContent: 'center' },
  passwordInput: { paddingRight: 64 },
  eyeButton: {
    position: 'absolute',
    right: spacing.md,
    padding: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  eyeText: { fontSize: typography.caption, fontWeight: '600' },
  errorBox: {
    borderRadius: borderRadius.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600', lineHeight: 18 },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    ...shadows.sm,
  },
  buttonText: { color: colors.onPrimary, fontSize: typography.body, fontWeight: '700' },
});
