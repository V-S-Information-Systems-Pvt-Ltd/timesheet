import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { useSessionActions } from '../auth/SessionProvider';
import type { ActivityTypeAdminItem } from '../api/contracts';

interface ActivityTypeAdminScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function ActivityTypeAdminScreen({ isDarkMode, onBack }: ActivityTypeAdminScreenProps) {
  const palette = getPalette(isDarkMode);
  const {
    listAdminActivityTypes,
    createAdminActivityType,
    updateAdminActivityType,
    deleteAdminActivityType,
  } = useSessionActions();

  const [activities, setActivities] = useState<ActivityTypeAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Create Modal State
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createTelegramNo, setCreateTelegramNo] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingActivity, setEditingActivity] = useState<ActivityTypeAdminItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editTelegramNo, setEditTelegramNo] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const fetchActivities = useCallback(async () => {
    try {
      setErrorMessage(null);
      const data = await listAdminActivityTypes();
      setActivities(data);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load activity types.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [listAdminActivityTypes]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchActivities();
  }, [fetchActivities]);

  const filteredActivities = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter((a) => a.name.toLowerCase().includes(q));
  }, [activities, search]);

  const handleOpenCreate = () => {
    setCreateName('');
    setCreateTelegramNo('');
    setCreateError(null);
    setCreateModalVisible(true);
  };

  const handleCreateSubmit = async () => {
    const trimmedName = createName.trim();
    if (!trimmedName) {
      setCreateError('Activity type name is required.');
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const parsedTelegram = createTelegramNo.trim() ? parseInt(createTelegramNo.trim(), 10) : null;
      if (createTelegramNo.trim() && (isNaN(parsedTelegram!) || parsedTelegram! <= 0)) {
        setCreateError('Telegram bot number must be a positive whole number.');
        setCreateSubmitting(false);
        return;
      }
      await createAdminActivityType({
        name: trimmedName,
        telegramNo: parsedTelegram,
      });
      setCreateModalVisible(false);
      await fetchActivities();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create activity type.');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleOpenEdit = useCallback((activity: ActivityTypeAdminItem) => {
    setEditingActivity(activity);
    setEditName(activity.name);
    setEditIsActive(activity.is_active !== false);
    setEditTelegramNo(activity.telegram_no ? String(activity.telegram_no) : '');
    setEditError(null);
    setEditModalVisible(true);
  }, []);

  const handleEditSubmit = async () => {
    if (!editingActivity) return;
    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditError('Activity type name is required.');
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    try {
      const parsedTelegram = editTelegramNo.trim() ? parseInt(editTelegramNo.trim(), 10) : null;
      if (editTelegramNo.trim() && (isNaN(parsedTelegram!) || parsedTelegram! <= 0)) {
        setEditError('Telegram bot number must be a positive whole number.');
        setEditSubmitting(false);
        return;
      }
      await updateAdminActivityType(editingActivity.id, {
        name: trimmedName,
        isActive: editIsActive,
        telegramNo: parsedTelegram,
      });
      setEditModalVisible(false);
      await fetchActivities();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update activity type.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleToggleActive = useCallback(
    async (activity: ActivityTypeAdminItem) => {
      try {
        setErrorMessage(null);
        await updateAdminActivityType(activity.id, {
          isActive: activity.is_active === false,
        });
        await fetchActivities();
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to toggle status.');
      }
    },
    [fetchActivities, updateAdminActivityType]
  );

  const handleDelete = useCallback(
    (activity: ActivityTypeAdminItem) => {
      Alert.alert(
        'Delete Activity Type',
        `Are you sure you want to delete "${activity.name}"? Existing entries will have their activity set to unclassified.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                setErrorMessage(null);
                await deleteAdminActivityType(activity.id);
                await fetchActivities();
              } catch (err) {
                setErrorMessage(err instanceof Error ? err.message : 'Failed to delete activity type.');
              }
            },
          },
        ]
      );
    },
    [deleteAdminActivityType, fetchActivities]
  );

  const renderActivityItem = useCallback(
    ({ item }: { item: ActivityTypeAdminItem }) => {
      const isActive = item.is_active !== false;

      return (
        <View
          accessibilityLabel={`Activity Type: ${item.name}`}
          style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}
        >
          <View style={styles.cardHeader}>
            <View style={styles.cardInfo}>
              <Text style={[styles.activityName, { color: palette.foreground }]}>{item.name}</Text>
              <View style={styles.metaRow}>
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: isActive ? '#ECFDF5' : palette.badgeBg,
                      borderColor: isActive ? '#A7F3D0' : palette.border,
                    },
                  ]}
                >
                  <Text style={[styles.badgeText, { color: isActive ? '#059669' : palette.muted }]}>
                    {isActive ? 'ACTIVE' : 'INACTIVE'}
                  </Text>
                </View>
                {item.telegram_no ? (
                  <View style={[styles.badge, { backgroundColor: palette.badgeBg, borderColor: palette.border }]}>
                    <Text style={[styles.badgeText, { color: colors.primary }]}>Bot #{item.telegram_no}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View style={styles.cardActions}>
              <PressableScale
                accessibilityLabel={`${isActive ? 'Deactivate' : 'Activate'} ${item.name}`}
                accessibilityRole="button"
                onPress={() => handleToggleActive(item)}
                style={[styles.iconButton, { backgroundColor: palette.badgeBg }]}
              >
                <Icon color={isActive ? '#059669' : palette.muted} name="check" size={16} />
              </PressableScale>
              <PressableScale
                accessibilityLabel={`Edit ${item.name}`}
                accessibilityRole="button"
                onPress={() => handleOpenEdit(item)}
                style={[styles.iconButton, { backgroundColor: palette.badgeBg }]}
              >
                <Icon color={colors.primary} name="edit" size={16} />
              </PressableScale>
              <PressableScale
                accessibilityLabel={`Delete ${item.name}`}
                accessibilityRole="button"
                onPress={() => handleDelete(item)}
                style={[styles.iconButton, { backgroundColor: palette.badgeBg }]}
              >
                <Icon color={colors.danger} name="trash" size={16} />
              </PressableScale>
            </View>
          </View>
        </View>
      );
    },
    [handleDelete, handleOpenEdit, handleToggleActive, palette]
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScreenHeader
        onBack={onBack}
        palette={palette}
        rightAction={
          <PressableScale
            accessibilityLabel="Create Activity Type"
            accessibilityRole="button"
            onPress={handleOpenCreate}
            style={styles.headerActionBtn}
          >
            <Icon color={colors.onPrimary} name="plus" size={16} />
            <Text style={styles.headerActionText}>New</Text>
          </PressableScale>
        }
        subtitle="Manage loggable activity categories"
        title="Activity Types"
      />

      <View style={styles.content}>
        {/* Error Banner */}
        {errorMessage ? (
          <View style={styles.errorBanner}>
            <Icon color={colors.danger} name="alert-circle" size={18} />
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        ) : null}

        {/* Search Bar */}
        <View
          style={[
            styles.searchContainer,
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}
        >
          <Icon color={palette.muted} name="search" size={18} />
          <TextInput
            accessibilityLabel="Search activity types"
            onChangeText={setSearch}
            placeholder="Search activity types…"
            placeholderTextColor={palette.placeholder}
            style={[styles.searchInput, { color: palette.foreground }]}
            value={search}
          />
          {search ? (
            <PressableScale
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              onPress={() => setSearch('')}
            >
              <Icon color={palette.muted} name="close" size={16} />
            </PressableScale>
          ) : null}
        </View>

        {/* Activity List */}
        {loading && !refreshing ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[styles.loadingText, { color: palette.muted }]}>Loading activity types…</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={filteredActivities}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Icon color={palette.muted} name="tag" size={40} />
                <Text style={[styles.emptyTitle, { color: palette.foreground }]}>No activity types found</Text>
                <Text style={[styles.emptySubtitle, { color: palette.muted }]}>
                  {search ? 'Try a different search query.' : 'Create your first activity type using the + button.'}
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
            renderItem={renderActivityItem}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {/* Create Activity Type Modal */}
      <Modal animationType="slide" transparent visible={createModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.modalTitle, { color: palette.foreground }]}>New Activity Type</Text>
            {createError ? <Text style={styles.modalError}>{createError}</Text> : null}

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Activity Name *</Text>
            <TextInput
              accessibilityLabel="Activity Type Name"
              onChangeText={setCreateName}
              placeholder="e.g. Code Review"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={createName}
            />

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Telegram Bot Number (Optional)</Text>
            <TextInput
              accessibilityLabel="Telegram Bot Number"
              keyboardType="numeric"
              onChangeText={setCreateTelegramNo}
              placeholder="e.g. 1"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={createTelegramNo}
            />

            <View style={styles.modalActions}>
              <PressableScale
                accessibilityLabel="Cancel"
                accessibilityRole="button"
                onPress={() => setCreateModalVisible(false)}
                style={[styles.modalBtn, { backgroundColor: palette.badgeBg }]}
              >
                <Text style={[styles.modalBtnText, { color: palette.foreground }]}>Cancel</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Save Activity Type"
                accessibilityRole="button"
                disabled={createSubmitting}
                onPress={handleCreateSubmit}
                style={[styles.modalBtn, { backgroundColor: colors.primary }]}
              >
                {createSubmitting ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: colors.onPrimary }]}>Create</Text>
                )}
              </PressableScale>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Activity Type Modal */}
      <Modal animationType="slide" transparent visible={editModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.modalTitle, { color: palette.foreground }]}>Edit Activity Type</Text>
            {editError ? <Text style={styles.modalError}>{editError}</Text> : null}

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Activity Name *</Text>
            <TextInput
              accessibilityLabel="Edit Activity Type Name"
              onChangeText={setEditName}
              placeholder="e.g. Code Review"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={editName}
            />

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Telegram Bot Number (Optional)</Text>
            <TextInput
              accessibilityLabel="Edit Telegram Bot Number"
              keyboardType="numeric"
              onChangeText={setEditTelegramNo}
              placeholder="e.g. 1"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={editTelegramNo}
            />

            <View style={styles.switchRow}>
              <Text style={[styles.switchLabel, { color: palette.foreground }]}>Active Status</Text>
              <Switch
                accessibilityLabel="Toggle Active Status"
                onValueChange={setEditIsActive}
                thumbColor={editIsActive ? colors.primary : '#ccc'}
                trackColor={{ false: '#767577', true: palette.badgeBg }}
                value={editIsActive}
              />
            </View>

            <View style={styles.modalActions}>
              <PressableScale
                accessibilityLabel="Cancel Edit"
                accessibilityRole="button"
                onPress={() => setEditModalVisible(false)}
                style={[styles.modalBtn, { backgroundColor: palette.badgeBg }]}
              >
                <Text style={[styles.modalBtnText, { color: palette.foreground }]}>Cancel</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Update Activity Type"
                accessibilityRole="button"
                disabled={editSubmitting}
                onPress={handleEditSubmit}
                style={[styles.modalBtn, { backgroundColor: colors.primary }]}
              >
                {editSubmitting ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: colors.onPrimary }]}>Save</Text>
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
    justifyContent: 'space-between',
  },
  cardInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  activityName: {
    fontSize: typography.body,
    fontWeight: '700',
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  badge: {
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.xs,
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
    fontWeight: '500',
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
    marginTop: spacing.xs,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.body,
    marginBottom: spacing.sm,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: spacing.sm,
  },
  switchLabel: {
    fontSize: typography.body,
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
