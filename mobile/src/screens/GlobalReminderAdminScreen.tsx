import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { useSessionActions } from '../auth/SessionProvider';
import type { GlobalReminderItem } from '../api/contracts';

interface GlobalReminderAdminScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function GlobalReminderAdminScreen({ isDarkMode, onBack }: GlobalReminderAdminScreenProps) {
  const palette = getPalette(isDarkMode);
  const { listAllGlobalReminders, createAdminGlobalReminder, deleteAdminGlobalReminder } = useSessionActions();

  const [reminders, setReminders] = useState<GlobalReminderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Create Modal State
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [remindAt, setRemindAt] = useState(new Date().toISOString().slice(0, 16));
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setErrorMessage(null);
      const data = await listAllGlobalReminders();
      setReminders(data);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load global reminders.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [listAllGlobalReminders]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const handleOpenCreate = () => {
    setMessage('');
    setRemindAt(new Date().toISOString().slice(0, 16));
    setModalError(null);
    setCreateModalVisible(true);
  };

  const handleCreateSubmit = async () => {
    if (!message.trim()) {
      setModalError('Reminder message is required.');
      return;
    }
    if (!remindAt.trim() || Number.isNaN(new Date(remindAt).getTime())) {
      setModalError('Valid reminder date and time required (YYYY-MM-DDTHH:MM).');
      return;
    }

    setSubmitting(true);
    setModalError(null);
    try {
      await createAdminGlobalReminder({
        message: message.trim(),
        remindAt: new Date(remindAt).toISOString(),
      });
      setCreateModalVisible(false);
      await fetchData();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to create global reminder.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (reminder: GlobalReminderItem) => {
    Alert.alert(
      'Delete Global Reminder',
      `Are you sure you want to delete this company-wide reminder?\n\n"${reminder.message}"`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setErrorMessage(null);
              await deleteAdminGlobalReminder(reminder.id);
              await fetchData();
            } catch (err) {
              setErrorMessage(err instanceof Error ? err.message : 'Failed to delete reminder.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScreenHeader
        onBack={onBack}
        palette={palette}
        rightAction={
          <PressableScale
            accessibilityLabel="Create Global Reminder"
            accessibilityRole="button"
            onPress={handleOpenCreate}
            style={styles.headerActionBtn}
          >
            <Icon color={colors.onPrimary} name="plus" size={16} />
            <Text style={styles.headerActionText}>New Alert</Text>
          </PressableScale>
        }
        subtitle="Broadcast company-wide reminder alerts"
        title="Global Reminders"
      />

      <View style={styles.content}>
        {errorMessage ? (
          <View style={styles.errorBanner}>
            <Icon color={colors.danger} name="alert-circle" size={18} />
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        ) : null}

        {loading && !refreshing ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[styles.loadingText, { color: palette.muted }]}>Loading global reminders…</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={reminders}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Icon color={palette.muted} name="bell" size={40} />
                <Text style={[styles.emptyTitle, { color: palette.foreground }]}>No global reminders</Text>
                <Text style={[styles.emptySubtitle, { color: palette.muted }]}>
                  Broadcast alerts to all members across the workspace.
                </Text>
              </View>
            }
            refreshControl={
              <RefreshControl
                colors={[colors.primary]}
                onRefresh={onRefresh}
                refreshing={refreshing}
                tintColor={colors.primary}
              />
            }
            renderItem={({ item }) => (
              <View
                accessibilityLabel={`Global Reminder: ${item.message}`}
                style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.cardInfo}>
                    <Text style={[styles.messageText, { color: palette.foreground }]}>{item.message}</Text>
                    <Text style={[styles.timeText, { color: colors.primary }]}>
                      {item.remind_at ? item.remind_at.slice(0, 16).replace('T', ' ') : ''}
                    </Text>
                  </View>
                  <PressableScale
                    accessibilityLabel={`Delete reminder: ${item.message}`}
                    accessibilityRole="button"
                    onPress={() => handleDelete(item)}
                    style={[styles.iconButton, { backgroundColor: palette.badgeBg }]}
                  >
                    <Icon color={colors.danger} name="trash" size={16} />
                  </PressableScale>
                </View>
              </View>
            )}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {/* Create Global Reminder Modal */}
      <Modal animationType="slide" transparent visible={createModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.modalTitle, { color: palette.foreground }]}>Broadcast Global Reminder</Text>
            {modalError ? <Text style={styles.modalError}>{modalError}</Text> : null}

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Reminder Message *</Text>
            <TextInput
              accessibilityLabel="Reminder Message"
              multiline
              numberOfLines={3}
              onChangeText={setMessage}
              placeholder="e.g. Please submit all pending timesheets by 5 PM today."
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, styles.multilineInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={message}
            />

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Scheduled Time * (YYYY-MM-DDTHH:MM)</Text>
            <TextInput
              accessibilityLabel="Scheduled Time"
              onChangeText={setRemindAt}
              placeholder="YYYY-MM-DDTHH:MM"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={remindAt}
            />

            <View style={styles.modalActions}>
              <PressableScale
                accessibilityLabel="Cancel Reminder"
                accessibilityRole="button"
                onPress={() => setCreateModalVisible(false)}
                style={[styles.modalBtn, { backgroundColor: palette.badgeBg }]}
              >
                <Text style={[styles.modalBtnText, { color: palette.foreground }]}>Cancel</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Publish Alert"
                accessibilityRole="button"
                disabled={submitting}
                onPress={handleCreateSubmit}
                style={[styles.modalBtn, { backgroundColor: colors.primary }]}
              >
                {submitting ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: colors.onPrimary }]}>Broadcast</Text>
                )}
              </PressableScale>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  headerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  headerActionText: {
    color: colors.onPrimary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  errorBannerText: {
    color: colors.danger,
    fontSize: typography.caption,
    fontWeight: '600',
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  card: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    ...shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  messageText: {
    fontSize: typography.body,
    fontWeight: '600',
    lineHeight: 20,
  },
  timeText: {
    fontSize: typography.caption,
    fontWeight: '600',
    marginTop: 4,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: typography.caption,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.xs,
  },
  emptyTitle: {
    fontSize: typography.title,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  emptySubtitle: {
    fontSize: typography.caption,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    ...shadows.md,
  },
  modalTitle: {
    fontSize: typography.title,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  modalError: {
    color: colors.danger,
    fontSize: typography.caption,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  inputLabel: {
    fontSize: typography.caption,
    fontWeight: '600',
    marginBottom: 4,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.body,
    marginBottom: spacing.sm,
  },
  multilineInput: {
    height: 70,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  modalBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
