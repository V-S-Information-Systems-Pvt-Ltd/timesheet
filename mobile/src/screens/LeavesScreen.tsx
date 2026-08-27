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

  // New leave form state
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [leaveDate, setLeaveDate] = useState(today);
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
    if (!leaveDate.trim()) {
      setError('Leave date is required.');
      return;
    }
    if (!reason.trim()) {
      setError('Reason is required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await createLeave({
        userId: actor?.id,
        leaveDate: leaveDate.trim(),
        reason: reason.trim(),
      });
      setReason('');
      setShowAddForm(false);
      setShowToast(true);
      await fetchLeaves();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit leave.');
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
            // Optimistically remove from state for 0ms latency
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
      accessibilityLabel={showAddForm ? 'Cancel add leave' : 'Request leave'}
      accessibilityRole="button"
      onPress={() => {
        setShowAddForm(!showAddForm);
        setError(null);
      }}
      style={[styles.actionButton, showAddForm && styles.cancelButton]}
    >
      <Text style={styles.actionButtonText}>{showAddForm ? 'Cancel' : '+ Request Leave'}</Text>
    </PressableScale>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: palette.background }]}
    >
      <Toast
        message="Leave request recorded successfully."
        type="success"
        visible={showToast}
        onDismiss={() => setShowToast(false)}
        palette={palette}
      />

      {/* Header */}
      <ScreenHeader
        title="Leaves & Absences"
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

      {/* Add Leave Form Drawer */}
      {showAddForm ? (
        <View style={[styles.formCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Text style={[styles.formTitle, { color: palette.foreground }]}>Record Leave</Text>

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
                  { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground },
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

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Reason / Remarks</Text>
            <TextInput
              accessibilityLabel="Leave Reason"
              autoCapitalize="sentences"
              autoCorrect={true}
              returnKeyType="done"
              onChangeText={setReason}
              placeholder="e.g. Annual leave, Medical"
              placeholderTextColor={palette.placeholder}
              style={[
                styles.input,
                { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground },
              ]}
              value={reason}
            />
          </View>

          <PressableScale
            accessibilityLabel="Submit leave request"
            accessibilityRole="button"
            accessibilityState={{ busy: isSubmitting }}
            disabled={isSubmitting}
            onPress={handleCreateLeave}
            style={styles.submitButton}
          >
            <Text style={styles.submitButtonText}>
              {isSubmitting ? 'Submitting...' : 'Submit Leave'}
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
              actionLabel="+ Request Leave"
              icon="calendar"
              message="No recorded leaves found."
              onAction={() => setShowAddForm(true)}
              palette={palette}
            />
          }
          maxToRenderPerBatch={10}
          refreshControl={
            <RefreshControl
              onRefresh={handleRefresh}
              refreshing={isRefreshing}
              tintColor={colors.primary}
            />
          }
          removeClippedSubviews={true}
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
  formTitle: { fontSize: typography.heading, fontWeight: '700', marginBottom: spacing.sm },
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
