import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import { ApiClient, ApiClientError } from '../api/client';
import type { MobileConfig } from '../api/contracts';
import { getPalette } from '../components';
import { colors, spacing, typography } from '../theme';

/**
 * Manual server entry is an internal/preview feature (implementation plan
 * §3.4). Production builds ship a configured HTTPS base URL instead.
 */
export function ConnectScreen({ onApproved }: { onApproved: (baseUrl: string) => void }) {
  const palette = getPalette(useColorScheme() === 'dark');
  const [serverUrl, setServerUrl] = useState('');
  const [config, setConfig] = useState<MobileConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  async function checkConnection() {
    const url = serverUrl.trim();
    if (!url) {
      setConfig(null);
      setError('Enter the address of your VSIS workspace.');
      return;
    }

    setIsChecking(true);
    setError(null);
    setConfig(null);

    try {
      const nextConfig = await new ApiClient(url).getConfig();
      setConfig(nextConfig);
    } catch (reason) {
      setError(reason instanceof ApiClientError ? reason.message : 'Could not reach a compatible VSIS server. Check the address and try again.');
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>Connect to VSIS</Text>
      <Text style={[styles.subtitle, { color: palette.muted }]}>Enter the public address of the Timesheet web application.</Text>

      <View style={styles.fieldGroup}>
        <Text accessible style={[styles.fieldLabel, { color: palette.foreground }]}>Workspace address</Text>
        <TextInput
          accessibilityLabel="Workspace address"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={setServerUrl}
          onSubmitEditing={() => void checkConnection()}
          placeholder="https://timesheet.example.com"
          placeholderTextColor={palette.placeholder}
          style={[styles.input, styles.inputText, { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground }]}
          value={serverUrl}
        />
        <Text style={[styles.helpText, { color: palette.muted }]}>
          Use an address your device can reach. A computer&apos;s localhost address will not work here.
        </Text>
      </View>

      <Pressable
        accessibilityLabel="Check server"
        accessibilityRole="button"
        accessibilityState={{ busy: isChecking }}
        disabled={isChecking}
        onPress={() => void checkConnection()}
        style={({ pressed }) => [styles.button, (pressed || isChecking) && styles.buttonPressed]}
      >
        {isChecking ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>Check server</Text>}
      </Pressable>

      {error ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.feedback, { color: colors.error }]}>
          {error}
        </Text>
      ) : null}
      {config ? (
        <View accessibilityRole="summary" style={[styles.feedbackCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Text style={[styles.statusTitle, { color: palette.foreground }]}>Workspace connected</Text>
          <Text style={[styles.statusBody, { color: palette.muted }]}>Backend: {config.backend} · API v{config.apiVersion}</Text>
          <Text style={[styles.statusBody, { color: palette.muted }]}>
            {config.capabilities.bearerAuth
              ? 'Mobile sign-in is available on this server.'
              : 'Mobile sign-in has not been enabled on this server yet.'}
          </Text>
          <Pressable
            accessibilityLabel="Use this workspace"
            accessibilityRole="button"
            onPress={() => onApproved(serverUrl.trim().replace(/\/+$/, ''))}
            style={({ pressed }) => [styles.button, styles.useButton, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonText}>Continue</Text>
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  title: { fontSize: typography.title, fontWeight: '800' },
  subtitle: { fontSize: typography.body, lineHeight: 24, marginTop: spacing.sm },
  fieldGroup: { marginTop: spacing.xl },
  fieldLabel: { fontSize: typography.caption, fontWeight: '700', marginBottom: spacing.sm },
  input: { borderRadius: 12, borderWidth: 1, minHeight: 50, paddingHorizontal: spacing.md },
  inputText: { fontSize: typography.body },
  helpText: { fontSize: typography.caption, lineHeight: 20, marginTop: spacing.sm },
  button: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 12, justifyContent: 'center', marginTop: spacing.lg, minHeight: 48, paddingHorizontal: spacing.lg },
  buttonPressed: { opacity: 0.72 },
  buttonText: { color: colors.onPrimary, fontSize: typography.body, fontWeight: '700' },
  feedback: { fontSize: typography.caption, lineHeight: 20, marginTop: spacing.md, fontWeight: '600' },
  feedbackCard: { borderRadius: 16, borderWidth: 1, marginTop: spacing.lg, padding: spacing.lg },
  statusTitle: { fontSize: typography.body, fontWeight: '700' },
  statusBody: { fontSize: typography.caption, lineHeight: 20, marginTop: spacing.sm },
  useButton: { marginTop: spacing.md },
});
