import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { SessionProvider, useSession } from './src/auth/SessionProvider';
import { SignInScreen } from './src/screens/SignInScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { TimesheetListScreen } from './src/screens/TimesheetListScreen';
import { LogTimeScreen } from './src/screens/LogTimeScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { LeavesScreen } from './src/screens/LeavesScreen';
import { RemindersScreen } from './src/screens/RemindersScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { PendingApprovalScreen } from './src/screens/PendingApprovalScreen';
import { colors, spacing, typography } from './src/theme';

type DisconnectedScreen = 'welcome' | 'connect';
type AuthenticatedScreen =
  | 'dashboard'
  | 'timesheets'
  | 'log-time'
  | 'profile'
  | 'reports'
  | 'leaves'
  | 'reminders';

function MainNavigator() {
  const isDarkMode = useColorScheme() === 'dark';
  const palette = getPalette(isDarkMode);
  const { status, disconnectServer } = useSession();
  const [disconnectedScreen, setDisconnectedScreen] = useState<DisconnectedScreen>('welcome');
  const [authenticatedScreen, setAuthenticatedScreen] = useState<AuthenticatedScreen>('dashboard');

  if (status === 'booting') {
    return (
      <View style={[styles.centerContent, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (status === 'signed-in' || status === 'refreshing') {
    switch (authenticatedScreen) {
      case 'timesheets':
        return (
          <TimesheetListScreen
            isDarkMode={isDarkMode}
            onBack={() => setAuthenticatedScreen('dashboard')}
            onLogTime={() => setAuthenticatedScreen('log-time')}
          />
        );
      case 'log-time':
        return (
          <LogTimeScreen
            isDarkMode={isDarkMode}
            onBack={() => setAuthenticatedScreen('dashboard')}
            onSuccess={() => setAuthenticatedScreen('dashboard')}
          />
        );
      case 'profile':
        return (
          <ProfileScreen
            isDarkMode={isDarkMode}
            onBack={() => setAuthenticatedScreen('dashboard')}
          />
        );
      case 'leaves':
        return (
          <LeavesScreen
            isDarkMode={isDarkMode}
            onBack={() => setAuthenticatedScreen('dashboard')}
          />
        );
      case 'reminders':
        return (
          <RemindersScreen
            isDarkMode={isDarkMode}
            onBack={() => setAuthenticatedScreen('dashboard')}
          />
        );
      case 'reports':
        return (
          <ReportsScreen
            isDarkMode={isDarkMode}
            onBack={() => setAuthenticatedScreen('dashboard')}
          />
        );
      case 'dashboard':
      default:
        return (
          <HomeScreen
            isDarkMode={isDarkMode}
            onLogTime={() => setAuthenticatedScreen('log-time')}
            onViewLeaves={() => setAuthenticatedScreen('leaves')}
            onViewProfile={() => setAuthenticatedScreen('profile')}
            onViewReminders={() => setAuthenticatedScreen('reminders')}
            onViewReports={() => setAuthenticatedScreen('reports')}
            onViewTimesheets={() => setAuthenticatedScreen('timesheets')}
          />
        );
    }
  }

  if (status === 'pending-approval') {
    return <PendingApprovalScreen isDarkMode={isDarkMode} />;
  }

  if (status === 'signed-out' || status === 'signing-in' || status === 'error') {
    return (
      <SignInScreen
        isDarkMode={isDarkMode}
        onBackToConnect={() => {
          disconnectServer();
          setDisconnectedScreen('connect');
        }}
      />
    );
  }

  // status === 'disconnected'
  return disconnectedScreen === 'welcome' ? (
    <WelcomeScreen
      isDarkMode={isDarkMode}
      onContinue={() => setDisconnectedScreen('connect')}
    />
  ) : (
    <ConnectScreen
      isDarkMode={isDarkMode}
      onBack={() => setDisconnectedScreen('welcome')}
    />
  );
}

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <SessionProvider>
        <SafeAreaView style={[styles.safeArea, isDarkMode && styles.darkSurface]}>
          <MainNavigator />
        </SafeAreaView>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function WelcomeScreen({
  isDarkMode,
  onContinue,
}: {
  isDarkMode: boolean;
  onContinue: () => void;
}) {
  const palette = getPalette(isDarkMode);

  return (
    <View style={styles.container}>
      <Brand />
      <Text style={[styles.eyebrow, { color: colors.primary }]}>VSIS</Text>
      <Text style={[styles.title, { color: palette.foreground }]}>Timesheet</Text>
      <Text style={[styles.subtitle, { color: palette.muted }]}>One workspace for every workday.</Text>

      <View
        style={[
          styles.statusCard,
          { backgroundColor: palette.card, borderColor: palette.border },
        ]}
      >
        <Text style={[styles.statusTitle, { color: palette.foreground }]}>Get started</Text>
        <Text style={[styles.statusBody, { color: palette.muted }]}>
          Connect this app to your VSIS workspace, then sign in with your work account.
        </Text>
      </View>

      <Pressable
        accessibilityLabel="Connect workspace"
        accessibilityRole="button"
        onPress={onContinue}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonText}>Connect workspace</Text>
      </Pressable>
    </View>
  );
}

function ConnectScreen({
  isDarkMode,
  onBack,
}: {
  isDarkMode: boolean;
  onBack: () => void;
}) {
  const palette = getPalette(isDarkMode);
  const { connectServer } = useSession();
  const [serverUrl, setServerUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  async function handleCheckConnection() {
    const url = serverUrl.trim();
    if (!url) {
      setError('Enter the address of your VSIS workspace.');
      return;
    }

    setIsChecking(true);
    setError(null);

    try {
      await connectServer(url);
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : 'Could not reach a compatible VSIS server. Check the address and try again.';
      setError(message);
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Pressable
        accessibilityLabel="Back"
        accessibilityRole="button"
        onPress={onBack}
        style={styles.backButton}
      >
        <Text style={[styles.backButtonText, { color: colors.primary }]}>‹ Back</Text>
      </Pressable>
      <Text style={[styles.title, { color: palette.foreground }]}>Connect to VSIS</Text>
      <Text style={[styles.subtitle, { color: palette.muted }]}>
        Enter the public address of the Timesheet web application.
      </Text>

      <View style={styles.fieldGroup}>
        <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Workspace address</Text>
        <TextInput
          accessibilityLabel="Workspace address"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={setServerUrl}
          placeholder="https://timesheet.example.com"
          placeholderTextColor={palette.placeholder}
          style={[
            styles.input,
            {
              backgroundColor: palette.card,
              borderColor: palette.border,
              color: palette.foreground,
            },
          ]}
          value={serverUrl}
        />
        <Text style={[styles.helpText, { color: palette.muted }]}>
          Use an address your phone can reach. A computer&apos;s localhost address will not work here.
        </Text>
      </View>

      <Pressable
        accessibilityLabel="Check server"
        accessibilityRole="button"
        accessibilityState={{ busy: isChecking }}
        disabled={isChecking}
        onPress={handleCheckConnection}
        style={({ pressed }) => [
          styles.button,
          (pressed || isChecking) && styles.buttonPressed,
        ]}
      >
        {isChecking ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.buttonText}>Check server</Text>
        )}
      </Pressable>

      {error ? (
        <Text accessibilityRole="alert" style={[styles.feedback, styles.error, { color: colors.error }]}>
          {error}
        </Text>
      ) : null}
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

function getPalette(isDarkMode: boolean) {
  return isDarkMode
    ? {
        background: colors.darkBackground,
        foreground: colors.darkForeground,
        muted: colors.darkMuted,
        card: colors.darkCard,
        border: colors.darkBorder,
        placeholder: colors.darkPlaceholder,
      }
    : {
        background: colors.background,
        foreground: colors.foreground,
        muted: colors.muted,
        card: colors.card,
        border: colors.border,
        placeholder: colors.placeholder,
      };
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  darkSurface: { backgroundColor: colors.darkBackground },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  brandMark: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 18,
    height: 56,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 56,
  },
  brandMarkText: { color: colors.onPrimary, fontSize: 30, fontWeight: '800' },
  eyebrow: { fontSize: typography.eyebrow, fontWeight: '700', letterSpacing: 2, marginBottom: spacing.xs },
  title: { fontSize: typography.title, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: typography.body, lineHeight: 24, marginTop: spacing.sm },
  statusCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginTop: spacing.xl,
    padding: spacing.lg,
  },
  statusTitle: { fontSize: typography.body, fontWeight: '700' },
  statusBody: { fontSize: typography.caption, lineHeight: 20, marginTop: spacing.sm },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  buttonPressed: { opacity: 0.72 },
  buttonText: { color: colors.onPrimary, fontSize: typography.body, fontWeight: '700' },
  backButton: { alignSelf: 'flex-start', marginBottom: spacing.xl, paddingVertical: spacing.sm },
  backButtonText: { fontSize: typography.body, fontWeight: '700' },
  fieldGroup: { marginTop: spacing.xl },
  fieldLabel: { fontSize: typography.caption, fontWeight: '700', marginBottom: spacing.sm },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: typography.body,
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  helpText: { fontSize: typography.caption, lineHeight: 20, marginTop: spacing.sm },
  feedback: { fontSize: typography.caption, lineHeight: 20, marginTop: spacing.md },
  error: { fontWeight: '600' },
});

export default App;
