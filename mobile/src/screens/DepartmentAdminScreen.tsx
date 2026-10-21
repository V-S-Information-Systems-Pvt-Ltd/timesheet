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
import { EmptyState } from '../components/EmptyState';
import { adminStyles } from '../components/adminStyles';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useModalBounds } from '../utils/modal-layout';
import { useSessionActions, useSessionSync } from '../auth/SessionProvider';

interface Department {
  id: string;
  name: string;
}

interface DepartmentAdminScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export const DEPARTMENT_FORBIDDEN_MESSAGE = 'Only organisation admins can manage departments.';

/** The server's 403 is the real org-admin gate; mobile cannot see org-admin status. */
function describeError(err: unknown, fallback: string): string {
  if ((err as { status?: number } | null)?.status === 403) return DEPARTMENT_FORBIDDEN_MESSAGE;
  return err instanceof Error && err.message ? err.message : fallback;
}

export function DepartmentAdminScreen({ isDarkMode: _isDarkMode, onBack }: DepartmentAdminScreenProps) {
  const palette = useTheme().palette;
  const bounds = useModalBounds();
  const { isOffline } = useSessionSync();
  const { listDepartments, createAdminDepartment, renameAdminDepartment, deleteAdminDepartment } =
    useSessionActions();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // One name form serves both create (editing === null) and rename.
  const [formVisible, setFormVisible] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [formName, setFormName] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<Department | null>(null);

  const fetchDepartments = useCallback(async () => {
    try {
      setErrorMessage(null);
      setDepartments(await listDepartments());
    } catch (err) {
      setErrorMessage(describeError(err, 'Failed to load departments.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [listDepartments]);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchDepartments();
  }, [fetchDepartments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? departments.filter((d) => d.name.toLowerCase().includes(q)) : departments;
  }, [departments, search]);

  const openForm = (target: Department | null) => {
    if (isOffline) {
      Alert.alert('Offline', 'Cannot change departments while offline.');
      return;
    }
    setEditing(target);
    setFormName(target?.name ?? '');
    setFormError(null);
    setFormVisible(true);
  };

  const handleSubmit = async () => {
    if (isOffline) {
      setFormError('Cannot change departments while offline.');
      return;
    }
    const name = formName.trim();
    if (!name) {
      setFormError('Department name is required.');
      return;
    }
    setFormSubmitting(true);
    setFormError(null);
    try {
      if (editing) await renameAdminDepartment(editing.id, name);
      else await createAdminDepartment(name);
      setFormVisible(false);
      await fetchDepartments();
    } catch (err) {
      setFormError(describeError(err, editing ? 'Failed to rename department.' : 'Failed to create department.'));
    } finally {
      setFormSubmitting(false);
    }
  };

  const requestDelete = (department: Department) => {
    if (isOffline) {
      Alert.alert('Offline', 'Cannot delete departments while offline.');
      return;
    }
    setPendingDelete(department);
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    try {
      setErrorMessage(null);
      await deleteAdminDepartment(target.id);
      await fetchDepartments();
    } catch (err) {
      setErrorMessage(describeError(err, 'Failed to delete department.'));
    }
  };

  const renderItem = ({ item }: { item: Department }) => (
    <View
      accessibilityLabel={`Department: ${item.name}`}
      style={[adminStyles.row, { borderBottomColor: palette.hairline }]}
    >
      <Text style={[adminStyles.rowMain, adminStyles.rowTitle, { color: palette.foreground }]}>{item.name}</Text>
      <View style={adminStyles.rowActions}>
        <PressableScale
          accessibilityLabel={`Rename ${item.name}`}
          accessibilityRole="button"
          disabled={isOffline}
          onPress={() => openForm(item)}
          style={[adminStyles.iconButton, isOffline && adminStyles.disabled]}
        >
          <Icon color={palette.primary} name="edit" size={18} />
        </PressableScale>
        <PressableScale
          accessibilityLabel={`Delete ${item.name}`}
          accessibilityRole="button"
          disabled={isOffline}
          onPress={() => requestDelete(item)}
          style={[adminStyles.iconButton, isOffline && adminStyles.disabled]}
        >
          <Icon color={palette.error} name="trash" size={18} />
        </PressableScale>
      </View>
    </View>
  );

  return (
    <View style={[adminStyles.container, { backgroundColor: palette.paper }]}>
      <ScreenHeader
        onBack={onBack}
        palette={palette}
        rightAction={
          <PressableScale
            accessibilityLabel="Create Department"
            accessibilityRole="button"
            disabled={isOffline}
            onPress={() => openForm(null)}
            style={[adminStyles.headerAction, isOffline && adminStyles.disabled, { backgroundColor: palette.primary }]}
          >
            <Text style={[adminStyles.headerActionText, { color: palette.onPrimary }]}>New department</Text>
          </PressableScale>
        }
        subtitle="Manage organisation departments"
        title="Departments"
      />

      <View style={[adminStyles.sheet, { backgroundColor: palette.sheet }]}>
        {errorMessage ? (
          <View accessibilityRole="alert" style={[adminStyles.errorBanner, { backgroundColor: palette.errorBoxBg }]}>
            <Text style={[adminStyles.errorBannerText, { color: palette.error }]}>{errorMessage}</Text>
          </View>
        ) : null}

        <TextInput
          accessibilityLabel="Search departments"
          onChangeText={setSearch}
          placeholder="Search departments"
          placeholderTextColor={palette.placeholder}
          style={[adminStyles.searchInput, { borderColor: palette.controlBorder, color: palette.foreground }]}
          value={search}
        />

        {loading && !refreshing ? (
          <View style={adminStyles.centered}>
            <ActivityIndicator color={palette.primary} size="large" />
            <Text style={[adminStyles.muted, { color: palette.muted }]}>Loading departments…</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={adminStyles.listContent}
            data={filtered}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <EmptyState
                message={search ? 'No departments match that search. Try a different name.' : 'No departments yet. Add the first one with New department.'}
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
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      <Modal animationType="slide" transparent visible={formVisible} onRequestClose={() => setFormVisible(false)}>
        <View style={[adminStyles.modalOverlay, bounds]}>
          <ScrollView
            contentContainerStyle={[adminStyles.modalCard, { backgroundColor: palette.sheet, borderColor: palette.hairline }]}
            keyboardShouldPersistTaps="handled"
            style={adminStyles.modalScroll}
          >
            <Text style={[adminStyles.modalTitle, { color: palette.foreground }]}>
              {editing ? 'Rename department' : 'New department'}
            </Text>
            {formError ? <Text style={[adminStyles.modalError, { color: palette.error }]}>{formError}</Text> : null}

            <Text style={[adminStyles.label, { color: palette.muted }]}>Department name</Text>
            <TextInput
              accessibilityLabel="Department Name"
              onChangeText={setFormName}
              placeholder="e.g. Engineering"
              placeholderTextColor={palette.placeholder}
              style={[adminStyles.input, { borderColor: palette.controlBorder, color: palette.foreground }]}
              value={formName}
            />

            <View style={adminStyles.modalActions}>
              <PressableScale
                accessibilityLabel="Cancel"
                accessibilityRole="button"
                onPress={() => setFormVisible(false)}
                style={[adminStyles.btn, adminStyles.btnOutline, { borderColor: palette.controlBorder }]}
              >
                <Text style={[adminStyles.btnText, { color: palette.foreground }]}>Cancel</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Save Department"
                accessibilityRole="button"
                disabled={formSubmitting}
                onPress={handleSubmit}
                style={[adminStyles.btn, { backgroundColor: palette.primary }]}
              >
                {formSubmitting ? (
                  <ActivityIndicator color={palette.onPrimary} size="small" />
                ) : (
                  <Text style={[adminStyles.btnText, { color: palette.onPrimary }]}>{editing ? 'Save' : 'Create'}</Text>
                )}
              </PressableScale>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Delete department?"
        message={`Delete "${pendingDelete?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
        palette={palette}
      />
    </View>
  );
}
