import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSessionStatus, useSessionActions } from '../auth/SessionProvider';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';
import { PressableScale } from '../components/PressableScale';

interface SignInScreenProps {
  isDarkMode: boolean;
  onBackToConnect: () => void;
}

export function SignInScreen({ isDarkMode, onBackToConnect }: SignInScreenProps) {
  const palette = getPalette(isDarkMode);
  const { status, error, serverUrl, branding, clearError } = useSessionStatus();
  const { signIn, signup } = useSessionActions();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [signupSuccessMsg, setSignupSuccessMsg] = useState<string | null>(null);
  const [isSigningUp, setIsSigningUp] = useState(false);

  const isSubmitting = status === 'signing-in' || isSigningUp;

  async function handleSubmit() {
    clearError();
    setValidationError(null);
    setSignupSuccessMsg(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setValidationError('Please enter your email address.');
      return;
    }
    if (!password) {
      setValidationError('Please enter your password.');
      return;
    }

    if (mode === 'signup') {
      if (password.length < 8) {
        setValidationError('Password must be at least 8 characters long.');
        return;
      }
      setIsSigningUp(true);
      try {
        const res = await signup({
          email: trimmedEmail,
          password,
          name: name.trim() || undefined,
        });
        setSignupSuccessMsg(res.message);
        setMode('signin');
      } catch (err) {
        setValidationError(err instanceof Error ? err.message : 'Registration failed.');
      } finally {
        setIsSigningUp(false);
      }
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
          <Text style={[styles.backButtonText, { color: branding?.primaryColor || colors.primary }]}>‹ Change workspace</Text>
        </Pressable>

        <View style={styles.header}>
          <Brand appName={branding?.appName} logoUrl={branding?.logoUrl} />
          <Text style={[styles.eyebrow, { color: branding?.primaryColor || colors.primary }]}>
            {(branding?.appName || 'VSIS TIMESHEET').toUpperCase()}
          </Text>
          <Text style={[styles.title, { color: palette.foreground }]}>
            {mode === 'signin' ? 'Sign In' : 'Create Account'}
          </Text>
          <Text style={[styles.tagline, { color: palette.muted }]}>Transforming technology to business success.</Text>
          {serverUrl ? (
            <Text style={[styles.serverBadge, { color: palette.muted }]}>
              Workspace: {serverUrl}
            </Text>
          ) : null}
        </View>

        {/* Tab switch: Sign In vs Sign Up */}
        <View style={styles.tabContainer}>
          <Pressable
            accessibilityLabel="Switch to Sign In"
            accessibilityRole="button"
            onPress={() => {
              setMode('signin');
              setValidationError(null);
              clearError();
            }}
            style={[
              styles.tab,
              mode === 'signin' && styles.tabActive,
              { borderColor: palette.border },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                mode === 'signin' ? styles.tabTextActive : { color: palette.muted },
              ]}
            >
              Sign In
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Switch to Register Account"
            accessibilityRole="button"
            onPress={() => {
              setMode('signup');
              setValidationError(null);
              clearError();
            }}
            style={[
              styles.tab,
              mode === 'signup' && styles.tabActive,
              { borderColor: palette.border },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                mode === 'signup' ? styles.tabTextActive : { color: palette.muted },
              ]}
            >
              Register
            </Text>
          </Pressable>
        </View>

        {signupSuccessMsg ? (
          <View
            accessibilityRole="alert"
            style={[styles.successBox, { backgroundColor: palette.badgeBg, borderColor: colors.primary }]}
          >
            <Text style={[styles.successText, { color: colors.primary }]}>{signupSuccessMsg}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          {mode === 'signup' ? (
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Full Name (Optional)</Text>
              <TextInput
                accessibilityLabel="Full Name"
                autoCapitalize="words"
                autoCorrect={false}
                onChangeText={setName}
                placeholder="e.g. Jane Doe"
                placeholderTextColor={palette.placeholder}
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.card,
                    borderColor: palette.border,
                    color: palette.foreground,
                  },
                ]}
                value={name}
              />
            </View>
          ) : null}

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Work Email address</Text>
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
              placeholder="you@company.com"
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
                placeholder={mode === 'signup' ? 'Min 8 chars, 1 uppercase, 1 number' : 'Enter your password'}
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
            accessibilityLabel={mode === 'signin' ? 'Sign in button' : 'Create account button'}
            accessibilityRole="button"
            accessibilityState={{ busy: isSubmitting }}
            disabled={isSubmitting}
            onPress={handleSubmit}
            style={styles.button}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.buttonText}>{mode === 'signin' ? 'Sign In' : 'Create Account'}</Text>
            )}
          </PressableScale>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Brand({ appName, logoUrl }: { appName?: string; logoUrl?: string | null }) {
  const [loadFailed, setLoadFailed] = useState(false);

  return (
    <View style={styles.brandMark}>
      <Image
        accessibilityIgnoresInvertColors
        accessibilityLabel={appName || 'VSIS'}
        onError={() => setLoadFailed(true)}
        resizeMode="contain"
        source={
          logoUrl && !loadFailed
            ? { uri: logoUrl }
            : require('../assets/vsis-logo.jpg')
        }
        style={styles.brandLogo}
      />
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
  header: { marginBottom: spacing.md },
  brandMark: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.md,
    height: 72,
    justifyContent: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    width: 180,
    ...shadows.sm,
  },
  brandLogo: { height: 58, width: 156 },
  eyebrow: { fontSize: typography.eyebrow, fontWeight: '700', letterSpacing: 1.5, marginBottom: spacing.xs },
  title: { fontSize: typography.title, fontWeight: '800', letterSpacing: -0.5 },
  tagline: { fontSize: typography.caption, marginTop: spacing.xs },
  serverBadge: { fontSize: typography.caption, marginTop: spacing.xs },
  tabContainer: {
    flexDirection: 'row',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabText: {
    fontSize: typography.body,
    fontWeight: '700',
  },
  tabTextActive: {
    color: colors.onPrimary,
  },
  successBox: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  successText: {
    fontSize: typography.caption,
    fontWeight: '600',
    lineHeight: 18,
  },
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
