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
import { colors, spacing, typography, borderRadius, shadows, useTheme } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
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
      style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}
    >
      <Text style={[styles.name, { color: palette.foreground }]}>{item.name}</Text>
      <View style={styles.cardActions}>
        <PressableScale
          accessibilityLabel={`Rename ${item.name}`}
          accessibilityRole="button"
          disabled={isOffline}
          onPress={() => openForm(item)}
          style={[styles.iconButton, { backgroundColor: palette.badgeBg }, isOffline && styles.disabled]}
        >
          <Icon color={palette.primary} name="edit" size={16} />
        </PressableScale>
        <PressableScale
          accessibilityLabel={`Delete ${item.name}`}
          accessibilityRole="button"
          disabled={isOffline}
          onPress={() => requestDelete(item)}
          style={[styles.iconButton, { backgroundColor: palette.badgeBg }, isOffline && styles.disabled]}
        >
          <Icon color={colors.danger} name="trash" size={16} />
        </PressableScale>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScreenHeader
        onBack={onBack}
        palette={palette}
        rightAction={
          <PressableScale
            accessibilityLabel="Create Department"
            accessibilityRole="button"
            disabled={isOffline}
            onPress={() => openForm(null)}
            style={[styles.headerActionBtn, isOffline && styles.disabled, { backgroundColor: palette.primary }]}
          >
            <Icon color={palette.onPrimary} name="plus" size={16} />
            <Text style={[styles.headerActionText, { color: palette.onPrimary }]}>New</Text>
          </PressableScale>
        }
        subtitle="Manage organisation departments"
        title="Departments"
      />

      <View style={styles.content}>
        {errorMessage ? (
          <View accessibilityRole="alert" style={[styles.errorBanner, { backgroundColor: palette.errorBoxBg, borderColor: palette.error }]}>
            <Icon color={colors.danger} name="alert-circle" size={18} />
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={[styles.searchContainer, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Icon color={palette.muted} name="search" size={18} />
          <TextInput
            accessibilityLabel="Search departments"
            onChangeText={setSearch}
            placeholder="Search departments…"
            placeholderTextColor={palette.placeholder}
            style={[styles.searchInput, { color: palette.foreground }]}
            value={search}
          />
        </View>

        {loading && !refreshing ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator color={palette.primary} size="large" />
            <Text style={[styles.loadingText, { color: palette.muted }]}>Loading departments…</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={filtered}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={[styles.emptyTitle, { color: palette.foreground }]}>No departments found</Text>
                <Text style={[styles.emptySubtitle, { color: palette.muted }]}>
                  {search ? 'Try a different search query.' : 'Add your first department using the New button.'}
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
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      <Modal animationType="slide" transparent visible={formVisible} onRequestClose={() => setFormVisible(false)}>
        <View style={[styles.modalOverlay, bounds]}>
          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.modalTitle, { color: palette.foreground }]}>
              {editing ? 'Rename Department' : 'New Department'}
            </Text>
            {formError ? <Text style={styles.modalError}>{formError}</Text> : null}

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Department Name *</Text>
            <TextInput
              accessibilityLabel="Department Name"
              onChangeText={setFormName}
              placeholder="e.g. Engineering"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={formName}
            />

            <View style={styles.modalActions}>
              <PressableScale
                accessibilityLabel="Cancel"
                accessibilityRole="button"
                onPress={() => setFormVisible(false)}
                style={[styles.modalBtn, { backgroundColor: palette.badgeBg }]}
              >
                <Text style={[styles.modalBtnText, { color: palette.foreground }]}>Cancel</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Save Department"
                accessibilityRole="button"
                disabled={formSubmitting}
                onPress={handleSubmit}
                style={[styles.modalBtn, { backgroundColor: palette.primary }]}
              >
                {formSubmitting ? (
                  <ActivityIndicator color={palette.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: palette.onPrimary }]}>{editing ? 'Save' : 'Create'}</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: spacing.lg },
  disabled: { opacity: 0.5 },
  headerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  headerActionText: { fontSize: typography.caption, fontWeight: '700' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  errorBannerText: { color: colors.danger, fontSize: typography.caption, fontWeight: '600', flex: 1 },
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
  searchInput: { flex: 1, fontSize: typography.body, paddingVertical: 0 },
  listContent: { paddingBottom: spacing.xxl, gap: spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    ...shadows.sm,
  },
  name: { flex: 1, marginRight: spacing.md, fontSize: typography.body, fontWeight: '700' },
  cardActions: { flexDirection: 'row', gap: spacing.xs },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  loadingText: { fontSize: typography.caption, fontWeight: '500' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.xs },
  emptyTitle: { fontSize: typography.title, fontWeight: '700', marginTop: spacing.sm },
  emptySubtitle: { fontSize: typography.caption, textAlign: 'center' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalScroll: { flexGrow: 0, flexShrink: 1, width: '100%' },
  modalCard: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    ...shadows.md,
  },
  modalTitle: { fontSize: typography.title, fontWeight: '700', marginBottom: spacing.md },
  modalError: { color: colors.danger, fontSize: typography.caption, fontWeight: '600', marginBottom: spacing.sm },
  inputLabel: { fontSize: typography.caption, fontWeight: '600', marginBottom: 4, marginTop: spacing.xs },
  modalInput: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.body,
    marginBottom: spacing.sm,
  },
  modalActions: {
    flexWrap: 'wrap',
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
  modalBtnText: { fontSize: typography.caption, fontWeight: '700' },
});
