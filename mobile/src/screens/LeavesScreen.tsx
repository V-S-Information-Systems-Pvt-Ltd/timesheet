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
import { useSessionActor, useSessionActions } from '../auth/SessionProvider';
import type { LeaveRow } from '../api/contracts';
import { fonts, numeralSizes, spacing, typography, borderRadius, useTheme } from '../theme';

import { EmptyState } from '../components/EmptyState';
import { ScreenHeader } from '../components/ScreenHeader';
import { LoadingState } from '../components/LoadingState';
import { PressableScale } from '../components/PressableScale';
import { Toast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { Chip } from '../components/Chip';
import { DateChooserModal } from '../components/DateChooserModal';
import { todayISO, addDaysISO, getDatesInRange, formatDatePreview, formatDateShort, isValidISODate } from '../utils/dates';

interface LeavesScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function LeavesScreen({ isDarkMode: _isDarkMode, onBack }: LeavesScreenProps) {
  const palette = useTheme().palette;
  const { actor } = useSessionActor();
  const { listLeaves, createLeaves, deleteLeave } = useSessionActions();
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
  const [leavePickerVisible, setLeavePickerVisible] = useState(false);
  const [rangePickerTarget, setRangePickerTarget] = useState<'start' | 'end' | null>(null);
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
      setError('Add a reason before marking leave.');
      return;
    }

    let datesToSubmit: string[] = [];
    if (isRangeMode) {
      if (!startDate.trim() || !endDate.trim()) {
        setError('Enter a start and end date, then try again.');
        return;
      }
      if (!isValidISODate(startDate.trim()) || !isValidISODate(endDate.trim())) {
        setError('Dates must use the YYYY-MM-DD format, e.g. 2026-09-10.');
        return;
      }
      datesToSubmit = getDatesInRange(startDate.trim(), endDate.trim());
      if (datesToSubmit.length === 0) {
        setError('The last day must be on or after the first day.');
        return;
      }
      if (datesToSubmit.length > 366) {
        setError('A leave range can cover at most 366 days. Shorten it and try again.');
        return;
      }
    } else {
      if (!leaveDate.trim()) {
        setError('Enter a leave date, then try again.');
        return;
      }
      if (!isValidISODate(leaveDate.trim())) {
        setError('The leave date must use the YYYY-MM-DD format, e.g. 2026-09-10.');
        return;
      }
      datesToSubmit = [leaveDate.trim()];
    }

    setIsSubmitting(true);
    setError(null);
    try {
      // One atomic batch request: the server writes all rows in a single
      // persistence call, so a rejection commits nothing — no partial week.
      await createLeaves(
        datesToSubmit.map((d) => ({
          userId: actor?.id,
          leaveDate: d,
          reason: reason.trim(),
        }))
      );
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
      Alert.alert('Delete leave', `Delete leave on ${formatDatePreview(item.leave_date)}?`, [
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
    ({ item }: { item: LeaveRow }) => {
      const valid = isValidISODate(item.leave_date);
      const day = valid ? String(Number(item.leave_date.slice(8, 10))) : '';
      const month = valid
        ? new Date(`${item.leave_date}T12:00:00`).toLocaleDateString(undefined, { month: 'short' })
        : '';
      return (
        <View style={[styles.leafRow, { borderBottomColor: palette.hairline }]}>
          <View style={[styles.dateBlock, { backgroundColor: palette.leaveTint }]}>
            <Text style={[styles.dateDay, { color: palette.leave }]}>{day}</Text>
            <Text style={[styles.dateMonth, { color: palette.leave }]}>{month}</Text>
          </View>
          <View style={styles.leafText}>
            <Text numberOfLines={2} style={[styles.leafReason, { color: palette.foreground }]}>
              {item.reason}
            </Text>
            <Text style={[styles.leafDate, { color: palette.muted }]}>{formatDateShort(item.leave_date)}</Text>
          </View>
          <Pressable
            accessibilityLabel={`Delete leave on ${formatDateShort(item.leave_date)}`}
            accessibilityRole="button"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={() => handleDeleteLeave(item)}
            style={styles.deleteButton}
          >
            <Icon color={palette.error} name="trash" size={16} />
          </Pressable>
        </View>
      );
    },
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
      style={[
        styles.actionButton,
        showAddForm
          ? [styles.outlined, { borderColor: palette.controlBorder }]
          : { backgroundColor: palette.primary },
      ]}
    >
      <Text style={[styles.actionButtonText, { color: showAddForm ? palette.foreground : palette.onPrimary }]}>
        {showAddForm ? 'Cancel' : 'Mark leave'}
      </Text>
    </PressableScale>
  );

  const renderDateRow = (
    label: string,
    inputLabel: string,
    value: string,
    onChange: (v: string) => void,
    pickerLabel: string,
    onPick: () => void,
    quick?: React.ReactNode
  ) => (
    <View style={[styles.row, { borderBottomColor: palette.hairline }]}>
      <Text style={[styles.rowLabel, { color: palette.muted }]}>{label}</Text>
      <View style={styles.dateRow}>
        <TextInput
          accessibilityLabel={inputLabel}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={palette.placeholder}
          style={[styles.input, styles.dateInput, { color: palette.foreground }]}
          value={value}
        />
        <PressableScale
          accessibilityLabel={pickerLabel}
          accessibilityRole="button"
          onPress={onPick}
          style={styles.iconButton}
        >
          <Icon color={palette.primary} name="calendar" size={18} />
        </PressableScale>
      </View>
      {quick}
    </View>
  );

  const form = showAddForm ? (
    <View style={styles.form}>
      <View style={[styles.row, { borderBottomColor: palette.hairline }]}>
        <Text style={[styles.rowLabel, { color: palette.muted }]}>Days</Text>
        <View style={styles.chipLine}>
          <Chip
            accessibilityLabel="Single day mode"
            active={!isRangeMode}
            label="Single day"
            onPress={() => setIsRangeMode(false)}
            palette={palette}
          />
          <Chip
            accessibilityLabel="Date range mode"
            active={isRangeMode}
            label="Date range"
            onPress={() => setIsRangeMode(true)}
            palette={palette}
          />
        </View>
      </View>

      {!isRangeMode ? (
        renderDateRow(
          'Leave date',
          'Leave Date',
          leaveDate,
          setLeaveDate,
          'Open leave date picker',
          () => setLeavePickerVisible(true),
          <View style={styles.chipLine}>
            <Chip
              accessibilityLabel="Set leave to today"
              active={leaveDate === today}
              label="Today"
              onPress={() => setLeaveDate(today)}
              palette={palette}
            />
            <Chip
              accessibilityLabel="Set leave to tomorrow"
              active={leaveDate === tomorrow}
              label="Tomorrow"
              onPress={() => setLeaveDate(tomorrow)}
              palette={palette}
            />
          </View>
        )
      ) : (
        <>
          {renderDateRow('First day', 'Start Date', startDate, setStartDate, 'Open start date picker', () =>
            setRangePickerTarget('start')
          )}
          {renderDateRow('Last day', 'End Date', endDate, setEndDate, 'Open end date picker', () =>
            setRangePickerTarget('end')
          )}
        </>
      )}

      <View style={[styles.row, { borderBottomColor: palette.hairline }]}>
        <Text style={[styles.rowLabel, { color: palette.muted }]}>Reason</Text>
        <TextInput
          accessibilityLabel="Leave Reason"
          autoCapitalize="sentences"
          autoCorrect={true}
          onChangeText={setReason}
          placeholder="Annual leave, medical, conference"
          placeholderTextColor={palette.placeholder}
          returnKeyType="done"
          style={[styles.input, { color: palette.foreground }]}
          value={reason}
        />
      </View>

      <PressableScale
        accessibilityLabel="Submit leave"
        accessibilityRole="button"
        accessibilityState={{ busy: isSubmitting }}
        disabled={isSubmitting}
        onPress={handleCreateLeave}
        style={[styles.submitButton, { backgroundColor: palette.primary }]}
      >
        <Text style={[styles.submitButtonText, { color: palette.onPrimary }]}>
          {isSubmitting ? 'Saving...' : isRangeMode ? 'Mark leave days' : 'Mark leave'}
        </Text>
      </PressableScale>
    </View>
  ) : null;

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
        title="Leaves"
      />

      {error ? (
        <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
          <Text style={[styles.errorText, { color: palette.error }]}>{error}</Text>
        </View>
      ) : null}

      <View style={[styles.sheet, { backgroundColor: palette.sheet }]}>
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
                actionLabel="Mark a day off"
                icon="calendar"
                message="No leave recorded yet. Mark a day off and it will show up here."
                onAction={() => setShowAddForm(true)}
                palette={palette}
              />
            }
            ListHeaderComponent={form}
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

      <DateChooserModal
        visible={leavePickerVisible}
        title="Choose leave date"
        initialDate={leaveDate}
        dateInputLabel="Leave date"
        confirmLabel="Confirm"
        confirmAccessibilityLabel="Confirm leave date"
        onConfirm={(date) => {
          setLeaveDate(date);
          setLeavePickerVisible(false);
        }}
        onCancel={() => setLeavePickerVisible(false)}
        palette={palette}
      />

      <DateChooserModal
        visible={rangePickerTarget !== null}
        title={rangePickerTarget === 'end' ? 'Choose range end' : 'Choose range start'}
        initialDate={rangePickerTarget === 'end' ? endDate : startDate}
        dateInputLabel={rangePickerTarget === 'end' ? 'End date' : 'Start date'}
        confirmLabel="Confirm"
        confirmAccessibilityLabel="Confirm leave date"
        onConfirm={(date) => {
          if (rangePickerTarget === 'end') setEndDate(date);
          else if (rangePickerTarget === 'start') setStartDate(date);
          setRangePickerTarget(null);
        }}
        onCancel={() => setRangePickerTarget(null)}
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
  form: { marginBottom: spacing.md },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: typography.caption, fontWeight: '600', marginBottom: spacing.xs },
  chipLine: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dateInput: { flex: 1 },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    fontSize: typography.body,
    minHeight: 44,
    paddingHorizontal: 0,
  },
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
  leafRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dateBlock: {
    width: 52,
    height: 56,
    borderRadius: borderRadius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateDay: {
    fontFamily: fonts.numeral,
    fontSize: numeralSizes.sm,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  dateMonth: { fontSize: typography.badge, fontWeight: '600' },
  leafText: { flex: 1 },
  leafReason: { fontSize: typography.body, fontWeight: '600' },
  leafDate: { fontSize: typography.caption, marginTop: 2 },
  deleteButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
