import React, { useState, useCallback } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import {
  SessionProvider,
  useSessionStatus,
  useSessionSync,
  useSessionActions,
} from './src/auth/SessionProvider';
import { SignInScreen } from './src/screens/SignInScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { TimesheetListScreen } from './src/screens/TimesheetListScreen';
import { LogTimeScreen } from './src/screens/LogTimeScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { LeavesScreen } from './src/screens/LeavesScreen';
import { RemindersScreen } from './src/screens/RemindersScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { TeamScreen } from './src/screens/TeamScreen';
import { PendingApprovalScreen } from './src/screens/PendingApprovalScreen';
import { colors, spacing, typography, borderRadius, shadows, getPalette, ThemeProvider, useTheme } from './src/theme';
import { PressableScale } from './src/components/PressableScale';

import { MoreScreen } from './src/screens/MoreScreen';
import { EditTimeScreen } from './src/screens/EditTimeScreen';
import { LayoutCustomizerScreen } from './src/screens/LayoutCustomizerScreen';
import { AdaptiveNavigation } from './src/components/AdaptiveNavigation';
import { OfflineBanner } from './src/components/OfflineBanner';
import {
  navigationReducer,
  initialNavigationState,
} from './src/navigation/navigation-reducer';
import type { AppRoute, RootTab } from './src/navigation/routes';
import type { TimesheetEntry } from './src/api/contracts';
import { useAndroidBackHandler } from './src/platform/useAndroidBackHandler';

type DisconnectedScreen = 'welcome' | 'connect';

function MainNavigator() {
  const { isDarkMode, palette } = useTheme();
  const { status, effectiveActor } = useSessionStatus();
  const { isOffline, pendingCount, isSyncing, flushQueue } = useSessionSync();
  const { disconnectServer } = useSessionActions();
  const [disconnectedScreen, setDisconnectedScreen] = useState<DisconnectedScreen>('welcome');
  const [editingEntry, setEditingEntry] = useState<TimesheetEntry | null>(null);
  const [navState, dispatchNav] = React.useReducer(navigationReducer, initialNavigationState);
  const { width } = useWindowDimensions();
  const isWide = width >= 600;

  const navigateTab = useCallback((tab: RootTab) => {
    dispatchNav({
      type: 'SWITCH_TAB',
      payload: { tab, capabilities: effectiveActor?.capabilities },
    });
  }, [effectiveActor]);

  const navigateTo = useCallback((route: AppRoute) => {
    dispatchNav({
      type: 'PUSH_ROUTE',
      payload: { route, capabilities: effectiveActor?.capabilities },
    });
  }, [effectiveActor]);

  const navigateBack = useCallback(() => {
    dispatchNav({ type: 'GO_BACK' });
  }, []);

  useAndroidBackHandler(() => {
    if (status === 'signed-in' || status === 'refreshing') {
      if (navState.history.length > 1 || navState.currentRoute !== 'dashboard') {
        navigateBack();
        return true;
      }
    } else if (status === 'disconnected') {
      if (disconnectedScreen === 'connect') {
        setDisconnectedScreen('welcome');
        return true;
      }
    }
    return false;
  });

  if (status === 'booting') {
    return (
      <View style={[styles.centerContent, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (status === 'signed-in' || status === 'refreshing') {
    let screenContent: React.ReactNode;

    switch (navState.currentRoute) {
      case 'timesheets':
        screenContent = (
          <TimesheetListScreen
            isDarkMode={isDarkMode}
            onBack={navigateBack}
            onEditTime={(entry) => {
              setEditingEntry(entry);
              navigateTo('edit-time');
            }}
            onLogTime={() => navigateTo('log-time')}
          />
        );
        break;
      case 'edit-time':
        screenContent = editingEntry ? (
          <EditTimeScreen
            entry={editingEntry}
            isDarkMode={isDarkMode}
            onBack={navigateBack}
            onSuccess={navigateBack}
          />
        ) : (
          <TimesheetListScreen
            isDarkMode={isDarkMode}
            onBack={navigateBack}
            onLogTime={() => navigateTo('log-time')}
          />
        );
        break;
      case 'log-time':
        screenContent = (
          <LogTimeScreen
            isDarkMode={isDarkMode}
            onBack={navigateBack}
            onSuccess={navigateBack}
          />
        );
        break;
      case 'profile':
        screenContent = (
          <ProfileScreen
            isDarkMode={isDarkMode}
            onBack={navigateBack}
          />
        );
        break;
      case 'leaves':
        screenContent = (
          <LeavesScreen
            isDarkMode={isDarkMode}
            onBack={navigateBack}
          />
        );
        break;
      case 'reminders':
        screenContent = (
          <RemindersScreen
            isDarkMode={isDarkMode}
            onBack={navigateBack}
          />
        );
        break;
      case 'reports':
        screenContent = (
          <ReportsScreen
            isDarkMode={isDarkMode}
            onBack={navigateBack}
          />
        );
        break;
      case 'team':
        screenContent = (
          <TeamScreen
            isDarkMode={isDarkMode}
            onBack={navigateBack}
          />
        );
        break;
      case 'more':
        screenContent = (
          <MoreScreen
            isDarkMode={isDarkMode}
            onNavigate={(route) => navigateTo(route)}
          />
        );
        break;
      case 'layout-customizer':
        screenContent = (
          <LayoutCustomizerScreen
            isDarkMode={isDarkMode}
            onGoBack={navigateBack}
          />
        );
        break;
      case 'dashboard':
      default:
        screenContent = (
          <HomeScreen
            isDarkMode={isDarkMode}
            onLogTime={() => navigateTo('log-time')}
            onViewLeaves={() => navigateTo('leaves')}
            onViewProfile={() => navigateTo('profile')}
            onViewReminders={() => navigateTo('reminders')}
            onViewReports={() => navigateTo('reports')}
            onViewTeam={() => navigateTo('team')}
            onViewTimesheets={() => navigateTo('timesheets')}
          />
        );
        break;
    }

    return (
      <View style={[styles.authenticatedRoot, isWide && styles.authenticatedRootWide]}>
        {isWide && (
          <AdaptiveNavigation
            activeTab={navState.activeTab}
            currentRoute={navState.currentRoute}
            isDarkMode={isDarkMode}
            onNavigateTab={navigateTab}
            palette={palette}
          />
        )}
        <View style={styles.screenContainer}>
          <OfflineBanner
            isOffline={isOffline}
            isSyncing={isSyncing}
            onSync={flushQueue}
            palette={palette}
            pendingCount={pendingCount}
          />
          {screenContent}
        </View>
        {!isWide && (
          <AdaptiveNavigation
            activeTab={navState.activeTab}
            currentRoute={navState.currentRoute}
            isDarkMode={isDarkMode}
            onNavigateTab={navigateTab}
            palette={palette}
          />
        )}
      </View>
    );
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

interface ErrorBoundaryProps {
  children: React.ReactNode;
  isDarkMode: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class AppErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('AppErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const palette = getPalette(this.props.isDarkMode);
      return (
        <View style={[styles.errorBoundaryContainer, { backgroundColor: palette.background }]}>
          <Text style={[styles.title, { color: colors.error }]}>Something went wrong</Text>
          <Text style={[styles.errorBoundaryMessage, { color: palette.muted }]}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Text>
          <Pressable
            accessibilityLabel="Try again"
            accessibilityRole="button"
            onPress={this.handleReset}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

function AppShell() {
  const { isDarkMode, palette } = useTheme();

  return (
    <>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor={palette.background}
      />
      <AppErrorBoundary isDarkMode={isDarkMode}>
        <SessionProvider>
          <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.background }]}>
            <MainNavigator />
          </SafeAreaView>
        </SessionProvider>
      </AppErrorBoundary>
    </>
  );
}

export function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
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
    <ScrollView
      contentContainerStyle={styles.welcomeScrollContent}
      keyboardShouldPersistTaps="handled"
      style={[styles.container, { backgroundColor: palette.background }]}
    >
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

      <PressableScale
        accessibilityLabel="Connect workspace"
        accessibilityRole="button"
        onPress={onContinue}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Connect workspace</Text>
      </PressableScale>
    </ScrollView>
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
  const { connectServer } = useSessionActions();
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
      style={[styles.container, { backgroundColor: palette.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.connectScrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
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

        <PressableScale
          accessibilityLabel="Check server"
          accessibilityRole="button"
          accessibilityState={{ busy: isChecking }}
          disabled={isChecking}
          onPress={handleCheckConnection}
          style={styles.button}
        >
          {isChecking ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>Check server</Text>
          )}
        </PressableScale>

        {error ? (
          <Text accessibilityRole="alert" style={[styles.feedback, styles.error, { color: colors.error }]}>
            {error}
          </Text>
        ) : null}
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
  safeArea: { flex: 1, backgroundColor: colors.background },
  darkSurface: { backgroundColor: colors.darkBackground },
  container: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  welcomeScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  connectScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  brandMark: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    height: 56,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 56,
    ...shadows.sm,
  },
  brandMarkText: { color: colors.onPrimary, fontSize: 30, fontWeight: '800' },
  eyebrow: { fontSize: typography.eyebrow, fontWeight: '700', letterSpacing: 2, marginBottom: spacing.xs },
  title: { fontSize: typography.title, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: typography.body, lineHeight: 24, marginTop: spacing.sm },
  statusCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    marginTop: spacing.xl,
    padding: spacing.lg,
    ...shadows.sm,
  },
  statusTitle: { fontSize: typography.body, fontWeight: '700' },
  statusBody: { fontSize: typography.caption, lineHeight: 20, marginTop: spacing.sm },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    ...shadows.sm,
  },
  buttonText: { color: colors.onPrimary, fontSize: typography.body, fontWeight: '700' },
  backButton: { alignSelf: 'flex-start', marginBottom: spacing.xl, paddingVertical: spacing.sm },
  backButtonText: { fontSize: typography.body, fontWeight: '700' },
  fieldGroup: { marginTop: spacing.xl },
  fieldLabel: { fontSize: typography.caption, fontWeight: '700', marginBottom: spacing.sm },
  input: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    fontSize: typography.body,
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  helpText: { fontSize: typography.caption, lineHeight: 20, marginTop: spacing.sm },
  feedback: { fontSize: typography.caption, lineHeight: 20, marginTop: spacing.md },
  error: { fontWeight: '600' },
  authenticatedRoot: { flex: 1, width: '100%' },
  authenticatedRootWide: { flexDirection: 'row' },
  screenContainer: { flex: 1, width: '100%', maxWidth: 1024, alignSelf: 'center' },
  errorBoundaryContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  errorBoundaryMessage: {
    fontSize: typography.body,
    lineHeight: 22,
    marginVertical: spacing.lg,
    textAlign: 'center',
  },
});

export default App;
