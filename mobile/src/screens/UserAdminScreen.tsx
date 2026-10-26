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
import { DepartmentField } from '../components/DepartmentField';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { Chip } from '../components/Chip';
import { FilterTab } from '../components/FilterTab';
import { EmptyState } from '../components/EmptyState';
import { adminStyles } from '../components/adminStyles';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useModalBounds } from '../utils/modal-layout';
import { useSessionActions, useSessionActor, useSessionSync } from '../auth/SessionProvider';
import type { PersonProfile, TitleAdminItem, TitleImpactInfo } from '../api/contracts';

interface UserAdminScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

const PERMISSION_ROLE_OPTIONS = ['user', 'admin', 'pm', 'co'] as const;
const HIERARCHY_ROLE_OPTIONS = ['user', 'engineer', 'team_lead', 'manager'] as const;

/** 'team_lead' -> 'Team lead'. */
function humanize(value: string): string {
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function UserAdminScreen({ isDarkMode: _isDarkMode, onBack }: UserAdminScreenProps) {
  const palette = useTheme().palette;
  const bounds = useModalBounds();
  const { effectiveActor } = useSessionActor();
  const { isOffline } = useSessionSync();
  const {
    listAdminUsers,
    createAdminUser,
    updateAdminUser,
    listDepartments,
    setUserDepartmentScope,
    listAdminTitles,
    createAdminTitle,
    getAdminTitleImpact,
    reclassifyAdminTitle,
    deleteAdminTitle,
  } = useSessionActions();

  const [users, setUsers] = useState<PersonProfile[]>([]);
  const [titles, setTitles] = useState<TitleAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Active View Tab: 'users' | 'titles'
  const [activeTab, setActiveTab] = useState<'users' | 'titles'>('users');

  // Create User Modal
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createName, setCreateName] = useState('');
  const [createDept, setCreateDept] = useState('');
  const [createTitle, setCreateTitle] = useState('');
  const [createPermRole, setCreatePermRole] = useState<string>('user');
  const [createHierRole, setCreateHierRole] = useState<string>('user');
  const [createManagerId, setCreateManagerId] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit User Modal
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<PersonProfile | null>(null);
  const [editName, setEditName] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editPermRole, setEditPermRole] = useState<string>('user');
  const [editHierRole, setEditHierRole] = useState<string>('user');
  const [editManagerId, setEditManagerId] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editScope, setEditScope] = useState<string[]>([]);
  const [scopeNames, setScopeNames] = useState<string[]>([]);
  const [scopeLoadError, setScopeLoadError] = useState<string | null>(null);

  // Title Management Modals
  const [createTitleModalVisible, setCreateTitleModalVisible] = useState(false);
  const [newTitleName, setNewTitleName] = useState('');
  const [newTitleRole, setNewTitleRole] = useState<string>('user');
  const [titleSubmitting, setTitleSubmitting] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  const [reclassifyModalVisible, setReclassifyModalVisible] = useState(false);
  const [reclassifyConfirmVisible, setReclassifyConfirmVisible] = useState(false);
  const [reclassifyingTitle, setReclassifyingTitle] = useState<TitleAdminItem | null>(null);
  const [reclassifyRole, setReclassifyRole] = useState<string>('user');
  const [reclassifySyncUsers, setReclassifySyncUsers] = useState(false);
  const [impactInfo, setImpactInfo] = useState<TitleImpactInfo | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);

  useEffect(() => {
    if (!reclassifyModalVisible || !reclassifyingTitle) return;
    let cancelled = false;
    setImpactLoading(true);
    getAdminTitleImpact(reclassifyingTitle.name, reclassifyRole)
      .then((impact: TitleImpactInfo) => {
        if (!cancelled) setImpactInfo(impact);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTitleError(err instanceof Error ? err.message : 'Failed to calculate title impact.');
          setImpactInfo(null);
        }
      })
      .finally(() => {
        if (!cancelled) setImpactLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reclassifyModalVisible, reclassifyingTitle, reclassifyRole, getAdminTitleImpact]);

  const fetchData = useCallback(async () => {
    try {
      setErrorMessage(null);
      let titleWarning: string | null = null;
      const [userData, titleData] = await Promise.all([
        listAdminUsers(),
        listAdminTitles().catch((err: unknown) => {
          // A failed titles fetch must not read as "no title definitions".
          titleWarning = err instanceof Error ? `Titles could not be loaded: ${err.message}` : 'Titles could not be loaded.';
          return [];
        }),
      ]);
      setUsers(userData);
      setTitles(titleData);
      if (titleWarning) setErrorMessage(titleWarning);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load user administration data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [listAdminUsers, listAdminTitles]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.name || '').toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.department || '').toLowerCase().includes(q) ||
        (u.title || '').toLowerCase().includes(q)
    );
  }, [users, search]);

  const handleOpenCreate = () => {
    setCreateEmail('');
    setCreatePassword('');
    setCreateName('');
    setCreateDept('');
    setCreateTitle('');
    setCreatePermRole('user');
    setCreateHierRole('user');
    setCreateManagerId(null);
    setCreateError(null);
    setCreateModalVisible(true);
  };

  const handleCreateSubmit = async () => {
    if (!createEmail.trim() || !createPassword || !createName.trim()) {
      setCreateError('Name, email, and password are required.');
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      await createAdminUser({
        email: createEmail.trim().toLowerCase(),
        password: createPassword,
        name: createName.trim(),
        department: createDept.trim() || undefined,
        title: createTitle.trim() || undefined,
        permissionRole: createPermRole,
        hierarchyRole: createHierRole,
        managerId: createManagerId,
      });
      setCreateModalVisible(false);
      await fetchData();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user account.');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleOpenEdit = useCallback((user: PersonProfile) => {
    setEditingUser(user);
    setEditName(user.name || '');
    setEditDept(user.department || '');
    setEditTitle(user.title || '');
    setEditPermRole(user.permissionRole || 'user');
    setEditHierRole(user.hierarchyRole || 'user');
    setEditManagerId(user.managerId || null);
    setEditScope(user.scopeDepartments ?? []);
    setEditError(null);
    setEditModalVisible(true);
  }, []);

  // Mirrors the web: only an org admin (an admin without a department scope of
  // their own) edits scope, and only for admin/CO targets other than themselves.
  // The server's 403 remains the real gate.
  const isOrgAdmin =
    effectiveActor?.permissionRole === 'admin' &&
    !users.find((u) => u.id === effectiveActor.id)?.scopeDepartments?.length;
  const canHaveScope = editPermRole === 'admin' || editPermRole === 'co';
  const showScope =
    editModalVisible && isOrgAdmin && canHaveScope && editingUser !== null && editingUser.id !== effectiveActor?.id;

  useEffect(() => {
    if (!showScope) return;
    let cancelled = false;
    listDepartments()
      .then((rows) => {
        if (cancelled) return;
        setScopeNames(rows.map((d) => d.name));
        setScopeLoadError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setScopeLoadError(err instanceof Error ? err.message : 'Could not load departments.');
      });
    return () => {
      cancelled = true;
    };
  }, [showScope, listDepartments]);

  const handleEditSubmit = async () => {
    if (!editingUser) return;
    if (!editName.trim()) {
      setEditError('Display name is required.');
      return;
    }
    setEditSubmitting(true);
    setEditError(null);
    try {
      await updateAdminUser(editingUser.id, {
        name: editName.trim(),
        department: editDept.trim(),
        title: editTitle.trim(),
        permissionRole: editPermRole,
        hierarchyRole: editHierRole,
        managerId: editManagerId,
      });
      if (isOrgAdmin && editingUser.id !== effectiveActor?.id) {
        const before = [...(editingUser.scopeDepartments ?? [])].sort().join('|');
        const next = canHaveScope ? editScope : [];
        // Leaving admin/CO clears any scope, as the web does.
        if ([...next].sort().join('|') !== before) {
          try {
            await setUserDepartmentScope(editingUser.id, next);
          } catch (scopeErr) {
            await fetchData();
            const forbidden = (scopeErr as { status?: number } | null)?.status === 403;
            setEditError(
              forbidden
                ? 'Profile saved, but only organisation admins can change department scope.'
                : `Profile saved, but department scope failed: ${scopeErr instanceof Error ? scopeErr.message : 'unknown error'}`
            );
            return;
          }
        }
      }
      setEditModalVisible(false);
      await fetchData();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update user.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleToggleActive = useCallback(
    (user: PersonProfile) => {
      if (user.id === effectiveActor?.id && user.isActive) {
        Alert.alert('Action blocked', 'You cannot deactivate your own account.');
        return;
      }
      const newStatus = !user.isActive;
      Alert.alert(
        newStatus ? 'Activate account' : 'Deactivate account',
        `Are you sure you want to ${newStatus ? 'activate' : 'deactivate'} ${user.name || user.email}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: newStatus ? 'Activate' : 'Deactivate',
            style: newStatus ? 'default' : 'destructive',
            onPress: async () => {
              try {
                setErrorMessage(null);
                await updateAdminUser(user.id, { isActive: newStatus });
                await fetchData();
              } catch (err) {
                setErrorMessage(err instanceof Error ? err.message : 'Failed to update status.');
              }
            },
          },
        ]
      );
    },
    [effectiveActor?.id, fetchData, updateAdminUser]
  );

  const handleCreateTitleSubmit = async () => {
    if (!newTitleName.trim()) {
      setTitleError('Title name is required.');
      return;
    }
    setTitleSubmitting(true);
    setTitleError(null);
    try {
      await createAdminTitle({
        name: newTitleName.trim(),
        hierarchyRole: newTitleRole,
      });
      setCreateTitleModalVisible(false);
      await fetchData();
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : 'Failed to create title.');
    } finally {
      setTitleSubmitting(false);
    }
  };

  const handleReclassifySubmit = async () => {
    if (!reclassifyingTitle) return;
    // Blast-radius confirmation: sync touches every user holding the title.
    if (!reclassifyConfirmVisible) {
      setReclassifyConfirmVisible(true);
      return;
    }
    setReclassifyConfirmVisible(false);
    setTitleSubmitting(true);
    setTitleError(null);
    try {
      await reclassifyAdminTitle({
        name: reclassifyingTitle.name,
        hierarchyRole: reclassifyRole,
        syncUsers: reclassifySyncUsers,
      });
      setReclassifyModalVisible(false);
      await fetchData();
    } catch (err) {
      setTitleError(err instanceof Error ? err.message : 'Failed to reclassify title.');
    } finally {
      setTitleSubmitting(false);
    }
  };

  const handleDeleteTitle = (title: TitleAdminItem) => {
    Alert.alert(
      'Delete title',
      `Are you sure you want to delete the title "${title.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setErrorMessage(null);
              await deleteAdminTitle(title.name);
              await fetchData();
            } catch (err) {
              setErrorMessage(err instanceof Error ? err.message : 'Failed to delete title.');
            }
          },
        },
      ]
    );
  };

  // Managers mapping
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const roleChips = (
    options: readonly string[],
    value: string,
    onSelect: (role: string) => void,
    a11yPrefix: string,
    disabled = false
  ) => (
    <View style={adminStyles.chipRow}>
      {options.map((r) => (
        <Chip
          key={r}
          accessibilityLabel={`${a11yPrefix} ${r}`}
          active={value === r}
          disabled={disabled}
          label={humanize(r)}
          onPress={() => onSelect(r)}
          palette={palette}
        />
      ))}
    </View>
  );

  const textField = (
    label: string,
    a11y: string,
    value: string,
    onChangeText: (v: string) => void,
    placeholder: string,
    extra: Partial<React.ComponentProps<typeof TextInput>> = {}
  ) => (
    <>
      <Text style={[adminStyles.label, { color: palette.muted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={a11y}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.placeholder}
        style={[adminStyles.input, { borderColor: palette.controlBorder, color: palette.foreground }]}
        value={value}
        {...extra}
      />
    </>
  );

  const renderFormModal = (cfg: {
    visible: boolean;
    onClose: () => void;
    title: string;
    error: string | null;
    body: React.ReactNode;
    cancelLabel: string;
    submitLabel: string;
    submitText: string;
    submitting: boolean;
    submitDisabled: boolean;
    onSubmit: () => void;
    footer?: React.ReactNode;
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

          {cfg.body}

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
              disabled={cfg.submitDisabled}
              onPress={cfg.onSubmit}
              style={[adminStyles.btn, cfg.submitDisabled && adminStyles.disabled, { backgroundColor: palette.primary }]}
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
      {cfg.footer}
    </Modal>
  );

  const renderUserItem = useCallback(
    ({ item }: { item: PersonProfile }) => {
      const isSelf = item.id === effectiveActor?.id;
      const manager = item.managerId ? usersById.get(item.managerId) : null;
      const jobLine = [item.title, item.department].filter(Boolean).join(', ');

      return (
        <View
          accessibilityLabel={`User: ${item.name || item.email}`}
          style={[adminStyles.row, styles.userRow, { borderBottomColor: palette.hairline }]}
        >
          <View style={adminStyles.rowMain}>
            <Text style={[adminStyles.rowTitle, { color: palette.foreground }]}>
              {item.name || item.email}
              {isSelf ? <Text style={[styles.selfText, { color: palette.muted }]}>{'  You'}</Text> : null}
            </Text>
            <Text style={[adminStyles.rowMeta, { color: palette.muted }]}>{item.email}</Text>
            {jobLine ? <Text style={[adminStyles.rowMeta, { color: palette.muted }]}>{jobLine}</Text> : null}
            <Text style={[adminStyles.rowMeta, { color: palette.muted }]}>
              {`${humanize(item.permissionRole)}, ${humanize(item.hierarchyRole)}`}
            </Text>
            {manager ? (
              <Text style={[adminStyles.rowMeta, { color: palette.muted }]}>
                Reports to {manager.name || manager.email}
              </Text>
            ) : null}
            <View
              style={[
                adminStyles.pill,
                styles.statusPill,
                { backgroundColor: item.isActive ? palette.loggedTint : palette.missingTint },
              ]}
            >
              <Text style={[adminStyles.pillText, { color: item.isActive ? palette.loggedText : palette.missingText }]}>
                {item.isActive ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </View>

          <View style={adminStyles.rowActions}>
            <PressableScale
              accessibilityLabel={`${item.isActive ? 'Deactivate' : 'Activate'} ${item.name || item.email}`}
              accessibilityRole="button"
              onPress={() => handleToggleActive(item)}
              style={adminStyles.iconButton}
            >
              <Icon
                color={item.isActive ? palette.loggedText : palette.muted}
                name={item.isActive ? 'check' : 'close'}
                size={18}
              />
            </PressableScale>

            <PressableScale
              accessibilityLabel={`Edit ${item.name || item.email}`}
              accessibilityRole="button"
              onPress={() => handleOpenEdit(item)}
              style={adminStyles.iconButton}
            >
              <Icon color={palette.primaryText} name="edit" size={18} />
            </PressableScale>
          </View>
        </View>
      );
    },
    [effectiveActor?.id, handleOpenEdit, handleToggleActive, palette, usersById]
  );

  const refreshControl = (
    <RefreshControl
      colors={[palette.primary]}
      onRefresh={onRefresh}
      refreshing={refreshing}
      tintColor={palette.primary}
    />
  );
  const editingSelf = editingUser?.id === effectiveActor?.id;

  return (
    <View style={[adminStyles.container, { backgroundColor: palette.paper }]}>
      <ScreenHeader
        onBack={onBack}
        palette={palette}
        rightAction={
          activeTab === 'users' ? (
            <PressableScale
              accessibilityLabel="Add User"
              accessibilityRole="button"
              onPress={handleOpenCreate}
              style={[adminStyles.headerAction, { backgroundColor: palette.primary }]}
            >
              <Text style={[adminStyles.headerActionText, { color: palette.onPrimary }]}>New user</Text>
            </PressableScale>
          ) : (
            <PressableScale
              accessibilityLabel="Add Title"
              accessibilityRole="button"
              onPress={() => {
                setNewTitleName('');
                setNewTitleRole('user');
                setTitleError(null);
                setCreateTitleModalVisible(true);
              }}
              style={[adminStyles.headerAction, { backgroundColor: palette.primary }]}
            >
              <Text style={[adminStyles.headerActionText, { color: palette.onPrimary }]}>New title</Text>
            </PressableScale>
          )
        }
        subtitle="Provision accounts, roles, and reporting lines"
        title="User management"
      />

      <View style={[adminStyles.sheet, { backgroundColor: palette.sheet }]}>
        {errorMessage ? (
          <View accessibilityRole="alert" style={[adminStyles.errorBanner, { backgroundColor: palette.errorBoxBg }]}>
            <Text style={[adminStyles.errorBannerText, { color: palette.error }]}>{errorMessage}</Text>
          </View>
        ) : null}

        <View style={styles.tabsRow}>
          <FilterTab
            accessibilityLabel="Users Tab"
            active={activeTab === 'users'}
            label={`Users (${users.length})`}
            onPress={() => setActiveTab('users')}
            palette={palette}
          />
          <FilterTab
            accessibilityLabel="Titles Tab"
            active={activeTab === 'titles'}
            label={`Titles (${titles.length})`}
            onPress={() => setActiveTab('titles')}
            palette={palette}
          />
        </View>

        {activeTab === 'users' ? (
          <>
            <TextInput
              accessibilityLabel="Search users"
              onChangeText={setSearch}
              placeholder="Search by name, email, department or title"
              placeholderTextColor={palette.placeholder}
              style={[adminStyles.searchInput, { borderColor: palette.controlBorder, color: palette.foreground }]}
              value={search}
            />

            {loading && !refreshing ? (
              <View style={adminStyles.centered}>
                <ActivityIndicator color={palette.primary} size="large" />
                <Text style={[adminStyles.muted, { color: palette.muted }]}>Loading users…</Text>
              </View>
            ) : (
              <FlatList
                contentContainerStyle={adminStyles.listContent}
                data={filteredUsers}
                keyExtractor={(item) => item.id}
                ListEmptyComponent={
                  <EmptyState
                    icon="team"
                    message={search ? 'No users match that search. Try a different name, email or department.' : 'No users yet. Add the first workspace user with New user.'}
                    palette={palette}
                  />
                }
                refreshControl={refreshControl}
                renderItem={renderUserItem}
                showsVerticalScrollIndicator={false}
              />
            )}
          </>
        ) : (
          <FlatList
            contentContainerStyle={adminStyles.listContent}
            data={titles}
            keyExtractor={(item) => item.name}
            ListEmptyComponent={
              <EmptyState
                icon="tag"
                message="No titles defined yet. Add one with New title."
                palette={palette}
              />
            }
            refreshControl={refreshControl}
            renderItem={({ item }) => (
              <View
                accessibilityLabel={`Title: ${item.name}`}
                style={[adminStyles.row, { borderBottomColor: palette.hairline }]}
              >
                <View style={adminStyles.rowMain}>
                  <Text style={[adminStyles.rowTitle, { color: palette.foreground }]}>{item.name}</Text>
                  <Text style={[adminStyles.rowMeta, { color: palette.muted }]}>{humanize(item.hierarchyRole)}</Text>
                </View>
                <View style={adminStyles.rowActions}>
                  <PressableScale
                    accessibilityLabel={`Reclassify ${item.name}`}
                    accessibilityRole="button"
                    onPress={() => {
                      setReclassifyingTitle(item);
                      setReclassifyRole(item.hierarchyRole);
                      setReclassifySyncUsers(false);
                      setTitleError(null);
                      setImpactInfo(null);
                      setReclassifyModalVisible(true);
                    }}
                    style={adminStyles.iconButton}
                  >
                    <Icon color={palette.primaryText} name="edit" size={18} />
                  </PressableScale>
                  <PressableScale
                    accessibilityLabel={`Delete ${item.name}`}
                    accessibilityRole="button"
                    onPress={() => handleDeleteTitle(item)}
                    style={adminStyles.iconButton}
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

      {renderFormModal({
        visible: createModalVisible,
        onClose: () => setCreateModalVisible(false),
        title: 'New user account',
        error: createError,
        cancelLabel: 'Cancel',
        submitLabel: 'Save User',
        submitText: 'Create',
        submitting: createSubmitting,
        submitDisabled: createSubmitting || isOffline,
        onSubmit: handleCreateSubmit,
        body: (
          <>
            {textField('Full name', 'Full Name', createName, setCreateName, 'e.g. John Doe')}
            {textField('Email address', 'Email Address', createEmail, setCreateEmail, 'e.g. john@vsis.lk', {
              autoCapitalize: 'none',
              keyboardType: 'email-address',
            })}
            {textField('Temporary password', 'Password', createPassword, setCreatePassword, 'Min 8 chars, 1 uppercase, 1 number', {
              autoCapitalize: 'none',
              secureTextEntry: true,
            })}

            <Text style={[adminStyles.label, { color: palette.muted }]}>Department</Text>
            <DepartmentField
              accessibilityLabel="Department"
              listDepartments={listDepartments}
              onChange={setCreateDept}
              palette={palette}
              value={createDept}
            />

            {textField('Title', 'Title', createTitle, setCreateTitle, 'e.g. Software Engineer')}

            <Text style={[adminStyles.label, { color: palette.muted }]}>Permission role</Text>
            {roleChips(PERMISSION_ROLE_OPTIONS, createPermRole, setCreatePermRole, 'Select permission role')}

            <Text style={[adminStyles.label, { color: palette.muted }]}>Hierarchy role</Text>
            {roleChips(HIERARCHY_ROLE_OPTIONS, createHierRole, setCreateHierRole, 'Select hierarchy role')}
          </>
        ),
      })}

      {renderFormModal({
        visible: editModalVisible,
        onClose: () => setEditModalVisible(false),
        title: 'Edit user',
        error: editError,
        cancelLabel: 'Cancel Edit',
        submitLabel: 'Update User',
        submitText: 'Save',
        submitting: editSubmitting,
        submitDisabled: editSubmitting || isOffline,
        onSubmit: handleEditSubmit,
        body: (
          <>
            {textField('Full name', 'Edit Full Name', editName, setEditName, 'Full name')}

            <Text style={[adminStyles.label, { color: palette.muted }]}>Department</Text>
            <DepartmentField
              accessibilityLabel="Edit Department"
              listDepartments={listDepartments}
              onChange={setEditDept}
              palette={palette}
              value={editDept}
            />

            {textField('Title', 'Edit Title', editTitle, setEditTitle, 'Title')}

            <Text style={[adminStyles.label, { color: palette.muted }]}>Permission role</Text>
            {roleChips(PERMISSION_ROLE_OPTIONS, editPermRole, setEditPermRole, 'Edit permission role', editingSelf)}

            <Text style={[adminStyles.label, { color: palette.muted }]}>Hierarchy role</Text>
            {roleChips(HIERARCHY_ROLE_OPTIONS, editHierRole, setEditHierRole, 'Edit hierarchy role', editingSelf)}

            {showScope ? (
              <>
                <Text style={[adminStyles.label, { color: palette.muted }]}>Department scope</Text>
                <Text style={[styles.scopeHint, { color: palette.muted }]}>
                  {editScope.length === 0
                    ? 'No limit: sees and manages every department. Select departments to restrict.'
                    : `Limited to ${editScope.length} department${editScope.length === 1 ? '' : 's'}.`}
                </Text>
                {scopeLoadError ? (
                  <Text style={[adminStyles.modalError, { color: palette.error }]}>{scopeLoadError}</Text>
                ) : null}
                <View style={adminStyles.chipRow}>
                  {scopeNames.map((n) => {
                    const on = editScope.includes(n);
                    return (
                      <Chip
                        key={n}
                        accessibilityLabel={`Scope department ${n}`}
                        active={on}
                        label={n}
                        onPress={() => setEditScope(on ? editScope.filter((x) => x !== n) : [...editScope, n])}
                        palette={palette}
                      />
                    );
                  })}
                </View>
              </>
            ) : null}
          </>
        ),
      })}

      {renderFormModal({
        visible: createTitleModalVisible,
        onClose: () => setCreateTitleModalVisible(false),
        title: 'New title',
        error: titleError,
        cancelLabel: 'Cancel Title',
        submitLabel: 'Save Title',
        submitText: 'Create',
        submitting: titleSubmitting,
        submitDisabled: titleSubmitting || isOffline,
        onSubmit: handleCreateTitleSubmit,
        body: (
          <>
            {textField('Title name', 'New Title Name', newTitleName, setNewTitleName, 'e.g. Lead Architect')}
            <Text style={[adminStyles.label, { color: palette.muted }]}>Hierarchy role</Text>
            {roleChips(HIERARCHY_ROLE_OPTIONS, newTitleRole, setNewTitleRole, 'Classify as')}
          </>
        ),
      })}

      {renderFormModal({
        visible: reclassifyModalVisible,
        onClose: () => setReclassifyModalVisible(false),
        title: `Reclassify “${reclassifyingTitle?.name ?? ''}”`,
        error: titleError,
        cancelLabel: 'Cancel Reclassify',
        submitLabel: 'Save Reclassification',
        submitText: 'Save',
        submitting: titleSubmitting,
        submitDisabled: titleSubmitting || impactLoading || isOffline,
        onSubmit: handleReclassifySubmit,
        body: (
          <>
            <Text style={[adminStyles.label, { color: palette.muted }]}>New hierarchy role</Text>
            {roleChips(HIERARCHY_ROLE_OPTIONS, reclassifyRole, setReclassifyRole, 'Reclassify to')}

            <View style={[styles.impact, { borderColor: palette.hairline }]}>
              {impactLoading ? (
                <View style={styles.inlineRow}>
                  <ActivityIndicator color={palette.primary} size="small" />
                  <Text style={[styles.impactText, { color: palette.muted }]}>Calculating title impact…</Text>
                </View>
              ) : impactInfo ? (
                <View>
                  <Text style={[styles.impactTitle, { color: palette.foreground }]}>Impact</Text>
                  <Text style={[styles.impactText, { color: palette.muted }]}>
                    {`${impactInfo.affectedCount} user${impactInfo.affectedCount === 1 ? '' : 's'} currently hold this title.`}
                  </Text>
                  {impactInfo.syncRequired ? (
                    <Text style={[styles.impactText, { color: palette.primaryText }]}>
                      {`Turning on sync updates all ${impactInfo.affectedCount} user${impactInfo.affectedCount === 1 ? '' : 's'} to ${humanize(reclassifyRole)} in one step.`}
                    </Text>
                  ) : (
                    <Text style={[styles.impactText, { color: palette.muted }]}>
                      No users need a role update for this classification.
                    </Text>
                  )}
                </View>
              ) : null}
            </View>

            <View style={styles.switchRow}>
              <Text style={[styles.switchLabel, { color: palette.foreground }]}>Sync all users with this title</Text>
              <Switch
                accessibilityLabel="Sync users"
                onValueChange={setReclassifySyncUsers}
                thumbColor={reclassifySyncUsers ? palette.primary : palette.sheet}
                trackColor={{ false: palette.controlBorder, true: palette.primaryLight }}
                value={reclassifySyncUsers}
              />
            </View>
          </>
        ),
        footer: (
          <ConfirmDialog
            visible={reclassifyConfirmVisible}
            title="Apply this reclassification?"
            message={
              reclassifySyncUsers && impactInfo?.affectedCount
                ? `Every user holding "${reclassifyingTitle?.name}" (${impactInfo.affectedCount} user${impactInfo.affectedCount === 1 ? '' : 's'}) will be updated to ${humanize(reclassifyRole)} in one step.`
                : `The title "${reclassifyingTitle?.name}" will be reclassified to ${humanize(reclassifyRole)}.`
            }
            confirmLabel="Apply reclassification"
            onConfirm={handleReclassifySubmit}
            onCancel={() => setReclassifyConfirmVisible(false)}
            palette={palette}
          />
        ),
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-start' },
  selfText: { fontSize: typography.caption, fontWeight: '400' },
  statusPill: { marginTop: spacing.xs },
  tabsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  scopeHint: { fontSize: typography.caption, marginBottom: spacing.sm },
  impact: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    gap: 2,
  },
  impactTitle: { fontSize: typography.caption, fontWeight: '600' },
  impactText: { fontSize: typography.caption, marginTop: 2 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    marginTop: spacing.md,
    gap: spacing.md,
  },
  switchLabel: { flex: 1, fontSize: typography.body, fontWeight: '600' },
});
