import React, { useState, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSessionStatus, useSessionActions } from '../auth/SessionProvider';
import { colors, fonts, numeralSizes, spacing, typography, borderRadius, getPalette } from '../theme';
import { PressableScale } from '../components/PressableScale';
import { Chip } from '../components/Chip';
import { validateWorkspaceUrl } from '../storage/workspace-store';

interface SignInScreenProps {
  isDarkMode: boolean;
  onBackToConnect: () => void;
}

export function SignInScreen({ isDarkMode, onBackToConnect }: SignInScreenProps) {
  const { status, error, serverUrl, branding, clearError } = useSessionStatus();
  const palette = getPalette(isDarkMode, branding?.primaryColor);
  const { signIn, signup } = useSessionActions();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [signupSuccessMsg, setSignupSuccessMsg] = useState<string | null>(null);
  const [isSigningUp, setIsSigningUp] = useState(false);

  const emailInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);

  const isSubmitting = status === 'signing-in' || isSigningUp;

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;

    clearError();
    setValidationError(null);
    setSignupSuccessMsg(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setValidationError('Enter your email address to continue.');
      return;
    }
    if (!password) {
      setValidationError('Enter your password to continue.');
      return;
    }

    if (mode === 'signup') {
      if (password.length < 8) {
        setValidationError('Use at least 8 characters for your password.');
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
        setValidationError(err instanceof Error ? err.message : 'Could not create your account. Check your details and try again.');
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
  }, [isSubmitting, clearError, email, password, mode, signup, name, signIn]);

  const activeError = validationError || error;

  const handleForgotPassword = useCallback(async () => {
    const canonicalUrl = validateWorkspaceUrl(serverUrl);
    if (!canonicalUrl) {
      setValidationError('Unable to open the password reset page.');
      return;
    }
    try {
      await Linking.openURL(`${canonicalUrl}/forgot-password`);
    } catch {
      setValidationError('Unable to open the password reset page.');
    }
  }, [serverUrl]);

  const accent = palette.primaryText;
  const inputStyle = (hasError: boolean) => [
    styles.input,
    {
      backgroundColor: palette.sheet,
      borderColor: hasError ? palette.error : palette.controlBorder,
      color: palette.foreground,
    },
  ];

  return (
    <KeyboardAvoidingView
      // Android targetSdk 36 runs edge-to-edge, which ignores adjustResize; 'height' is needed to lift fields.
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      // The SafeAreaView above shifts this view down by the status bar; without the offset the
      // keyboard overlap is underestimated by that much and the password field stays partly covered.
      keyboardVerticalOffset={Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0}
      style={[styles.container, { backgroundColor: palette.paper }]}
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
          <Text style={[styles.backButtonText, { color: accent }]}>‹ Change workspace</Text>
        </Pressable>

        <View style={styles.header}>
          <Brand appName={branding?.appName} logoUrl={branding?.logoUrl} />
          <Text style={[styles.workspaceName, { color: palette.muted }]}>
            {branding?.appName || 'VSIS Timesheet'}
          </Text>
          <Text style={[styles.title, { color: palette.foreground }]}>
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </Text>
          {serverUrl ? (
            <Text style={[styles.serverBadge, { color: palette.muted }]}>
              Workspace: {serverUrl}
            </Text>
          ) : null}
        </View>

        <View style={styles.tabContainer}>
          <Chip
            accessibilityLabel="Switch to Sign In"
            active={mode === 'signin'}
            label="Sign in"
            onPress={() => {
              setMode('signin');
              setValidationError(null);
              clearError();
            }}
            palette={palette}
          />
          <Chip
            accessibilityLabel="Switch to Register Account"
            active={mode === 'signup'}
            label="Register"
            onPress={() => {
              setMode('signup');
              setValidationError(null);
              clearError();
            }}
            palette={palette}
          />
        </View>

        {signupSuccessMsg ? (
          <View
            accessibilityRole="alert"
            style={[styles.successBox, { backgroundColor: palette.loggedTint }]}
          >
            <Text style={[styles.successText, { color: palette.loggedText }]}>{signupSuccessMsg}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          {mode === 'signup' ? (
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: palette.muted }]}>Full name (optional)</Text>
              <TextInput
                accessibilityLabel="Full Name"
                autoCapitalize="words"
                autoCorrect={false}
                blurOnSubmit={false}
                onChangeText={setName}
                onSubmitEditing={() => emailInputRef.current?.focus()}
                placeholder="Jane Doe"
                placeholderTextColor={palette.placeholder}
                returnKeyType="next"
                style={inputStyle(false)}
                value={name}
              />
            </View>
          ) : null}

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: palette.muted }]}>Work email</Text>
            <TextInput
              accessibilityLabel="Email address"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              blurOnSubmit={false}
              keyboardType="email-address"
              onChangeText={(text) => {
                setEmail(text);
                if (validationError) setValidationError(null);
                if (error) clearError();
              }}
              onSubmitEditing={() => passwordInputRef.current?.focus()}
              placeholder="you@company.com"
              placeholderTextColor={palette.placeholder}
              ref={emailInputRef}
              returnKeyType="next"
              style={inputStyle(Boolean(activeError))}
              textContentType="emailAddress"
              value={email}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: palette.muted }]}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                accessibilityLabel="Password"
                autoCapitalize="none"
                autoComplete="current-password"
                autoCorrect={false}
                onChangeText={(text) => {
                  setPassword(text);
                  if (validationError) setValidationError(null);
                  if (error) clearError();
                }}
                onSubmitEditing={() => {
                  if (!isSubmitting) {
                    handleSubmit();
                  }
                }}
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                placeholderTextColor={palette.placeholder}
                ref={passwordInputRef}
                returnKeyType={mode === 'signin' ? 'go' : 'done'}
                secureTextEntry={!showPassword}
                style={[...inputStyle(Boolean(activeError)), styles.passwordInput]}
                textContentType="password"
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
              <Text style={[styles.errorText, { color: palette.error }]}>{activeError}</Text>
            </View>
          ) : null}

          <PressableScale
            accessibilityLabel={mode === 'signin' ? 'Sign in button' : 'Create account button'}
            accessibilityRole="button"
            accessibilityState={{ busy: isSubmitting }}
            disabled={isSubmitting}
            onPress={handleSubmit}
            style={[styles.button, { backgroundColor: palette.primary }]}
          >
            {isSubmitting ? (
              <ActivityIndicator color={palette.onPrimary} />
            ) : (
              <Text style={[styles.buttonText, { color: palette.onPrimary }]}>
                {mode === 'signin' ? 'Sign in' : 'Create account'}
              </Text>
            )}
          </PressableScale>

          {mode === 'signin' && serverUrl ? (
            <Pressable
              accessibilityLabel="Forgot password"
              accessibilityRole="link"
              onPress={handleForgotPassword}
              style={styles.forgotPassword}
            >
              <Text style={[styles.forgotPasswordText, { color: accent }]}>
                Forgot password?
              </Text>
            </Pressable>
          ) : null}
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
    // Keeps fields a readable width on desktop windows instead of spanning the screen.
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginBottom: spacing.sm },
  backButtonText: { fontSize: typography.body, fontWeight: '600' },
  header: { marginBottom: spacing.lg },
  // The logo is a JPEG on white, so it keeps a white tile; no shadow.
  brandMark: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: borderRadius.control,
    height: 72,
    justifyContent: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    width: 180,
  },
  brandLogo: { height: 58, width: 156 },
  workspaceName: { fontSize: typography.body, fontWeight: '500', marginBottom: spacing.xs },
  title: {
    fontFamily: fonts.numeral,
    fontSize: numeralSizes.lg,
    fontWeight: '600',
  },
  serverBadge: { fontSize: typography.caption, marginTop: spacing.xs },
  tabContainer: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  successBox: {
    borderRadius: borderRadius.control,
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
  fieldLabel: { fontSize: typography.caption, fontWeight: '600', marginBottom: spacing.xs },
  input: {
    borderRadius: borderRadius.control,
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
    borderRadius: borderRadius.control,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600', lineHeight: 18 },
  button: {
    alignItems: 'center',
    borderRadius: borderRadius.control,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  buttonText: { fontSize: typography.body, fontWeight: '600' },
  forgotPassword: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: spacing.sm },
  forgotPasswordText: { fontSize: typography.caption, fontWeight: '600' },
});
