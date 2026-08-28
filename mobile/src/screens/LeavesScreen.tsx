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
import type { LeaveRow } from '../api/contracts';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';

import { EmptyState } from '../components/EmptyState';
import { ScreenHeader } from '../components/ScreenHeader';
import { LoadingState } from '../components/LoadingState';
import { PressableScale } from '../components/PressableScale';
import { Toast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { todayISO, addDaysISO, getDatesInRange } from '../utils/dates';

interface LeavesScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function LeavesScreen({ isDarkMode, onBack }: LeavesScreenProps) {
  const palette = getPalette(isDarkMode);
  const { actor, listLeaves, createLeave, deleteLeave } = useSession();
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('Leave marked successfully.');

  // Form mode: single day vs date range
  const [isRangeMode, setIsRangeMode] = useState(false);
  const today = todayISO();
  const tomorrow = addDaysISO(today, 1);

  const [leaveDate, setLeaveDate] = useState(today);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(tomorrow);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaves = useCallback(async () => {
    setError(null);
    try {
      const data = await listLeaves();
      setLeaves(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load leaves.');
    }
  }, [listLeaves]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setIsLoading(true);
      await fetchLeaves();
      if (mounted) setIsLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [fetchLeaves]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await fetchLeaves();
    setIsRefreshing(false);
  }

  async function handleCreateLeave() {
    if (!reason.trim()) {
      setError('Reason / Remarks are required.');
      return;
    }

    let datesToSubmit: string[] = [];
    if (isRangeMode) {
      if (!startDate.trim() || !endDate.trim()) {
        setError('Start date and End date are required.');
        return;
      }
      datesToSubmit = getDatesInRange(startDate.trim(), endDate.trim());
      if (datesToSubmit.length === 0) {
        setError('End date must be on or after start date.');
        return;
      }
      if (datesToSubmit.length > 366) {
        setError('Date range cannot exceed 366 days.');
        return;
      }
    } else {
      if (!leaveDate.trim()) {
        setError('Leave date is required.');
        return;
      }
      datesToSubmit = [leaveDate.trim()];
    }

    setIsSubmitting(true);
    setError(null);
    try {
      for (const d of datesToSubmit) {
        await createLeave({
          userId: actor?.id,
          leaveDate: d,
          reason: reason.trim(),
        });
      }
      setReason('');
      setShowAddForm(false);
      setToastMessage(
        datesToSubmit.length > 1
          ? `Marked ${datesToSubmit.length} leave days successfully.`
          : 'Leave marked successfully.'
      );
      setShowToast(true);
      await fetchLeaves();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark leave.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleDeleteLeave = useCallback(
    async (item: LeaveRow) => {
      Alert.alert('Delete Leave', `Delete leave on ${item.leave_date}?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const previous = leaves;
            setLeaves((prev) => prev.filter((l) => l.id !== item.id));
            try {
              await deleteLeave(item.id);
            } catch (err) {
              setLeaves(previous);
              Alert.alert('Error', err instanceof Error ? err.message : 'Failed to delete leave.');
            }
          },
        },
      ]);
    },
    [deleteLeave, leaves]
  );

  const keyExtractor = useCallback((item: LeaveRow, index: number) => item.id || String(index), []);

  const renderItem = useCallback(
    ({ item }: { item: LeaveRow }) => (
      <View style={[styles.leafCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <View style={styles.leafHeader}>
          <Text style={[styles.leafDate, { color: palette.foreground }]}>{item.leave_date}</Text>
          <Pressable
            accessibilityLabel={`Delete leave on ${item.leave_date}`}
            accessibilityRole="button"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={() => handleDeleteLeave(item)}
            style={styles.deleteButton}
          >
            <Icon color={colors.error} name="trash" size={16} />
          </Pressable>
        </View>
        <Text style={[styles.leafReason, { color: palette.muted }]}>{item.reason}</Text>
      </View>
    ),
    [handleDeleteLeave, palette]
  );

  const rightAction = (
    <PressableScale
      accessibilityLabel={showAddForm ? 'Cancel mark leave' : 'Mark leave'}
      accessibilityRole="button"
      onPress={() => {
        setShowAddForm(!showAddForm);
        setError(null);
      }}
      style={[styles.actionButton, showAddForm && styles.cancelButton]}
    >
      <Text style={styles.actionButtonText}>{showAddForm ? 'Cancel' : '+ Mark Leave'}</Text>
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
        title="Leaves & Absences"
      />

      {error ? (
        <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      ) : null}

      {/* Add Leave Form Drawer */}
      {showAddForm ? (
        <View style={[styles.formCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.formTitleRow}>
            <Text style={[styles.formTitle, { color: palette.foreground }]}>Mark Leave</Text>
            {/* Mode switch: Single vs Range */}
            <View style={styles.modeToggleRow}>
              <Pressable
                accessibilityLabel="Single day mode"
                accessibilityRole="button"
                onPress={() => setIsRangeMode(false)}
                style={[
                  styles.modeButton,
                  !isRangeMode && styles.modeButtonActive,
                  { borderColor: palette.border },
                ]}
              >
                <Text style={[styles.modeButtonText, !isRangeMode && styles.modeButtonTextActive]}>
                  Single
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Date range mode"
                accessibilityRole="button"
                onPress={() => setIsRangeMode(true)}
                style={[
                  styles.modeButton,
                  isRangeMode && styles.modeButtonActive,
                  { borderColor: palette.border },
                ]}
              >
                <Text style={[styles.modeButtonText, isRangeMode && styles.modeButtonTextActive]}>
                  Range
                </Text>
              </Pressable>
            </View>
          </View>

          {!isRangeMode ? (
            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Leave Date (YYYY-MM-DD)</Text>
              <View style={styles.dateRow}>
                <TextInput
                  accessibilityLabel="Leave Date"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setLeaveDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={palette.placeholder}
                  style={[
                    styles.input,
                    styles.dateInput,
                    { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground },
                  ]}
                  value={leaveDate}
                />
                <PressableScale
                  accessibilityLabel="Set leave to today"
                  accessibilityRole="button"
                  accessibilityState={{ selected: leaveDate === today }}
                  onPress={() => setLeaveDate(today)}
                  style={[
                    styles.presetButton,
                    leaveDate === today && styles.presetButtonActive,
                    { borderColor: palette.border, backgroundColor: palette.card },
                  ]}
                >
                  <Text
                    style={[
                      styles.presetText,
                      leaveDate === today ? styles.presetTextActive : { color: palette.foreground },
                    ]}
                  >
                    Today
                  </Text>
                </PressableScale>
                <PressableScale
                  accessibilityLabel="Set leave to tomorrow"
                  accessibilityRole="button"
                  accessibilityState={{ selected: leaveDate === tomorrow }}
                  onPress={() => setLeaveDate(tomorrow)}
                  style={[
                    styles.presetButton,
                    leaveDate === tomorrow && styles.presetButtonActive,
                    { borderColor: palette.border, backgroundColor: palette.card },
                  ]}
                >
                  <Text
                    style={[
                      styles.presetText,
                      leaveDate === tomorrow ? styles.presetTextActive : { color: palette.foreground },
                    ]}
                  >
                    Tomorrow
                  </Text>
                </PressableScale>
              </View>
            </View>
          ) : (
            <View style={styles.rangeContainer}>
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Start Date (YYYY-MM-DD)</Text>
                <TextInput
                  accessibilityLabel="Start Date"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setStartDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={palette.placeholder}
                  style={[
                    styles.input,
                    { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground },
                  ]}
                  value={startDate}
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: palette.foreground }]}>End Date (YYYY-MM-DD)</Text>
                <TextInput
                  accessibilityLabel="End Date"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setEndDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={palette.placeholder}
                  style={[
                    styles.input,
                    { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground },
                  ]}
                  value={endDate}
                />
              </View>
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Reason / Remarks</Text>
            <TextInput
              accessibilityLabel="Leave Reason"
              autoCapitalize="sentences"
              autoCorrect={true}
              onChangeText={setReason}
              placeholder="e.g. Annual leave, Medical"
              placeholderTextColor={palette.placeholder}
              returnKeyType="done"
              style={[
                styles.input,
                { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground },
              ]}
              value={reason}
            />
          </View>

          <PressableScale
            accessibilityLabel="Submit leave"
            accessibilityRole="button"
            accessibilityState={{ busy: isSubmitting }}
            disabled={isSubmitting}
            onPress={handleCreateLeave}
            style={styles.submitButton}
          >
            <Text style={styles.submitButtonText}>
              {isSubmitting ? 'Submitting...' : isRangeMode ? 'Mark Leave Range' : 'Mark Leave'}
            </Text>
          </PressableScale>
        </View>
      ) : null}

      {isLoading ? (
        <LoadingState message="Loading leaves..." palette={palette} />
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={leaves}
          initialNumToRender={10}
          keyExtractor={keyExtractor}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              actionLabel="+ Mark Leave"
              icon="calendar"
              message="No recorded leaves found."
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
                tintColor={colors.primary}
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
  formTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  formTitle: { fontSize: typography.heading, fontWeight: '700' },
  modeToggleRow: {
    flexDirection: 'row',
    gap: 4,
  },
  modeButton: {
    borderWidth: 1,
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  modeButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  modeButtonText: {
    fontSize: typography.badge,
    fontWeight: '700',
  },
  modeButtonTextActive: {
    color: colors.onPrimary,
  },
  rangeContainer: {
    gap: spacing.xs,
  },
  fieldGroup: { marginBottom: spacing.sm },
  fieldLabel: { fontSize: typography.caption, fontWeight: '700', marginBottom: 2 },
  dateRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  dateInput: { flex: 1 },
  presetButton: {
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.sm,
  },
  presetButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetText: { fontSize: typography.caption, fontWeight: '700' },
  presetTextActive: { color: colors.onPrimary },
  input: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    fontSize: typography.body,
    minHeight: 48,
    paddingHorizontal: spacing.md,
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
  leafCard: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
    ...shadows.sm,
  },
  leafHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  leafDate: { fontSize: typography.body, fontWeight: '700' },
  deleteButton: {
    padding: spacing.xs,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  leafReason: { fontSize: typography.caption, marginTop: spacing.xs, lineHeight: 18 },
});
