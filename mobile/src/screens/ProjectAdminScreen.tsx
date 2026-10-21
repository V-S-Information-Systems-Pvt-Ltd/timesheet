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
import { useModalBounds } from '../utils/modal-layout';
import { useSessionActions, useSessionSync } from '../auth/SessionProvider';
import type { ProjectAdminItem } from '../api/contracts';

interface ProjectAdminScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export function ProjectAdminScreen({ isDarkMode: _isDarkMode, onBack }: ProjectAdminScreenProps) {
  const palette = useTheme().palette;
  const bounds = useModalBounds();
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
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectAdminItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editSo, setEditSo] = useState('');
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
      await createAdminProject({
        name: trimmedName,
        soNumber: createSo.trim() || undefined,
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
      await updateAdminProject(editingProject.id, {
        name: trimmedName,
        soNumber: editSo.trim() || null,
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
          style={[adminStyles.row, { borderBottomColor: palette.hairline }]}
        >
          <View style={adminStyles.rowMain}>
            <Text style={[adminStyles.rowTitle, { color: palette.foreground }]}>{item.name}</Text>
            {item.so_number ? (
              <Text style={[adminStyles.rowMeta, { color: palette.muted }]}>SO: {item.so_number}</Text>
            ) : null}
          </View>
          <View style={adminStyles.rowActions}>
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
    [handleDelete, handleOpenEdit, isOffline, palette]
  );

  const renderModal = (cfg: {
    visible: boolean;
    onClose: () => void;
    title: string;
    error: string | null;
    nameLabel: string;
    soLabel: string;
    name: string;
    setName: (v: string) => void;
    so: string;
    setSo: (v: string) => void;
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

          <Text style={[adminStyles.label, { color: palette.muted }]}>Project name</Text>
          <TextInput
            accessibilityLabel={cfg.nameLabel}
            onChangeText={cfg.setName}
            placeholder="e.g. Core Banking System"
            placeholderTextColor={palette.placeholder}
            style={[adminStyles.input, { borderColor: palette.controlBorder, color: palette.foreground }]}
            value={cfg.name}
          />

          <Text style={[adminStyles.label, { color: palette.muted }]}>SO number (optional)</Text>
          <TextInput
            accessibilityLabel={cfg.soLabel}
            onChangeText={cfg.setSo}
            placeholder="e.g. SO-2026-001"
            placeholderTextColor={palette.placeholder}
            style={[adminStyles.input, { borderColor: palette.controlBorder, color: palette.foreground }]}
            value={cfg.so}
          />

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
            accessibilityLabel="Create Project"
            accessibilityRole="button"
            disabled={isOffline}
            onPress={handleOpenCreate}
            style={[adminStyles.headerAction, isOffline && adminStyles.disabled, { backgroundColor: palette.primary }]}
          >
            <Text style={[adminStyles.headerActionText, { color: palette.onPrimary }]}>New project</Text>
          </PressableScale>
        }
        subtitle="Manage workspace project catalog"
        title="Projects"
      />

      <View style={[adminStyles.sheet, { backgroundColor: palette.sheet }]}>
        {errorMessage ? (
          <View accessibilityRole="alert" style={[adminStyles.errorBanner, { backgroundColor: palette.errorBoxBg }]}>
            <Text style={[adminStyles.errorBannerText, { color: palette.error }]}>{errorMessage}</Text>
          </View>
        ) : null}

        <TextInput
          accessibilityLabel="Search projects"
          onChangeText={setSearch}
          placeholder="Search by name or SO number"
          placeholderTextColor={palette.placeholder}
          style={[adminStyles.searchInput, { borderColor: palette.controlBorder, color: palette.foreground }]}
          value={search}
        />

        {loading && !refreshing ? (
          <View style={adminStyles.centered}>
            <ActivityIndicator color={palette.primary} size="large" />
            <Text style={[adminStyles.muted, { color: palette.muted }]}>Loading projects…</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={adminStyles.listContent}
            data={filteredProjects}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <EmptyState
                icon="folder"
                message={search ? 'No projects match that search. Try a different name or SO number.' : 'No projects yet. Add the first one with New project.'}
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
            renderItem={renderProjectItem}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {renderModal({
        visible: createModalVisible,
        onClose: () => setCreateModalVisible(false),
        title: 'New project',
        error: createError,
        nameLabel: 'Project Name',
        soLabel: 'SO Number',
        name: createName,
        setName: setCreateName,
        so: createSo,
        setSo: setCreateSo,
        cancelLabel: 'Cancel',
        submitLabel: 'Save Project',
        submitText: 'Create',
        submitting: createSubmitting,
        onSubmit: handleCreateSubmit,
      })}
      {renderModal({
        visible: editModalVisible,
        onClose: () => setEditModalVisible(false),
        title: 'Edit project',
        error: editError,
        nameLabel: 'Edit Project Name',
        soLabel: 'Edit SO Number',
        name: editName,
        setName: setEditName,
        so: editSo,
        setSo: setEditSo,
        cancelLabel: 'Cancel Edit',
        submitLabel: 'Update Project',
        submitText: 'Save',
        submitting: editSubmitting,
        onSubmit: handleEditSubmit,
      })}
    </View>
  );
}
