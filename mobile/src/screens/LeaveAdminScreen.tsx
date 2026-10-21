import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { Chip } from '../components/Chip';
import { EmptyState } from '../components/EmptyState';
import { adminStyles } from '../components/adminStyles';
import { useModalBounds } from '../utils/modal-layout';
import { formatDatePreview, formatDateShort, todayISO } from '../utils/dates';
import { useSessionActions, useSessionSync } from '../auth/SessionProvider';
import type { LeaveRow, PersonProfile } from '../api/contracts';

interface LeaveAdminScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function LeaveAdminScreen({ isDarkMode: _isDarkMode, onBack }: LeaveAdminScreenProps) {
  const palette = useTheme().palette;
  const bounds = useModalBounds();
  const { isOffline } = useSessionSync();
  const { listAdminLeaves, createAdminLeave, deleteAdminLeave, listAdminUsers } = useSessionActions();

  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [users, setUsers] = useState<PersonProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Create Modal State
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [leaveDate, setLeaveDate] = useState(todayISO());
  const [leaveReason, setLeaveReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setErrorMessage(null);
      let userWarning: string | null = null;
      const [leaveList, userList] = await Promise.all([
        listAdminLeaves(),
        listAdminUsers().catch((err: unknown) => {
          userWarning = err instanceof Error ? `Team list could not be loaded: ${err.message}` : 'Team list could not be loaded.';
          return [];
        }),
      ]);
      setLeaves(leaveList);
      setUsers(userList);
      if (userWarning) setErrorMessage(userWarning);
      if (userList.length > 0 && !selectedUserId) {
        setSelectedUserId(userList[0].id);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load leave records.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [listAdminLeaves, listAdminUsers, selectedUserId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const filteredLeaves = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leaves;
    return leaves.filter((l) => {
      const user = usersById.get(l.user_id);
      const userName = user ? (user.name || user.email).toLowerCase() : '';
      return (
        userName.includes(q) ||
        (l.reason || '').toLowerCase().includes(q) ||
        l.leave_date.includes(q)
      );
    });
  }, [leaves, search, usersById]);

  const handleOpenCreate = () => {
    if (isOffline) {
      Alert.alert('Offline', 'Cannot record leave while offline.');
      return;
    }
    if (users.length > 0 && !selectedUserId) {
      setSelectedUserId(users[0].id);
    }
    setLeaveDate(todayISO());
    setLeaveReason('');
    setModalError(null);
    setCreateModalVisible(true);
  };

  const handleCreateSubmit = async () => {
    if (isOffline) {
      setModalError('Cannot record leave while offline.');
      return;
    }
    if (!selectedUserId) {
      setModalError('Please select a user.');
      return;
    }
    if (!leaveDate.trim()) {
      setModalError('Please specify a leave date.');
      return;
    }

    setSubmitting(true);
    setModalError(null);
    try {
      await createAdminLeave({
        userId: selectedUserId,
        date: leaveDate.trim(),
        reason: leaveReason.trim() || undefined,
      });
      setCreateModalVisible(false);
      await fetchData();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to record leave marker.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (leave: LeaveRow) => {
    if (isOffline) {
      Alert.alert('Offline', 'Cannot remove leave while offline.');
      return;
    }
    const user = usersById.get(leave.user_id);
    const name = user ? user.name || user.email : 'user';
    Alert.alert(
      'Remove leave marker',
      `Are you sure you want to remove the leave marker on ${formatDatePreview(
        leave.leave_date
      )} for ${name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setErrorMessage(null);
              await deleteAdminLeave(leave.id);
              await fetchData();
            } catch (err) {
              setErrorMessage(err instanceof Error ? err.message : 'Failed to remove leave marker.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[adminStyles.container, { backgroundColor: palette.paper }]}>
      <ScreenHeader
        onBack={onBack}
        palette={palette}
        rightAction={
          <PressableScale
            accessibilityLabel="Add Leave Marker"
            accessibilityRole="button"
            disabled={isOffline}
            onPress={handleOpenCreate}
            style={[adminStyles.headerAction, isOffline && adminStyles.disabled, { backgroundColor: palette.primary }]}
          >
            <Text style={[adminStyles.headerActionText, { color: palette.onPrimary }]}>Record leave</Text>
          </PressableScale>
        }
        subtitle="Manage global and team member leave records"
        title="Leave administration"
      />

      <View style={[adminStyles.sheet, { backgroundColor: palette.sheet }]}>
        {errorMessage ? (
          <View accessibilityRole="alert" style={[adminStyles.errorBanner, { backgroundColor: palette.errorBoxBg }]}>
            <Text style={[adminStyles.errorBannerText, { color: palette.error }]}>{errorMessage}</Text>
          </View>
        ) : null}

        <TextInput
          accessibilityLabel="Search leaves"
          onChangeText={setSearch}
          placeholder="Search by name, date (YYYY-MM-DD) or reason"
          placeholderTextColor={palette.placeholder}
          style={[adminStyles.searchInput, { borderColor: palette.controlBorder, color: palette.foreground }]}
          value={search}
        />

        {loading && !refreshing ? (
          <View style={adminStyles.centered}>
            <ActivityIndicator color={palette.primary} size="large" />
            <Text style={[adminStyles.muted, { color: palette.muted }]}>Loading leave records…</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={adminStyles.listContent}
            data={filteredLeaves}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <EmptyState
                icon="calendar"
                message={search ? 'No leave records match that search. Try a different name, date or reason.' : 'No leave recorded yet. Record leave on behalf of a team member.'}
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
            renderItem={({ item }) => {
              const user = usersById.get(item.user_id);
              const displayName = user ? user.name || user.email : `User: ${item.user_id}`;
              return (
                <View
                  accessibilityLabel={`Leave for ${displayName} on ${formatDateShort(item.leave_date)}`}
                  style={[adminStyles.row, { borderBottomColor: palette.hairline }]}
                >
                  <View style={adminStyles.rowMain}>
                    <Text style={[adminStyles.rowTitle, { color: palette.foreground }]}>{displayName}</Text>
                    <Text style={[adminStyles.rowMeta, adminStyles.numeral, { color: palette.leave }]}>
                      {formatDateShort(item.leave_date)}
                    </Text>
                    {item.reason ? (
                      <Text style={[adminStyles.rowMeta, { color: palette.muted }]}>{item.reason}</Text>
                    ) : null}
                  </View>
                  <PressableScale
                    accessibilityLabel={`Delete leave for ${displayName}`}
                    accessibilityRole="button"
                    disabled={isOffline}
                    onPress={() => handleDelete(item)}
                    style={[adminStyles.iconButton, isOffline && adminStyles.disabled]}
                  >
                    <Icon color={palette.error} name="trash" size={18} />
                  </PressableScale>
                </View>
              );
            }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      <Modal animationType="slide" transparent visible={createModalVisible} onRequestClose={() => setCreateModalVisible(false)}>
        <View style={[adminStyles.modalOverlay, bounds]}>
          <ScrollView
            contentContainerStyle={[adminStyles.modalCard, { backgroundColor: palette.sheet, borderColor: palette.hairline }]}
            keyboardShouldPersistTaps="handled"
            style={adminStyles.modalScroll}
          >
            <Text style={[adminStyles.modalTitle, { color: palette.foreground }]}>Record member leave</Text>
            {modalError ? <Text style={[adminStyles.modalError, { color: palette.error }]}>{modalError}</Text> : null}

            <Text style={[adminStyles.label, { color: palette.muted }]}>Member</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={adminStyles.chipRow}>
                {users.map((u) => (
                  <Chip
                    key={u.id}
                    accessibilityLabel={`Pick member ${u.name || u.email}`}
                    active={selectedUserId === u.id}
                    label={u.name || u.email}
                    onPress={() => setSelectedUserId(u.id)}
                    palette={palette}
                  />
                ))}
              </View>
            </ScrollView>

            <Text style={[adminStyles.label, { color: palette.muted }]}>Date (YYYY-MM-DD)</Text>
            <TextInput
              accessibilityLabel="Leave Date"
              onChangeText={setLeaveDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={palette.placeholder}
              style={[adminStyles.input, adminStyles.numeral, { borderColor: palette.controlBorder, color: palette.foreground }]}
              value={leaveDate}
            />

            <Text style={[adminStyles.label, { color: palette.muted }]}>Reason or notes</Text>
            <TextInput
              accessibilityLabel="Leave Reason"
              onChangeText={setLeaveReason}
              placeholder="e.g. Vacation, Medical Leave"
              placeholderTextColor={palette.placeholder}
              style={[adminStyles.input, { borderColor: palette.controlBorder, color: palette.foreground }]}
              value={leaveReason}
            />

            <View style={adminStyles.modalActions}>
              <PressableScale
                accessibilityLabel="Cancel Leave"
                accessibilityRole="button"
                onPress={() => setCreateModalVisible(false)}
                style={[adminStyles.btn, adminStyles.btnOutline, { borderColor: palette.controlBorder }]}
              >
                <Text style={[adminStyles.btnText, { color: palette.foreground }]}>Cancel</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Save Leave"
                accessibilityRole="button"
                disabled={submitting}
                onPress={handleCreateSubmit}
                style={[adminStyles.btn, { backgroundColor: palette.primary }]}
              >
                {submitting ? (
                  <ActivityIndicator color={palette.onPrimary} size="small" />
                ) : (
                  <Text style={[adminStyles.btnText, { color: palette.onPrimary }]}>Record</Text>
                )}
              </PressableScale>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
