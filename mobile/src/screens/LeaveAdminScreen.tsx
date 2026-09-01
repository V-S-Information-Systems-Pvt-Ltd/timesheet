import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { colors, spacing, typography, borderRadius, shadows, useScreenPalette } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { useSessionActions, useSessionSync } from '../auth/SessionProvider';
import type { LeaveRow, PersonProfile } from '../api/contracts';

interface LeaveAdminScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function LeaveAdminScreen({ isDarkMode, onBack }: LeaveAdminScreenProps) {
  const palette = useScreenPalette(isDarkMode);
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
  const [leaveDate, setLeaveDate] = useState(new Date().toISOString().slice(0, 10));
  const [leaveReason, setLeaveReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setErrorMessage(null);
      const [leaveList, userList] = await Promise.all([
        listAdminLeaves(),
        listAdminUsers().catch(() => []),
      ]);
      setLeaves(leaveList);
      setUsers(userList);
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
    setLeaveDate(new Date().toISOString().slice(0, 10));
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
      'Remove Leave Marker',
      `Are you sure you want to remove the leave marker on ${leave.leave_date} for ${name}?`,
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
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScreenHeader
        onBack={onBack}
        palette={palette}
        rightAction={
          <PressableScale
            accessibilityLabel="Add Leave Marker"
            accessibilityRole="button"
            disabled={isOffline}
            onPress={handleOpenCreate}
            style={[styles.headerActionBtn, isOffline && { opacity: 0.5 }, { backgroundColor: palette.primary }]}
          >
            <Icon color={palette.onPrimary} name="plus" size={16} />
            <Text style={[styles.headerActionText, { color: palette.onPrimary }]}>Record Leave</Text>
          </PressableScale>
        }
        subtitle="Manage global and team member leave records"
        title="Leave Administration"
      />

      <View style={styles.content}>
        {errorMessage ? (
          <View style={styles.errorBanner}>
            <Icon color={colors.danger} name="alert-circle" size={18} />
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        ) : null}

        {/* Search */}
        <View style={[styles.searchContainer, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Icon color={palette.muted} name="search" size={18} />
          <TextInput
            accessibilityLabel="Search leaves"
            onChangeText={setSearch}
            placeholder="Search by name, date (YYYY-MM-DD), or reason…"
            placeholderTextColor={palette.placeholder}
            style={[styles.searchInput, { color: palette.foreground }]}
            value={search}
          />
          {search ? (
            <PressableScale accessibilityLabel="Clear search" accessibilityRole="button" onPress={() => setSearch('')}>
              <Icon color={palette.muted} name="close" size={16} />
            </PressableScale>
          ) : null}
        </View>

        {loading && !refreshing ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator color={palette.primary} size="large" />
            <Text style={[styles.loadingText, { color: palette.muted }]}>Loading leave records…</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={filteredLeaves}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Icon color={palette.muted} name="calendar" size={40} />
                <Text style={[styles.emptyTitle, { color: palette.foreground }]}>No leave records</Text>
                <Text style={[styles.emptySubtitle, { color: palette.muted }]}>
                  {search ? 'Try adjusting your search query.' : 'Record leaves on behalf of team members.'}
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
            renderItem={({ item }) => {
              const user = usersById.get(item.user_id);
              const displayName = user ? user.name || user.email : `User: ${item.user_id}`;
              return (
                <View
                  accessibilityLabel={`Leave for ${displayName} on ${item.leave_date}`}
                  style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.cardInfo}>
                      <Text style={[styles.userName, { color: palette.foreground }]}>{displayName}</Text>
                      <Text style={[styles.leaveDate, { color: palette.primary }]}>{item.leave_date}</Text>
                      {item.reason ? (
                        <Text style={[styles.leaveReason, { color: palette.muted }]}>{item.reason}</Text>
                      ) : null}
                    </View>
                    <PressableScale
                      accessibilityLabel={`Delete leave for ${displayName}`}
                      accessibilityRole="button"
                      disabled={isOffline}
                      onPress={() => handleDelete(item)}
                      style={[styles.iconButton, { backgroundColor: palette.badgeBg }, isOffline && { opacity: 0.5 }]}
                    >
                      <Icon color={colors.danger} name="trash" size={16} />
                    </PressableScale>
                  </View>
                </View>
              );
            }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {/* Record Leave Modal */}
      <Modal animationType="slide" transparent visible={createModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.modalTitle, { color: palette.foreground }]}>Record Member Leave</Text>
            {modalError ? <Text style={styles.modalError}>{modalError}</Text> : null}

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Select Member *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerScroll}>
              {users.map((u) => (
                <PressableScale
                  key={u.id}
                  accessibilityLabel={`Pick member ${u.name || u.email}`}
                  accessibilityRole="button"
                  onPress={() => setSelectedUserId(u.id)}
                  style={[
                    styles.pickerPill,
                    {
                      backgroundColor: selectedUserId === u.id ? palette.primary : palette.badgeBg,
                      borderColor: selectedUserId === u.id ? palette.primary : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.pickerPillText,
                      { color: selectedUserId === u.id ? palette.onPrimary : palette.foreground },
                    ]}
                  >
                    {u.name || u.email}
                  </Text>
                </PressableScale>
              ))}
            </ScrollView>

            <Text style={[styles.inputLabel, { color: palette.foreground, marginTop: spacing.sm }]}>Date * (YYYY-MM-DD)</Text>
            <TextInput
              accessibilityLabel="Leave Date"
              onChangeText={setLeaveDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={leaveDate}
            />

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Reason / Notes</Text>
            <TextInput
              accessibilityLabel="Leave Reason"
              onChangeText={setLeaveReason}
              placeholder="e.g. Vacation, Medical Leave"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={leaveReason}
            />

            <View style={styles.modalActions}>
              <PressableScale
                accessibilityLabel="Cancel Leave"
                accessibilityRole="button"
                onPress={() => setCreateModalVisible(false)}
                style={[styles.modalBtn, { backgroundColor: palette.badgeBg }]}
              >
                <Text style={[styles.modalBtnText, { color: palette.foreground }]}>Cancel</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Save Leave"
                accessibilityRole="button"
                disabled={submitting}
                onPress={handleCreateSubmit}
                style={[styles.modalBtn, { backgroundColor: palette.primary }]}
              >
                {submitting ? (
                  <ActivityIndicator color={palette.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: palette.onPrimary }]}>Record</Text>
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
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    height: 44,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.body,
    paddingVertical: 0,
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
  userName: {
    fontSize: typography.body,
    fontWeight: '700',
  },
  leaveDate: {
    fontSize: typography.caption,
    fontWeight: '600',
    marginTop: 2,
  },
  leaveReason: {
    fontSize: 12,
    marginTop: 2,
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
  pickerScroll: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  pickerPill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    marginRight: spacing.xs,
  },
  pickerPillText: {
    fontSize: typography.caption,
    fontWeight: '600',
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
