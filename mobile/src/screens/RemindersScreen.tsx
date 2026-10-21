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
import { spacing, typography, borderRadius, useTheme } from '../theme';

import { ScreenHeader } from '../components/ScreenHeader';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { Toast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { Chip } from '../components/Chip';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatLocalDateTime, parseLocalInputToIso } from '../utils/dates';

/** Renders a stored UTC instant as the device-local wall clock. */
function renderLocalTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
  const [dismissTarget, setDismissTarget] = useState<GlobalReminderItem | null>(null);

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
      setError('Add a message for the reminder, then save again.');
      return;
    }

    const isoDate = parseLocalInputToIso(remindAt);
    if (!isoDate) {
      setError('Enter the date and time as YYYY-MM-DDTHH:MM, for example 2026-09-10T09:00.');
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
      Alert.alert('Delete reminder', 'Are you sure you want to delete this reminder?', [
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
      setDismissTarget(null);
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
      <View style={[styles.reminderRow, { borderBottomColor: palette.hairline }]}>
        <Pressable
          accessibilityLabel={item.done ? `Mark reminder "${item.message}" as incomplete` : `Mark reminder "${item.message}" as done`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.done }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={() => handleToggleDone(item)}
          style={[
            styles.checkbox,
            item.done
              ? { backgroundColor: palette.logged, borderColor: palette.logged }
              : { borderColor: palette.controlBorder },
          ]}
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
          <Text style={[styles.reminderTime, { color: palette.muted }]}>
            {renderLocalTime(item.remind_at)}
          </Text>
        </View>

        <Pressable
          accessibilityLabel={`Delete reminder: ${item.message}`}
          accessibilityRole="button"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          onPress={() => handleDeleteReminder(item)}
          style={styles.deleteButton}
        >
          <Icon color={palette.error} name="trash" size={16} />
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
      style={[
        styles.actionButton,
        showAddForm
          ? [styles.outlined, { borderColor: palette.controlBorder }]
          : { backgroundColor: palette.primary },
      ]}
    >
      <Text style={[styles.actionButtonText, { color: showAddForm ? palette.foreground : palette.onPrimary }]}>
        {showAddForm ? 'Cancel' : 'New reminder'}
      </Text>
    </PressableScale>
  );

  const hasGlobal = Boolean(globalReminders && globalReminders.length > 0);

  const listHeader = (
    <>
      {showAddForm ? (
        <View style={styles.form}>
          <View style={[styles.row, { borderBottomColor: palette.hairline }]}>
            <Text style={[styles.rowLabel, { color: palette.muted }]}>Message</Text>
            <TextInput
              accessibilityLabel="Reminder message"
              autoCapitalize="sentences"
              autoCorrect={true}
              onChangeText={setMessage}
              placeholder="Submit timesheet for review"
              placeholderTextColor={palette.placeholder}
              returnKeyType="next"
              style={[styles.input, { color: palette.foreground }]}
              value={message}
            />
          </View>

          <View style={[styles.row, { borderBottomColor: palette.hairline }]}>
            <Text style={[styles.rowLabel, { color: palette.muted }]}>Remind at (YYYY-MM-DDTHH:MM)</Text>
            <TextInput
              accessibilityLabel="Remind date time"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setRemindAt}
              placeholder="YYYY-MM-DDTHH:MM"
              placeholderTextColor={palette.placeholder}
              style={[styles.input, { color: palette.foreground }]}
              value={remindAt}
            />
            <View style={styles.chipLine}>
              <Chip
                accessibilityLabel="Remind in 1 hour"
                active={false}
                label="In 1 hour"
                onPress={() => setPresetTime(1)}
                palette={palette}
              />
              <Chip
                accessibilityLabel="Remind tomorrow morning at 9"
                active={false}
                label="Tomorrow 09:00"
                onPress={() => setPresetTime(24, 9)}
                palette={palette}
              />
              <Chip
                accessibilityLabel="Remind tomorrow evening at 5"
                active={false}
                label="Tomorrow 17:00"
                onPress={() => setPresetTime(24, 17)}
                palette={palette}
              />
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
              {isSubmitting ? 'Saving...' : 'Save reminder'}
            </Text>
          </PressableScale>
        </View>
      ) : null}

      {hasGlobal ? (
        <View>
          <Text style={[styles.sectionHeading, { color: palette.foreground }]}>Announcements</Text>
          {(globalReminders ?? []).map((g) => (
            <View key={g.id} style={[styles.reminderRow, { borderBottomColor: palette.hairline }]}>
              <View style={styles.reminderContent}>
                <Text style={[styles.reminderMessage, { color: palette.foreground }]}>{g.message}</Text>
                <Text style={[styles.reminderTime, { color: palette.muted }]}>
                  Due {renderLocalTime(g.remind_at)}
                </Text>
              </View>
              <PressableScale
                accessibilityLabel={`Dismiss global reminder: ${g.message}`}
                accessibilityRole="button"
                onPress={() => setDismissTarget(g)}
                style={styles.dismissBtn}
              >
                <Text style={[styles.dismissText, { color: palette.primary }]}>Dismiss</Text>
              </PressableScale>
            </View>
          ))}
          <Text style={[styles.sectionHeading, { color: palette.foreground }]}>My reminders</Text>
        </View>
      ) : null}
    </>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: palette.paper }]}
    >
      <Toast
        message={toastMessage}
        onDismiss={() => setShowToast(false)}
        palette={palette}
        type="success"
        visible={showToast}
      />

      <ScreenHeader
        backLabel="‹ Dashboard"
        onBack={onBack}
        palette={palette}
        rightAction={rightAction}
        title="Reminders"
      />

      {error ? (
        <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
          <Text style={[styles.errorText, { color: palette.error }]}>{error}</Text>
        </View>
      ) : null}

      <View style={[styles.sheet, { backgroundColor: palette.sheet }]}>
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
                actionLabel="Add a reminder"
                icon="bell"
                message="No reminders yet. Add one and it will nudge you when it is due."
                onAction={() => setShowAddForm(true)}
                palette={palette}
              />
            }
            ListHeaderComponent={listHeader}
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
      </View>

      <ConfirmDialog
        visible={dismissTarget !== null}
        title="Dismiss this announcement?"
        message={dismissTarget ? `You will stop seeing "${dismissTarget.message}" in this app.` : ''}
        confirmLabel="Dismiss announcement"
        onConfirm={() => dismissTarget && handleDismissGlobal(dismissTarget)}
        onCancel={() => setDismissTarget(null)}
        palette={palette}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sheet: {
    flex: 1,
    marginTop: spacing.sm,
    borderTopLeftRadius: borderRadius.sheet,
    borderTopRightRadius: borderRadius.sheet,
    overflow: 'hidden',
  },
  actionButton: {
    borderRadius: borderRadius.control,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  outlined: { borderWidth: 1 },
  actionButtonText: { fontSize: typography.caption, fontWeight: '600' },
  errorBox: {
    borderRadius: borderRadius.control,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  sectionHeading: {
    fontSize: typography.heading,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  dismissBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
  dismissText: { fontSize: typography.caption, fontWeight: '600' },
  form: { marginBottom: spacing.md },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: typography.caption, fontWeight: '600', marginBottom: spacing.xs },
  input: {
    fontSize: typography.body,
    minHeight: 44,
    paddingHorizontal: 0,
  },
  chipLine: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  submitButton: {
    alignItems: 'center',
    borderRadius: borderRadius.control,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  submitButtonText: { fontSize: typography.body, fontWeight: '600' },
  listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.full,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reminderContent: { flex: 1 },
  reminderMessage: { fontSize: typography.body, fontWeight: '600' },
  reminderMessageDone: { textDecorationLine: 'line-through', opacity: 0.6 },
  reminderTime: {
    fontSize: typography.caption,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  deleteButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
