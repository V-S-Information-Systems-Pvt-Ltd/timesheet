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
import { colors, spacing, typography, borderRadius, shadows, useTheme } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { useSessionActions, useSessionSync } from '../auth/SessionProvider';
import type { GlobalReminderItem } from '../api/contracts';

interface GlobalReminderAdminScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function GlobalReminderAdminScreen({ isDarkMode: _isDarkMode, onBack }: GlobalReminderAdminScreenProps) {
  const palette = useTheme().palette;
  const { isOffline } = useSessionSync();
  const {
    listAllGlobalReminders,
    createAdminGlobalReminder,
    updateAdminGlobalReminder,
    deleteAdminGlobalReminder,
  } = useSessionActions();

  const [reminders, setReminders] = useState<GlobalReminderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [editingReminder, setEditingReminder] = useState<GlobalReminderItem | null>(null);
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
    if (isOffline) {
      Alert.alert('Offline', 'Cannot create alerts while offline.');
      return;
    }
    setEditingReminder(null);
    setMessage('');
    setRemindAt(new Date().toISOString().slice(0, 16));
    setModalError(null);
    setModalVisible(true);
  };

  const handleOpenEdit = (reminder: GlobalReminderItem) => {
    if (isOffline) {
      Alert.alert('Offline', 'Cannot edit alerts while offline.');
      return;
    }
    setEditingReminder(reminder);
    setMessage(reminder.message);
    setRemindAt(reminder.remind_at ? reminder.remind_at.slice(0, 16) : new Date().toISOString().slice(0, 16));
    setModalError(null);
    setModalVisible(true);
  };

  const handleModalSubmit = async () => {
    if (isOffline) {
      setModalError('Cannot submit changes while offline.');
      return;
    }
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
      if (editingReminder) {
        await updateAdminGlobalReminder(editingReminder.id, {
          message: message.trim(),
          remindAt: new Date(remindAt).toISOString(),
        });
      } else {
        await createAdminGlobalReminder({
          message: message.trim(),
          remindAt: new Date(remindAt).toISOString(),
        });
      }
      setModalVisible(false);
      setEditingReminder(null);
      await fetchData();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to save global reminder.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (reminder: GlobalReminderItem) => {
    if (isOffline) {
      Alert.alert('Offline', 'Cannot delete alerts while offline.');
      return;
    }
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
            disabled={isOffline}
            onPress={handleOpenCreate}
            style={[styles.headerActionBtn, isOffline && { opacity: 0.5 }, { backgroundColor: palette.primary }]}
          >
            <Icon color={palette.onPrimary} name="plus" size={16} />
            <Text style={[styles.headerActionText, { color: palette.onPrimary }]}>New Alert</Text>
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
            <ActivityIndicator color={palette.primary} size="large" />
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
                colors={[palette.primary]}
                onRefresh={onRefresh}
                refreshing={refreshing}
                tintColor={palette.primary}
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
                    <Text style={[styles.timeText, { color: palette.primary }]}>
                      {item.remind_at ? item.remind_at.slice(0, 16).replace('T', ' ') : ''}
                    </Text>
                  </View>
                  <View style={styles.cardActions}>
                    <PressableScale
                      accessibilityLabel={`Edit reminder: ${item.message}`}
                      accessibilityRole="button"
                      disabled={isOffline}
                      onPress={() => handleOpenEdit(item)}
                      style={[styles.iconButton, { backgroundColor: palette.badgeBg, marginRight: spacing.xs }, isOffline && { opacity: 0.5 }]}
                    >
                      <Icon color={palette.foreground} name="edit" size={16} />
                    </PressableScale>
                    <PressableScale
                      accessibilityLabel={`Delete reminder: ${item.message}`}
                      accessibilityRole="button"
                      disabled={isOffline}
                      onPress={() => handleDelete(item)}
                      style={[styles.iconButton, { backgroundColor: palette.badgeBg }, isOffline && { opacity: 0.5 }]}
                    >
                      <Icon color={colors.danger} name="trash" size={16} />
                    </PressableScale>
                  </View>
                </View>
              </View>
            )}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {/* Create / Edit Global Reminder Modal */}
      <Modal animationType="slide" transparent visible={modalVisible}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.modalTitle, { color: palette.foreground }]}>
              {editingReminder ? 'Edit Global Reminder' : 'Broadcast Global Reminder'}
            </Text>
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
                onPress={() => {
                  setModalVisible(false);
                  setEditingReminder(null);
                }}
                style={[styles.modalBtn, { backgroundColor: palette.badgeBg }]}
              >
                <Text style={[styles.modalBtnText, { color: palette.foreground }]}>Cancel</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel={editingReminder ? 'Save Reminder Changes' : 'Publish Reminder'}
                accessibilityRole="button"
                disabled={submitting || isOffline}
                onPress={handleModalSubmit}
                style={[styles.modalBtn, styles.primaryModalBtn, (submitting || isOffline) && { opacity: 0.5 }, { backgroundColor: palette.primary }]}
              >
                {submitting ? (
                  <ActivityIndicator color={palette.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.primaryModalBtnText, { color: palette.onPrimary }]}>
                    {editingReminder ? 'Save' : 'Publish'}
                  </Text>
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
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  headerActionText: {
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
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryModalBtn: {},
  modalBtnText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  primaryModalBtnText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
