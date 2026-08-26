import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StatusBar, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ApiClient } from './src/api/client';
import { SessionProvider, useSession } from './src/auth/SessionProvider';
import { SessionController } from './src/auth/session-controller';
import type { SecureTokenStore } from './src/auth/token-store';
import { createSecureTokenStore } from './src/platform/secure-storage';
import { AuthenticatedNavigator } from './src/navigation/AuthenticatedNavigator';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { getPalette } from './src/components';
import { colors, spacing, typography } from './src/theme';

interface MobileEnvironment {
  client: ApiClient;
  controller: SessionController;
}

type EnvironmentResult =
  | { ok: true; environment: MobileEnvironment }
  | { ok: false; message: string };

/**
 * Builds the API client around the persisted approved base URL and the
 * OS-backed secure token store. Fails closed when no secure store exists.
 */
async function createEnvironment(store: SecureTokenStore): Promise<MobileEnvironment> {
  const stored = await store.read();
  const baseUrl = stored?.baseUrl;
  const client = new ApiClient(baseUrl ?? 'https://vsis-unconfigured.invalid');
  const controller = new SessionController(client, store);
  if (baseUrl) controller.setBaseUrl(baseUrl);
  return { client, controller };
}

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [environment, setEnvironment] = useState<EnvironmentResult | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const store = createSecureTokenStore();
        const env = await createEnvironment(store);
        if (mounted) setEnvironment({ ok: true, environment: env });
      } catch (reason) {
        if (mounted) {
          setEnvironment({
            ok: false,
            message: reason instanceof Error ? reason.message : 'This device cannot store sign-in secrets securely.',
          });
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={[styles.safeArea, isDarkMode && styles.darkSurface]}>
        {!environment ? (
          <SplashScreen />
        ) : !environment.ok ? (
          <FatalScreen message={environment.message} />
        ) : (
          <SessionProvider client={environment.environment.client} controller={environment.environment.controller}>
            <RootScreens />
          </SessionProvider>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

/** Routes purely on the session state machine. */
function RootScreens() {
  const { state, controller, client } = useSession();
  // Approved workspace chosen through the internal server-entry screen.
  const [approvedUrl, setApprovedUrl] = useState<string | null>(null);

  switch (state.status) {
    case 'booting':
    case 'refreshing':
    case 'signing-in':
      return <SplashScreen />;
    case 'signed-in':
      return <AuthenticatedNavigator onSignOut={() => void controller.signOut()} />;
    case 'pending-approval':
      return <SignInScreen />;
    case 'fatal':
      return <FatalScreen message={state.message} />;
    case 'offline':
      return <OfflineScreen onRetry={() => void controller.restore()} />;
    case 'signed-out': {
      const baseUrl = state.baseUrl ?? approvedUrl;
      if (!baseUrl) {
        return (
          <ConnectScreen
            onApproved={(url) => {
              controller.setBaseUrl(url);
              client.setBaseUrl(url);
              setApprovedUrl(url);
            }}
          />
        );
      }
      return <SignInScreen deviceName="VSIS mobile app" />;
    }
    default:
      return <SplashScreen />;
  }
}

function SplashScreen() {
  const palette = getPalette(useColorScheme() === 'dark');
  return (
    <View style={styles.centered} accessibilityLabel="Loading">
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.splashText, { color: palette.muted }]}>Starting VSIS Timesheet…</Text>
    </View>
  );
}

function OfflineScreen({ onRetry }: { onRetry: () => void }) {
  const palette = getPalette(useColorScheme() === 'dark');
  return (
    <View style={styles.centered}>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>You are offline</Text>
      <Text style={[styles.subtitle, { color: palette.muted }]}>Reconnect to your network, then retry.</Text>
      <Pressable
        accessibilityLabel="Retry connection"
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonText}>Retry</Text>
      </Pressable>
    </View>
  );
}

function FatalScreen({ message }: { message: string }) {
  const palette = getPalette(useColorScheme() === 'dark');
  return (
    <View style={styles.centered}>
      <Text accessibilityRole="alert" style={[styles.title, { color: palette.foreground }]}>Something is wrong</Text>
      <Text style={[styles.subtitle, { color: palette.muted }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  darkSurface: { backgroundColor: colors.darkBackground },
  centered: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.xl },
  splashText: { marginTop: spacing.md },
  title: { fontSize: typography.title - 8, fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: typography.body, lineHeight: 24, marginTop: spacing.sm, textAlign: 'center' },
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
});

export default App;
