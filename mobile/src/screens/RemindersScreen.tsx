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
import { useSessionData, useSessionActions } from '../auth/SessionProvider';
import type { GlobalReminderItem, ReminderItem } from '../api/contracts';
import { colors, spacing, typography, borderRadius, shadows, useTheme } from '../theme';

import { ScreenHeader } from '../components/ScreenHeader';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { Toast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { formatLocalDateTime, parseLocalInputToIso } from '../utils/dates';

interface RemindersScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function RemindersScreen({ isDarkMode: _isDarkMode, onBack }: RemindersScreenProps) {
  const palette = useTheme().palette;
  const { globalReminders, loadGlobalReminders, dismissGlobalReminder } = useSessionData();
  const { listReminders, createReminder, updateReminder, deleteReminder } = useSessionActions();

  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('Reminder saved successfully.');

  // New reminder form state
  const defaultDate = new Date(Date.now() + 86400000);
  defaultDate.setHours(9, 0, 0, 0);
  const defaultTime = formatLocalDateTime(defaultDate);
  const [message, setMessage] = useState('');
  const [remindAt, setRemindAt] = useState(defaultTime);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [remData] = await Promise.all([
        listReminders(),
        loadGlobalReminders(),
      ]);
      setReminders(remData ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load reminders.');
    }
  }, [listReminders, loadGlobalReminders]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setIsLoading(true);
      await fetchAll();
      if (mounted) setIsLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [fetchAll]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await fetchAll();
    setIsRefreshing(false);
  }

  function setPresetTime(hoursToAdd: number, targetHour?: number) {
    const target = new Date(Date.now() + hoursToAdd * 3600000);
    if (targetHour !== undefined) {
      target.setHours(targetHour, 0, 0, 0);
    }
    setRemindAt(formatLocalDateTime(target));
  }

  async function handleCreateReminder() {
    if (!message.trim()) {
      setError('Reminder message is required.');
      return;
    }

    const isoDate = parseLocalInputToIso(remindAt);
    if (!isoDate) {
      setError('Please enter a valid date and time (YYYY-MM-DDTHH:MM).');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await createReminder({
        message: message.trim(),
        remindAt: isoDate,
      });
      setMessage('');
      setShowAddForm(false);
      setToastMessage('Reminder saved successfully.');
      setShowToast(true);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create reminder.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleToggleDone = useCallback(
    async (item: ReminderItem) => {
      const targetDone = !item.done;
      setReminders((prev) =>
        prev.map((r) => (r.id === item.id ? { ...r, done: targetDone } : r))
      );
      try {
        await updateReminder(item.id, targetDone);
      } catch (err) {
        setReminders((prev) =>
          prev.map((r) => (r.id === item.id ? { ...r, done: item.done } : r))
        );
        Alert.alert('Error', err instanceof Error ? err.message : 'Failed to update reminder.');
      }
    },
    [updateReminder]
  );

  const handleDeleteReminder = useCallback(
    async (item: ReminderItem) => {
      Alert.alert('Delete Reminder', 'Are you sure you want to delete this reminder?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const previous = reminders;
            setReminders((prev) => prev.filter((r) => r.id !== item.id));
            try {
              await deleteReminder(item.id);
            } catch (err) {
              setReminders(previous);
              Alert.alert('Error', err instanceof Error ? err.message : 'Failed to delete reminder.');
            }
          },
        },
      ]);
    },
    [deleteReminder, reminders]
  );

  const handleDismissGlobal = useCallback(
    async (item: GlobalReminderItem) => {
      try {
        await dismissGlobalReminder(item.id);
      } catch (err) {
        Alert.alert('Error', err instanceof Error ? err.message : 'Failed to dismiss announcement.');
      }
    },
    [dismissGlobalReminder]
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
          style={[styles.checkbox, item.done && [styles.checkboxActive, { backgroundColor: palette.primary }]]}
        >
          {item.done ? <Icon color={palette.onPrimary} name="check" size={14} /> : null}
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
          <View style={styles.timeRow}>
            <Icon color={palette.muted} name="clock" size={12} style={styles.timeIcon} />
            <Text style={[styles.reminderTime, { color: palette.muted }]}>
              {item.remind_at?.slice(0, 16).replace('T', ' ')}
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityLabel={`Delete reminder: ${item.message}`}
          accessibilityRole="button"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          onPress={() => handleDeleteReminder(item)}
          style={styles.deleteButton}
        >
          <Icon color={colors.error} name="trash" size={16} />
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
      style={[styles.actionButton, { backgroundColor: palette.primary }, showAddForm && styles.cancelButton]}
    >
      <Text style={[styles.actionButtonText, { color: palette.onPrimary }]}>{showAddForm ? 'Cancel' : '+ New Reminder'}</Text>
    </PressableScale>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: palette.background }]}
    >
      <Toast
        message={toastMessage}
        onDismiss={() => setShowToast(false)}
        palette={palette}
        type="success"
        visible={showToast}
      />

      {/* Header */}
      <ScreenHeader
        backLabel="‹ Dashboard"
        onBack={onBack}
        palette={palette}
        rightAction={rightAction}
        title="Reminders"
      />

      {error ? (
        <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      ) : null}

      {/* Global Announcements / Reminders Banner */}
      {globalReminders && globalReminders.length > 0 ? (
        <View style={styles.globalRemindersContainer}>
          {globalReminders.map((g) => (
            <View
              key={g.id}
              style={[styles.globalReminderCard, { backgroundColor: palette.card, borderColor: palette.primary }]}
            >
              <View style={styles.globalHeader}>
                <View style={[styles.globalBadge, { backgroundColor: palette.primary }]}>
                  <Text style={[styles.globalBadgeText, { color: palette.onPrimary }]}>GLOBAL ANNOUNCEMENT</Text>
                </View>
                <PressableScale
                  accessibilityLabel={`Dismiss global reminder: ${g.message}`}
                  accessibilityRole="button"
                  onPress={() => handleDismissGlobal(g)}
                  style={styles.dismissBtn}
                >
                  <Text style={[styles.dismissText, { color: palette.primary }]}>Dismiss</Text>
                </PressableScale>
              </View>
              <Text style={[styles.globalMessage, { color: palette.foreground }]}>{g.message}</Text>
              <Text style={[styles.globalTime, { color: palette.muted }]}>
                Due: {g.remind_at?.slice(0, 16).replace('T', ' ')}
              </Text>
            </View>
          ))}
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
              onChangeText={setMessage}
              placeholder="e.g. Submit timesheet for review"
              placeholderTextColor={palette.placeholder}
              returnKeyType="next"
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
                <Text style={[styles.presetChipText, { color: palette.primary }]}>+1 Hour</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Remind tomorrow morning at 9"
                accessibilityRole="button"
                onPress={() => setPresetTime(24, 9)}
                style={[styles.presetChip, { borderColor: palette.border, backgroundColor: palette.background }]}
              >
                <Text style={[styles.presetChipText, { color: palette.primary }]}>Tomorrow 09:00</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Remind tomorrow evening at 5"
                accessibilityRole="button"
                onPress={() => setPresetTime(24, 17)}
                style={[styles.presetChip, { borderColor: palette.border, backgroundColor: palette.background }]}
              >
                <Text style={[styles.presetChipText, { color: palette.primary }]}>Tomorrow 17:00</Text>
              </PressableScale>
            </View>
          </View>

          <PressableScale
            accessibilityLabel="Save reminder"
            accessibilityRole="button"
            accessibilityState={{ busy: isSubmitting }}
            disabled={isSubmitting}
            onPress={handleCreateReminder}
            style={[styles.submitButton, { backgroundColor: palette.primary }]}
          >
            <Text style={[styles.submitButtonText, { color: palette.onPrimary }]}>
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
          keyExtractor={keyExtractor}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              actionLabel="+ New Reminder"
              icon="bell"
              message="No active reminders."
              onAction={() => setShowAddForm(true)}
              palette={palette}
            />
          }
          maxToRenderPerBatch={10}
          refreshControl={
            Platform.OS !== 'windows' ? (
              <RefreshControl
                onRefresh={handleRefresh}
                refreshing={isRefreshing}
                tintColor={palette.primary}
              />
            ) : undefined
          }
          removeClippedSubviews={Platform.OS !== 'windows'}
          renderItem={renderItem}
          windowSize={5}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  actionButton: {
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 36,
    justifyContent: 'center',
    ...shadows.sm,
  },
  cancelButton: { backgroundColor: colors.muted },
  actionButtonText: { fontSize: typography.caption, fontWeight: '700' },
  errorBox: {
    borderRadius: borderRadius.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  globalRemindersContainer: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  globalReminderCard: {
    borderRadius: borderRadius.md,
    borderLeftWidth: 4,
    borderWidth: 1,
    padding: spacing.md,
    ...shadows.sm,
  },
  globalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  globalBadge: {
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  globalBadgeText: {
    fontSize: typography.badge,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  dismissBtn: {
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
  },
  dismissText: {
    fontSize: typography.badge,
    fontWeight: '700',
  },
  globalMessage: {
    fontSize: typography.body,
    fontWeight: '600',
    marginBottom: 4,
  },
  globalTime: {
    fontSize: typography.caption,
  },
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
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 48,
    ...shadows.sm,
  },
  submitButtonText: { fontSize: typography.body, fontWeight: '700' },
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
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  checkboxActive: {},
  reminderContent: { flex: 1 },
  reminderMessage: { fontSize: typography.body, fontWeight: '700' },
  reminderMessageDone: { textDecorationLine: 'line-through', opacity: 0.6 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  timeIcon: {
    marginRight: 4,
  },
  reminderTime: { fontSize: typography.caption },
  deleteButton: {
    padding: spacing.xs,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
