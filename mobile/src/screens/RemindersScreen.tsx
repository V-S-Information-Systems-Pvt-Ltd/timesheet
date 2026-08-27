import React, { useCallback, useEffect, useState } from 'react';
import {
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
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';

import { ScreenHeader } from '../components/ScreenHeader';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { Toast } from '../components/Toast';

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
  const [showToast, setShowToast] = useState(false);

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

  function setPresetTime(hoursToAdd: number, targetHour?: number) {
    const target = new Date(Date.now() + hoursToAdd * 3600000);
    if (targetHour !== undefined) {
      target.setHours(targetHour, 0, 0, 0);
    }
    setRemindAt(target.toISOString().slice(0, 16));
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
      setShowToast(true);
      await fetchReminders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create reminder.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleToggleDone = useCallback(
    async (item: ReminderItem) => {
      try {
        await updateReminder(item.id, !item.done);
        await fetchReminders();
      } catch (err) {
        Alert.alert('Error', err instanceof Error ? err.message : 'Failed to update reminder.');
      }
    },
    [updateReminder, fetchReminders]
  );

  const handleDeleteReminder = useCallback(
    async (item: ReminderItem) => {
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
    },
    [deleteReminder, fetchReminders]
  );

  const keyExtractor = useCallback((item: ReminderItem, index: number) => item.id || String(index), []);

  const renderItem = useCallback(
    ({ item }: { item: ReminderItem }) => (
      <View style={[styles.reminderCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <Pressable
          accessibilityLabel={item.done ? `Mark reminder "${item.message}" as incomplete` : `Mark reminder "${item.message}" as done`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.done }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
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
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          onPress={() => handleDeleteReminder(item)}
          style={styles.deleteButton}
        >
          <Text style={styles.deleteButtonText}>✕</Text>
        </Pressable>
      </View>
    ),
    [handleDeleteReminder, handleToggleDone, palette]
  );

  const rightAction = (
    <PressableScale
      accessibilityLabel={showAddForm ? 'Cancel add reminder' : 'New reminder'}
      accessibilityRole="button"
      onPress={() => {
        setShowAddForm(!showAddForm);
        setError(null);
      }}
      style={[styles.actionButton, showAddForm && styles.cancelButton]}
    >
      <Text style={styles.actionButtonText}>{showAddForm ? 'Cancel' : '+ New Reminder'}</Text>
    </PressableScale>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: palette.background }]}
    >
      <Toast
        message="Reminder saved successfully."
        type="success"
        visible={showToast}
        onDismiss={() => setShowToast(false)}
        palette={palette}
      />

      {/* Header */}
      <ScreenHeader
        title="Reminders"
        onBack={onBack}
        backLabel="‹ Dashboard"
        rightAction={rightAction}
        palette={palette}
      />

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
              autoCapitalize="sentences"
              autoCorrect={true}
              returnKeyType="next"
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
            {/* Quick time preset shortcuts */}
            <View style={styles.presetRow}>
              <PressableScale
                accessibilityLabel="Remind in 1 hour"
                accessibilityRole="button"
                onPress={() => setPresetTime(1)}
                style={[styles.presetChip, { borderColor: palette.border, backgroundColor: palette.background }]}
              >
                <Text style={[styles.presetChipText, { color: colors.primary }]}>+1 Hour</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Remind tomorrow morning at 9"
                accessibilityRole="button"
                onPress={() => setPresetTime(24, 9)}
                style={[styles.presetChip, { borderColor: palette.border, backgroundColor: palette.background }]}
              >
                <Text style={[styles.presetChipText, { color: colors.primary }]}>Tomorrow 09:00</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Remind tomorrow evening at 5"
                accessibilityRole="button"
                onPress={() => setPresetTime(24, 17)}
                style={[styles.presetChip, { borderColor: palette.border, backgroundColor: palette.background }]}
              >
                <Text style={[styles.presetChipText, { color: colors.primary }]}>Tomorrow 17:00</Text>
              </PressableScale>
            </View>
          </View>

          <PressableScale
            accessibilityLabel="Save reminder"
            accessibilityRole="button"
            accessibilityState={{ busy: isSubmitting }}
            disabled={isSubmitting}
            onPress={handleCreateReminder}
            style={styles.submitButton}
          >
            <Text style={styles.submitButtonText}>
              {isSubmitting ? 'Saving...' : 'Save Reminder'}
            </Text>
          </PressableScale>
        </View>
      ) : null}

      {isLoading ? (
        <LoadingState message="Loading reminders..." palette={palette} />
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={reminders}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          keyExtractor={keyExtractor}
          ListEmptyComponent={
            <EmptyState
              icon="🔔"
              message="No active reminders."
              actionLabel="+ New Reminder"
              onAction={() => setShowAddForm(true)}
              palette={palette}
            />
          }
          refreshControl={
            <RefreshControl
              onRefresh={handleRefresh}
              refreshing={isRefreshing}
              tintColor={colors.primary}
            />
          }
          renderItem={renderItem}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  actionButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 36,
    justifyContent: 'center',
    ...shadows.sm,
  },
  cancelButton: { backgroundColor: colors.muted },
  actionButtonText: { color: colors.onPrimary, fontSize: typography.caption, fontWeight: '700' },
  errorBox: {
    borderRadius: borderRadius.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  formCard: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    ...shadows.md,
  },
  formTitle: { fontSize: typography.heading, fontWeight: '700', marginBottom: spacing.sm },
  fieldGroup: { marginBottom: spacing.sm },
  fieldLabel: { fontSize: typography.caption, fontWeight: '700', marginBottom: 2 },
  input: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    fontSize: typography.body,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  presetRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  presetChip: {
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.sm,
  },
  presetChipText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 48,
    ...shadows.sm,
  },
  submitButtonText: { color: colors.onPrimary, fontSize: typography.body, fontWeight: '700' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  reminderCard: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    padding: spacing.md,
    ...shadows.sm,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.xs,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  checkboxActive: { backgroundColor: colors.primary },
  checkmark: { color: colors.onPrimary, fontSize: 14, fontWeight: '800' },
  reminderContent: { flex: 1 },
  reminderMessage: { fontSize: typography.body, fontWeight: '700' },
  reminderMessageDone: { textDecorationLine: 'line-through', opacity: 0.6 },
  reminderTime: { fontSize: typography.caption, marginTop: 2 },
  deleteButton: { padding: spacing.xs, minHeight: 36, minWidth: 36, justifyContent: 'center', alignItems: 'center' },
  deleteButtonText: { color: colors.error, fontSize: 16, fontWeight: '700' },
});
