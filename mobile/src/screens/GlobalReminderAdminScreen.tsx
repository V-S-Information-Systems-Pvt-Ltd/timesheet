import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { spacing, useTheme } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/EmptyState';
import { adminStyles } from '../components/adminStyles';
import { useModalBounds } from '../utils/modal-layout';
import { useSessionActions, useSessionSync } from '../auth/SessionProvider';
import type { GlobalReminderItem } from '../api/contracts';
import { formatLocalDateTime, parseLocalInputToIso } from '../utils/dates';

interface GlobalReminderAdminScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function GlobalReminderAdminScreen({ isDarkMode: _isDarkMode, onBack }: GlobalReminderAdminScreenProps) {
  const palette = useTheme().palette;
  const bounds = useModalBounds();
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
  const [remindAt, setRemindAt] = useState(() => formatLocalDateTime(new Date()));
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
    setRemindAt(formatLocalDateTime(new Date()));
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
    setRemindAt(reminder.remind_at ? formatLocalDateTime(new Date(reminder.remind_at)) : formatLocalDateTime(new Date()));
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
    const parsedRemindAt = parseLocalInputToIso(remindAt);
    if (!parsedRemindAt) {
      setModalError('Valid reminder date and time required (YYYY-MM-DDTHH:MM).');
      return;
    }

    setSubmitting(true);
    setModalError(null);
    try {
      if (editingReminder) {
        await updateAdminGlobalReminder(editingReminder.id, {
          message: message.trim(),
          remindAt: parsedRemindAt,
        });
      } else {
        await createAdminGlobalReminder({
          message: message.trim(),
          remindAt: parsedRemindAt,
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
      'Delete global reminder',
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

  const closeModal = () => {
    setModalVisible(false);
    setEditingReminder(null);
  };

  return (
    <View style={[adminStyles.container, { backgroundColor: palette.paper }]}>
      <ScreenHeader
        onBack={onBack}
        palette={palette}
        rightAction={
          <PressableScale
            accessibilityLabel="Create Global Reminder"
            accessibilityRole="button"
            disabled={isOffline}
            onPress={handleOpenCreate}
            style={[adminStyles.headerAction, isOffline && adminStyles.disabled, { backgroundColor: palette.primary }]}
          >
            <Text style={[adminStyles.headerActionText, { color: palette.onPrimary }]}>New reminder</Text>
          </PressableScale>
        }
        subtitle="Broadcast company-wide reminder alerts"
        title="Global reminders"
      />

      <View style={[adminStyles.sheet, { backgroundColor: palette.sheet }]}>
        {errorMessage ? (
          <View accessibilityRole="alert" style={[adminStyles.errorBanner, { backgroundColor: palette.errorBoxBg }]}>
            <Text style={[adminStyles.errorBannerText, { color: palette.error }]}>{errorMessage}</Text>
          </View>
        ) : null}

        {loading && !refreshing ? (
          <View style={adminStyles.centered}>
            <ActivityIndicator color={palette.primary} size="large" />
            <Text style={[adminStyles.muted, { color: palette.muted }]}>Loading global reminders…</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={adminStyles.listContent}
            data={reminders}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <EmptyState
                icon="bell"
                message="No global reminders yet. Add one to alert every member of the workspace."
                palette={palette}
              />
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
                style={[adminStyles.row, { borderBottomColor: palette.hairline }]}
              >
                <View style={adminStyles.rowMain}>
                  <Text style={[adminStyles.rowTitle, { color: palette.foreground }]}>{item.message}</Text>
                  <Text style={[adminStyles.rowMeta, adminStyles.numeral, { color: palette.muted }]}>
                    {item.remind_at ? formatLocalDateTime(new Date(item.remind_at)).replace('T', ' ') : ''}
                  </Text>
                </View>
                <View style={adminStyles.rowActions}>
                  <PressableScale
                    accessibilityLabel={`Edit reminder: ${item.message}`}
                    accessibilityRole="button"
                    disabled={isOffline}
                    onPress={() => handleOpenEdit(item)}
                    style={[adminStyles.iconButton, isOffline && adminStyles.disabled]}
                  >
                    <Icon color={palette.primary} name="edit" size={18} />
                  </PressableScale>
                  <PressableScale
                    accessibilityLabel={`Delete reminder: ${item.message}`}
                    accessibilityRole="button"
                    disabled={isOffline}
                    onPress={() => handleDelete(item)}
                    style={[adminStyles.iconButton, isOffline && adminStyles.disabled]}
                  >
                    <Icon color={palette.error} name="trash" size={18} />
                  </PressableScale>
                </View>
              </View>
            )}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={closeModal}>
        <View style={[adminStyles.modalOverlay, bounds]}>
          <ScrollView
            contentContainerStyle={[adminStyles.modalCard, { backgroundColor: palette.sheet, borderColor: palette.hairline }]}
            keyboardShouldPersistTaps="handled"
            style={adminStyles.modalScroll}
          >
            <Text style={[adminStyles.modalTitle, { color: palette.foreground }]}>
              {editingReminder ? 'Edit global reminder' : 'New global reminder'}
            </Text>
            {modalError ? <Text style={[adminStyles.modalError, { color: palette.error }]}>{modalError}</Text> : null}

            <Text style={[adminStyles.label, { color: palette.muted }]}>Message</Text>
            <TextInput
              accessibilityLabel="Reminder Message"
              multiline
              numberOfLines={3}
              onChangeText={setMessage}
              placeholder="e.g. Please submit all pending timesheets by 5 PM today."
              placeholderTextColor={palette.placeholder}
              style={[adminStyles.input, styles.multilineInput, { borderColor: palette.controlBorder, color: palette.foreground }]}
              value={message}
            />

            <Text style={[adminStyles.label, { color: palette.muted }]}>Scheduled time (YYYY-MM-DDTHH:MM)</Text>
            <TextInput
              accessibilityLabel="Scheduled Time"
              onChangeText={setRemindAt}
              placeholder="YYYY-MM-DDTHH:MM"
              placeholderTextColor={palette.placeholder}
              style={[adminStyles.input, adminStyles.numeral, { borderColor: palette.controlBorder, color: palette.foreground }]}
              value={remindAt}
            />

            <View style={adminStyles.modalActions}>
              <PressableScale
                accessibilityLabel="Cancel Reminder"
                accessibilityRole="button"
                onPress={closeModal}
                style={[adminStyles.btn, adminStyles.btnOutline, { borderColor: palette.controlBorder }]}
              >
                <Text style={[adminStyles.btnText, { color: palette.foreground }]}>Cancel</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel={editingReminder ? 'Save Reminder Changes' : 'Publish Reminder'}
                accessibilityRole="button"
                disabled={submitting || isOffline}
                onPress={handleModalSubmit}
                style={[adminStyles.btn, (submitting || isOffline) && adminStyles.disabled, { backgroundColor: palette.primary }]}
              >
                {submitting ? (
                  <ActivityIndicator color={palette.onPrimary} size="small" />
                ) : (
                  <Text style={[adminStyles.btnText, { color: palette.onPrimary }]}>
                    {editingReminder ? 'Save' : 'Publish'}
                  </Text>
                )}
              </PressableScale>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  multilineInput: { minHeight: 88, paddingTop: spacing.sm, textAlignVertical: 'top' },
});
