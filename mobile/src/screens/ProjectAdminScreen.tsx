import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import type { ProjectAdminItem } from '../api/contracts';

interface ProjectAdminScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function ProjectAdminScreen({ isDarkMode: _isDarkMode, onBack }: ProjectAdminScreenProps) {
  const palette = useTheme().palette;
  const { isOffline } = useSessionSync();
  const { listAdminProjects, createAdminProject, updateAdminProject, deleteAdminProject } =
    useSessionActions();

  const [projects, setProjects] = useState<ProjectAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Create Modal State
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createSo, setCreateSo] = useState('');
  const [createTelegramNo, setCreateTelegramNo] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectAdminItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editSo, setEditSo] = useState('');
  const [editTelegramNo, setEditTelegramNo] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setErrorMessage(null);
      const data = await listAdminProjects();
      setProjects(data);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load projects.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [listAdminProjects]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchProjects();
  }, [fetchProjects]);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.so_number && p.so_number.toLowerCase().includes(q))
    );
  }, [projects, search]);

  const handleOpenCreate = () => {
    if (isOffline) {
      Alert.alert('Offline', 'Cannot create projects while offline.');
      return;
    }
    setCreateName('');
    setCreateSo('');
    setCreateTelegramNo('');
    setCreateError(null);
    setCreateModalVisible(true);
  };

  const handleCreateSubmit = async () => {
    if (isOffline) {
      setCreateError('Cannot create projects while offline.');
      return;
    }
    const trimmedName = createName.trim();
    if (!trimmedName) {
      setCreateError('Project name is required.');
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
      await createAdminProject({
        name: trimmedName,
        soNumber: createSo.trim() || undefined,
        telegramNo: parsedTelegram,
      });
      setCreateModalVisible(false);
      await fetchProjects();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create project.');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleOpenEdit = useCallback((project: ProjectAdminItem) => {
    if (isOffline) {
      Alert.alert('Offline', 'Cannot edit projects while offline.');
      return;
    }
    setEditingProject(project);
    setEditName(project.name);
    setEditSo(project.so_number || '');
    setEditTelegramNo(project.telegram_no ? String(project.telegram_no) : '');
    setEditError(null);
    setEditModalVisible(true);
  }, [isOffline]);

  const handleEditSubmit = async () => {
    if (isOffline) {
      setEditError('Cannot edit projects while offline.');
      return;
    }
    if (!editingProject) return;
    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditError('Project name is required.');
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
      await updateAdminProject(editingProject.id, {
        name: trimmedName,
        soNumber: editSo.trim() || null,
        telegramNo: parsedTelegram,
      });
      setEditModalVisible(false);
      await fetchProjects();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update project.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = useCallback(
    (project: ProjectAdminItem) => {
      if (isOffline) {
        Alert.alert('Offline', 'Cannot delete projects while offline.');
        return;
      }
      Alert.alert(
        'Delete Project',
        `Are you sure you want to delete "${project.name}"? This action cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                setErrorMessage(null);
                await deleteAdminProject(project.id);
                await fetchProjects();
              } catch (err) {
                setErrorMessage(err instanceof Error ? err.message : 'Failed to delete project.');
              }
            },
          },
        ]
      );
    },
    [deleteAdminProject, fetchProjects, isOffline]
  );

  const renderProjectItem = useCallback(
    ({ item }: { item: ProjectAdminItem }) => {
      return (
        <View
          accessibilityLabel={`Project: ${item.name}`}
          style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}
        >
          <View style={styles.cardHeader}>
            <View style={styles.cardInfo}>
              <Text style={[styles.projectName, { color: palette.foreground }]}>{item.name}</Text>
              <View style={styles.metaRow}>
                {item.so_number ? (
                  <View style={[styles.badge, { backgroundColor: palette.badgeBg, borderColor: palette.border }]}>
                    <Text style={[styles.badgeText, { color: palette.muted }]}>SO: {item.so_number}</Text>
                  </View>
                ) : null}
                {item.telegram_no ? (
                  <View style={[styles.badge, { backgroundColor: palette.badgeBg, borderColor: palette.border }]}>
                    <Text style={[styles.badgeText, { color: palette.primary }]}>Bot #{item.telegram_no}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View style={styles.cardActions}>
              <PressableScale
                accessibilityLabel={`Edit ${item.name}`}
                accessibilityRole="button"
                disabled={isOffline}
                onPress={() => handleOpenEdit(item)}
                style={[styles.iconButton, { backgroundColor: palette.badgeBg }, isOffline && { opacity: 0.5 }]}
              >
                <Icon color={palette.primary} name="edit" size={16} />
              </PressableScale>
              <PressableScale
                accessibilityLabel={`Delete ${item.name}`}
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
      );
    },
    [handleDelete, handleOpenEdit, isOffline, palette]
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScreenHeader
        onBack={onBack}
        palette={palette}
        rightAction={
          <PressableScale
            accessibilityLabel="Create Project"
            accessibilityRole="button"
            disabled={isOffline}
            onPress={handleOpenCreate}
            style={[styles.headerActionBtn, isOffline && { opacity: 0.5 }, { backgroundColor: palette.primary }]}
          >
            <Icon color={palette.onPrimary} name="plus" size={16} />
            <Text style={[styles.headerActionText, { color: palette.onPrimary }]}>New</Text>
          </PressableScale>
        }
        subtitle="Manage workspace project catalog"
        title="Projects"
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
            accessibilityLabel="Search projects"
            onChangeText={setSearch}
            placeholder="Search by name or SO number…"
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

        {/* Project List */}
        {loading && !refreshing ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator color={palette.primary} size="large" />
            <Text style={[styles.loadingText, { color: palette.muted }]}>Loading projects…</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={filteredProjects}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Icon color={palette.muted} name="folder" size={40} />
                <Text style={[styles.emptyTitle, { color: palette.foreground }]}>No projects found</Text>
                <Text style={[styles.emptySubtitle, { color: palette.muted }]}>
                  {search ? 'Try a different search query.' : 'Create your first project using the + button.'}
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
            renderItem={renderProjectItem}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {/* Create Project Modal */}
      <Modal animationType="slide" transparent visible={createModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.modalTitle, { color: palette.foreground }]}>New Project</Text>
            {createError ? <Text style={styles.modalError}>{createError}</Text> : null}

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Project Name *</Text>
            <TextInput
              accessibilityLabel="Project Name"
              onChangeText={setCreateName}
              placeholder="e.g. Core Banking System"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={createName}
            />

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>SO Number (Optional)</Text>
            <TextInput
              accessibilityLabel="SO Number"
              onChangeText={setCreateSo}
              placeholder="e.g. SO-2026-001"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={createSo}
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
                accessibilityLabel="Save Project"
                accessibilityRole="button"
                disabled={createSubmitting}
                onPress={handleCreateSubmit}
                style={[styles.modalBtn, { backgroundColor: palette.primary }]}
              >
                {createSubmitting ? (
                  <ActivityIndicator color={palette.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: palette.onPrimary }]}>Create</Text>
                )}
              </PressableScale>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Project Modal */}
      <Modal animationType="slide" transparent visible={editModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.modalTitle, { color: palette.foreground }]}>Edit Project</Text>
            {editError ? <Text style={styles.modalError}>{editError}</Text> : null}

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Project Name *</Text>
            <TextInput
              accessibilityLabel="Edit Project Name"
              onChangeText={setEditName}
              placeholder="e.g. Core Banking System"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={editName}
            />

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>SO Number (Optional)</Text>
            <TextInput
              accessibilityLabel="Edit SO Number"
              onChangeText={setEditSo}
              placeholder="e.g. SO-2026-001"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={editSo}
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
                accessibilityLabel="Update Project"
                accessibilityRole="button"
                disabled={editSubmitting}
                onPress={handleEditSubmit}
                style={[styles.modalBtn, { backgroundColor: palette.primary }]}
              >
                {editSubmitting ? (
                  <ActivityIndicator color={palette.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: palette.onPrimary }]}>Save</Text>
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
    justifyContent: 'space-between',
  },
  cardInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  projectName: {
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
