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
import type { LeaveRow } from '../api/contracts';
import { colors, spacing, typography } from '../theme';

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

  // New leave form state
  const today = new Date().toISOString().slice(0, 10);
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
      await fetchLeaves();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit leave.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteLeave(item: LeaveRow) {
    Alert.alert('Delete Leave', `Delete leave on ${item.leave_date}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteLeave(item.id);
            await fetchLeaves();
          } catch (err) {
            Alert.alert('Error', err instanceof Error ? err.message : 'Failed to delete leave.');
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
            accessibilityLabel={showAddForm ? 'Cancel add leave' : 'Request leave'}
            accessibilityRole="button"
            onPress={() => {
              setShowAddForm(!showAddForm);
              setError(null);
            }}
            style={[styles.actionButton, showAddForm && styles.cancelButton]}
          >
            <Text style={styles.actionButtonText}>{showAddForm ? 'Cancel' : '+ Request Leave'}</Text>
          </Pressable>
        </View>
        <Text style={[styles.title, { color: palette.foreground }]}>Leaves & Absences</Text>
      </View>

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
            <TextInput
              accessibilityLabel="Leave Date"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setLeaveDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={palette.placeholder}
              style={[
                styles.input,
                { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground },
              ]}
              value={leaveDate}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: palette.foreground }]}>Reason / Remarks</Text>
            <TextInput
              accessibilityLabel="Leave Reason"
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

          <Pressable
            accessibilityLabel="Submit leave request"
            accessibilityRole="button"
            accessibilityState={{ busy: isSubmitting }}
            disabled={isSubmitting}
            onPress={handleCreateLeave}
            style={({ pressed }) => [styles.submitButton, pressed && styles.buttonPressed]}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.submitButtonText}>Submit Leave</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: palette.muted }]}>Loading leaves...</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={leaves}
          keyExtractor={(item, index) => item.id || String(index)}
          ListEmptyComponent={
            <View style={[styles.emptyCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <Text style={[styles.emptyText, { color: palette.muted }]}>No recorded leaves found.</Text>
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
            <View style={[styles.leafCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <View style={styles.leafHeader}>
                <Text style={[styles.leafDate, { color: palette.foreground }]}>{item.leave_date}</Text>
                <Pressable
                  accessibilityLabel={`Delete leave on ${item.leave_date}`}
                  accessibilityRole="button"
                  onPress={() => handleDeleteLeave(item)}
                  style={styles.deleteButton}
                >
                  <Text style={styles.deleteButtonText}>✕</Text>
                </Pressable>
              </View>
              <Text style={[styles.leafReason, { color: palette.muted }]}>{item.reason}</Text>
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
  leafCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  leafHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  leafDate: { fontSize: typography.body, fontWeight: '700' },
  deleteButton: { padding: spacing.xs },
  deleteButtonText: { color: colors.error, fontSize: 16, fontWeight: '700' },
  leafReason: { fontSize: typography.caption, marginTop: spacing.xs },
});
