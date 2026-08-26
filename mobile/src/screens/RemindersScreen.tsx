import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSession } from '../auth/SessionProvider';
import type { ReminderItem } from '../api/contracts';
import { colors, spacing, typography } from '../theme';

interface RemindersScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function RemindersScreen({ isDarkMode, onBack }: RemindersScreenProps) {
  const palette = getPalette(isDarkMode);
  const { listReminders, createReminder, updateReminder, deleteReminder } = useSession();
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // New reminder form state
  const defaultTime = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  const [message, setMessage] = useState('');
  const [remindAt, setRemindAt] = useState(defaultTime);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReminders = useCallback(async () => {
    setError(null);
    try {
      const data = await listReminders();
      setReminders(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load reminders.');
    }
  }, [listReminders]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setIsLoading(true);
      await fetchReminders();
      if (mounted) setIsLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [fetchReminders]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await fetchReminders();
    setIsRefreshing(false);
  }

  async function handleCreateReminder() {
    if (!message.trim()) {
      setError('Reminder message is required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await createReminder({
        message: message.trim(),
        remindAt: new Date(remindAt).toISOString(),
      });
      setMessage('');
      setShowAddForm(false);
      await fetchReminders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create reminder.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggleDone(item: ReminderItem) {
    try {
      await updateReminder(item.id, !item.done);
      await fetchReminders();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to update reminder.');
    }
  }

  async function handleDeleteReminder(item: ReminderItem) {
    Alert.alert('Delete Reminder', 'Are you sure you want to delete this reminder?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteReminder(item.id);
            await fetchReminders();
          } catch (err) {
            Alert.alert('Error', err instanceof Error ? err.message : 'Failed to delete reminder.');
          }
        },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: palette.background }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable
            accessibilityLabel="Back to dashboard"
            accessibilityRole="button"
            onPress={onBack}
            style={styles.backButton}
          >
            <Text style={[styles.backButtonText, { color: colors.primary }]}>‹ Dashboard</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={showAddForm ? 'Cancel add reminder' : 'New reminder'}
            accessibilityRole="button"
            onPress={() => {
              setShowAddForm(!showAddForm);
              setError(null);
            }}
            style={[styles.actionButton, showAddForm && styles.cancelButton]}
          >
            <Text style={styles.actionButtonText}>{showAddForm ? 'Cancel' : '+ New Reminder'}</Text>
          </Pressable>
        </View>
        <Text style={[styles.title, { color: palette.foreground }]}>Reminders</Text>
      </View>

      {error ? (
        <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      ) : null}

      {/* Add Reminder Form */}
      {showAddForm ? (
        <View style={[styles.formCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Text style={[styles.formTitle, { color: palette.foreground }]}>Create Reminder</Text>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Message</Text>
            <TextInput
              accessibilityLabel="Reminder message"
              onChangeText={setMessage}
              placeholder="e.g. Submit timesheet for review"
              placeholderTextColor={palette.placeholder}
              style={[
                styles.input,
                { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground },
              ]}
              value={message}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Remind At (YYYY-MM-DDTHH:MM)</Text>
            <TextInput
              accessibilityLabel="Remind date time"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setRemindAt}
              placeholder="YYYY-MM-DDTHH:MM"
              placeholderTextColor={palette.placeholder}
              style={[
                styles.input,
                { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground },
              ]}
              value={remindAt}
            />
          </View>

          <Pressable
            accessibilityLabel="Save reminder"
            accessibilityRole="button"
            accessibilityState={{ busy: isSubmitting }}
            disabled={isSubmitting}
            onPress={handleCreateReminder}
            style={({ pressed }) => [styles.submitButton, pressed && styles.buttonPressed]}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.submitButtonText}>Save Reminder</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: palette.muted }]}>Loading reminders...</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={reminders}
          keyExtractor={(item, index) => item.id || String(index)}
          ListEmptyComponent={
            <View style={[styles.emptyCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <Text style={[styles.emptyText, { color: palette.muted }]}>No active reminders.</Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              onRefresh={handleRefresh}
              refreshing={isRefreshing}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => (
            <View style={[styles.reminderCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <Pressable
                accessibilityLabel={item.done ? 'Mark as incomplete' : 'Mark as done'}
                accessibilityRole="checkbox"
                onPress={() => handleToggleDone(item)}
                style={[styles.checkbox, item.done && styles.checkboxActive]}
              >
                {item.done ? <Text style={styles.checkmark}>✓</Text> : null}
              </Pressable>

              <View style={styles.reminderContent}>
                <Text
                  style={[
                    styles.reminderMessage,
                    { color: palette.foreground },
                    item.done && styles.reminderMessageDone,
                  ]}
                >
                  {item.message}
                </Text>
                <Text style={[styles.reminderTime, { color: palette.muted }]}>
                  ⏰ {item.remind_at?.slice(0, 16).replace('T', ' ')}
                </Text>
              </View>

              <Pressable
                accessibilityLabel={`Delete reminder: ${item.message}`}
                accessibilityRole="button"
                onPress={() => handleDeleteReminder(item)}
                style={styles.deleteButton}
              >
                <Text style={styles.deleteButtonText}>✕</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </KeyboardAvoidingView>
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
        errorBoxBg: '#3A1E1E',
      }
    : {
        background: colors.background,
        foreground: colors.foreground,
        muted: colors.muted,
        card: colors.card,
        border: colors.border,
        placeholder: colors.placeholder,
        errorBoxBg: colors.errorLight,
      };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backButton: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  backButtonText: { fontSize: typography.body, fontWeight: '600' },
  actionButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  cancelButton: { backgroundColor: colors.muted },
  actionButtonText: { color: colors.onPrimary, fontSize: typography.caption, fontWeight: '700' },
  title: {
    fontSize: typography.title,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  errorBox: {
    borderRadius: 10,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  formCard: {
    borderWidth: 1,
    borderRadius: 14,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  formTitle: { fontSize: typography.heading, fontWeight: '700', marginBottom: spacing.sm },
  fieldGroup: { marginBottom: spacing.sm },
  fieldLabel: { fontSize: typography.caption, fontWeight: '700', marginBottom: 2 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    fontSize: typography.body,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 44,
  },
  submitButtonText: { color: colors.onPrimary, fontSize: typography.body, fontWeight: '700' },
  buttonPressed: { opacity: 0.75 },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: typography.body, marginTop: spacing.md },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  emptyCard: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.xl,
    marginTop: spacing.md,
  },
  emptyText: { fontSize: typography.body },
  reminderCard: {
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  checkboxActive: { backgroundColor: colors.primary },
  checkmark: { color: colors.onPrimary, fontSize: 14, fontWeight: '800' },
  reminderContent: { flex: 1 },
  reminderMessage: { fontSize: typography.body, fontWeight: '600' },
  reminderMessageDone: { textDecorationLine: 'line-through', opacity: 0.6 },
  reminderTime: { fontSize: typography.caption, marginTop: 2 },
  deleteButton: { padding: spacing.xs },
  deleteButtonText: { color: colors.error, fontSize: 16, fontWeight: '700' },
});
