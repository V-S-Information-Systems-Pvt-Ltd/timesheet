import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { spacing, typography, useTheme } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/EmptyState';
import { adminStyles } from '../components/adminStyles';
import { useModalBounds } from '../utils/modal-layout';
import { useSessionActions, useSessionSync } from '../auth/SessionProvider';
import type { ActivityTypeAdminItem } from '../api/contracts';

interface ActivityTypeAdminScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function ActivityTypeAdminScreen({ isDarkMode: _isDarkMode, onBack }: ActivityTypeAdminScreenProps) {
  const palette = useTheme().palette;
  const bounds = useModalBounds();
  const { isOffline } = useSessionSync();
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
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingActivity, setEditingActivity] = useState<ActivityTypeAdminItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
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
    if (isOffline) {
      Alert.alert('Offline', 'Cannot create activity types while offline.');
      return;
    }
    setCreateName('');
    setCreateError(null);
    setCreateModalVisible(true);
  };

  const handleCreateSubmit = async () => {
    if (isOffline) {
      setCreateError('Cannot create activity types while offline.');
      return;
    }
    const trimmedName = createName.trim();
    if (!trimmedName) {
      setCreateError('Activity type name is required.');
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      await createAdminActivityType({
        name: trimmedName,
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
    if (isOffline) {
      Alert.alert('Offline', 'Cannot edit activity types while offline.');
      return;
    }
    setEditingActivity(activity);
    setEditName(activity.name);
    setEditIsActive(activity.is_active !== false);
    setEditError(null);
    setEditModalVisible(true);
  }, [isOffline]);

  const handleEditSubmit = async () => {
    if (isOffline) {
      setEditError('Cannot edit activity types while offline.');
      return;
    }
    if (!editingActivity) return;
    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditError('Activity type name is required.');
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    try {
      await updateAdminActivityType(editingActivity.id, {
        name: trimmedName,
        isActive: editIsActive,
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
      if (isOffline) {
        Alert.alert('Offline', 'Cannot change status while offline.');
        return;
      }
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
    [fetchActivities, isOffline, updateAdminActivityType]
  );

  const handleDelete = useCallback(
    (activity: ActivityTypeAdminItem) => {
      if (isOffline) {
        Alert.alert('Offline', 'Cannot delete activity types while offline.');
        return;
      }
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
    [deleteAdminActivityType, fetchActivities, isOffline]
  );

  const renderActivityItem = useCallback(
    ({ item }: { item: ActivityTypeAdminItem }) => {
      const isActive = item.is_active !== false;

      return (
        <View
          accessibilityLabel={`Activity Type: ${item.name}`}
          style={[adminStyles.row, { borderBottomColor: palette.hairline }]}
        >
          <View style={adminStyles.rowMain}>
            <Text style={[adminStyles.rowTitle, { color: palette.foreground }]}>{item.name}</Text>
            <View
              style={[
                adminStyles.pill,
                { backgroundColor: isActive ? palette.loggedTint : palette.missingTint, marginTop: spacing.xs },
              ]}
            >
              <Text style={[adminStyles.pillText, { color: isActive ? palette.loggedText : palette.missingText }]}>
                {isActive ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </View>
          <View style={adminStyles.rowActions}>
            <PressableScale
              accessibilityLabel={`${isActive ? 'Deactivate' : 'Activate'} ${item.name}`}
              accessibilityRole="button"
              disabled={isOffline}
              onPress={() => handleToggleActive(item)}
              style={[adminStyles.iconButton, isOffline && adminStyles.disabled]}
            >
              <Icon color={isActive ? palette.loggedText : palette.muted} name="check" size={18} />
            </PressableScale>
            <PressableScale
              accessibilityLabel={`Edit ${item.name}`}
              accessibilityRole="button"
              disabled={isOffline}
              onPress={() => handleOpenEdit(item)}
              style={[adminStyles.iconButton, isOffline && adminStyles.disabled]}
            >
              <Icon color={palette.primary} name="edit" size={18} />
            </PressableScale>
            <PressableScale
              accessibilityLabel={`Delete ${item.name}`}
              accessibilityRole="button"
              disabled={isOffline}
              onPress={() => handleDelete(item)}
              style={[adminStyles.iconButton, isOffline && adminStyles.disabled]}
            >
              <Icon color={palette.error} name="trash" size={18} />
            </PressableScale>
          </View>
        </View>
      );
    },
    [handleDelete, handleOpenEdit, handleToggleActive, isOffline, palette]
  );

  const renderModal = (cfg: {
    visible: boolean;
    onClose: () => void;
    title: string;
    error: string | null;
    nameLabel: string;
    name: string;
    setName: (v: string) => void;
    activeToggle?: { value: boolean; onChange: (v: boolean) => void };
    cancelLabel: string;
    submitLabel: string;
    submitText: string;
    submitting: boolean;
    onSubmit: () => void;
  }) => (
    <Modal animationType="slide" transparent visible={cfg.visible} onRequestClose={cfg.onClose}>
      <View style={[adminStyles.modalOverlay, bounds]}>
        <ScrollView
          contentContainerStyle={[adminStyles.modalCard, { backgroundColor: palette.sheet, borderColor: palette.hairline }]}
          keyboardShouldPersistTaps="handled"
          style={adminStyles.modalScroll}
        >
          <Text style={[adminStyles.modalTitle, { color: palette.foreground }]}>{cfg.title}</Text>
          {cfg.error ? <Text style={[adminStyles.modalError, { color: palette.error }]}>{cfg.error}</Text> : null}

          <Text style={[adminStyles.label, { color: palette.muted }]}>Activity name</Text>
          <TextInput
            accessibilityLabel={cfg.nameLabel}
            onChangeText={cfg.setName}
            placeholder="e.g. Code Review"
            placeholderTextColor={palette.placeholder}
            style={[adminStyles.input, { borderColor: palette.controlBorder, color: palette.foreground }]}
            value={cfg.name}
          />

          {cfg.activeToggle ? (
            <View style={styles.switchRow}>
              <Text style={[styles.switchLabel, { color: palette.foreground }]}>Active</Text>
              <Switch
                accessibilityLabel="Toggle Active Status"
                onValueChange={cfg.activeToggle.onChange}
                thumbColor={cfg.activeToggle.value ? palette.primary : palette.sheet}
                trackColor={{ false: palette.controlBorder, true: palette.primaryLight }}
                value={cfg.activeToggle.value}
              />
            </View>
          ) : null}

          <View style={adminStyles.modalActions}>
            <PressableScale
              accessibilityLabel={cfg.cancelLabel}
              accessibilityRole="button"
              onPress={cfg.onClose}
              style={[adminStyles.btn, adminStyles.btnOutline, { borderColor: palette.controlBorder }]}
            >
              <Text style={[adminStyles.btnText, { color: palette.foreground }]}>Cancel</Text>
            </PressableScale>
            <PressableScale
              accessibilityLabel={cfg.submitLabel}
              accessibilityRole="button"
              disabled={cfg.submitting}
              onPress={cfg.onSubmit}
              style={[adminStyles.btn, { backgroundColor: palette.primary }]}
            >
              {cfg.submitting ? (
                <ActivityIndicator color={palette.onPrimary} size="small" />
              ) : (
                <Text style={[adminStyles.btnText, { color: palette.onPrimary }]}>{cfg.submitText}</Text>
              )}
            </PressableScale>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );

  return (
    <View style={[adminStyles.container, { backgroundColor: palette.paper }]}>
      <ScreenHeader
        onBack={onBack}
        palette={palette}
        rightAction={
          <PressableScale
            accessibilityLabel="Create Activity Type"
            accessibilityRole="button"
            disabled={isOffline}
            onPress={handleOpenCreate}
            style={[adminStyles.headerAction, isOffline && adminStyles.disabled, { backgroundColor: palette.primary }]}
          >
            <Text style={[adminStyles.headerActionText, { color: palette.onPrimary }]}>New activity type</Text>
          </PressableScale>
        }
        subtitle="Manage loggable activity categories"
        title="Activity types"
      />

      <View style={[adminStyles.sheet, { backgroundColor: palette.sheet }]}>
        {errorMessage ? (
          <View accessibilityRole="alert" style={[adminStyles.errorBanner, { backgroundColor: palette.errorBoxBg }]}>
            <Text style={[adminStyles.errorBannerText, { color: palette.error }]}>{errorMessage}</Text>
          </View>
        ) : null}

        <TextInput
          accessibilityLabel="Search activity types"
          onChangeText={setSearch}
          placeholder="Search activity types"
          placeholderTextColor={palette.placeholder}
          style={[adminStyles.searchInput, { borderColor: palette.controlBorder, color: palette.foreground }]}
          value={search}
        />

        {loading && !refreshing ? (
          <View style={adminStyles.centered}>
            <ActivityIndicator color={palette.primary} size="large" />
            <Text style={[adminStyles.muted, { color: palette.muted }]}>Loading activity types…</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={adminStyles.listContent}
            data={filteredActivities}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <EmptyState
                icon="tag"
                message={search ? 'No activity types match that search. Try a different name.' : 'No activity types yet. Add the first one with New activity type.'}
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
            renderItem={renderActivityItem}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {renderModal({
        visible: createModalVisible,
        onClose: () => setCreateModalVisible(false),
        title: 'New activity type',
        error: createError,
        nameLabel: 'Activity Type Name',
        name: createName,
        setName: setCreateName,
        cancelLabel: 'Cancel',
        submitLabel: 'Save Activity Type',
        submitText: 'Create',
        submitting: createSubmitting,
        onSubmit: handleCreateSubmit,
      })}
      {renderModal({
        visible: editModalVisible,
        onClose: () => setEditModalVisible(false),
        title: 'Edit activity type',
        error: editError,
        nameLabel: 'Edit Activity Type Name',
        name: editName,
        setName: setEditName,
        activeToggle: { value: editIsActive, onChange: setEditIsActive },
        cancelLabel: 'Cancel Edit',
        submitLabel: 'Update Activity Type',
        submitText: 'Save',
        submitting: editSubmitting,
        onSubmit: handleEditSubmit,
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    marginTop: spacing.md,
  },
  switchLabel: { fontSize: typography.body, fontWeight: '600' },
});
