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
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { useSessionActions, useSessionActor, useSessionSync } from '../auth/SessionProvider';
import type { PersonProfile, TitleAdminItem, TitleImpactInfo } from '../api/contracts';

interface UserAdminScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

const PERMISSION_ROLE_OPTIONS = ['user', 'admin', 'pm', 'co'] as const;
const HIERARCHY_ROLE_OPTIONS = ['user', 'engineer', 'team_lead', 'manager'] as const;

export function UserAdminScreen({ isDarkMode, onBack }: UserAdminScreenProps) {
  const palette = getPalette(isDarkMode);
  const { effectiveActor } = useSessionActor();
  const { isOffline } = useSessionSync();
  const {
    listAdminUsers,
    createAdminUser,
    updateAdminUser,
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

  // Title Management Modals
  const [createTitleModalVisible, setCreateTitleModalVisible] = useState(false);
  const [newTitleName, setNewTitleName] = useState('');
  const [newTitleRole, setNewTitleRole] = useState<string>('user');
  const [titleSubmitting, setTitleSubmitting] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  const [reclassifyModalVisible, setReclassifyModalVisible] = useState(false);
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
      const [userData, titleData] = await Promise.all([
        listAdminUsers(),
        listAdminTitles().catch(() => []),
      ]);
      setUsers(userData);
      setTitles(titleData);
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
    setEditError(null);
    setEditModalVisible(true);
  }, []);

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
        department: editDept.trim() || undefined,
        title: editTitle.trim() || undefined,
        permissionRole: editPermRole,
        hierarchyRole: editHierRole,
        managerId: editManagerId,
      });
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
        Alert.alert('Action Blocked', 'You cannot deactivate your own account.');
        return;
      }
      const newStatus = !user.isActive;
      Alert.alert(
        newStatus ? 'Activate Account' : 'Deactivate Account',
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
      'Delete Title',
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

  const renderUserItem = useCallback(
    ({ item }: { item: PersonProfile }) => {
      const initial = item.name ? item.name[0].toUpperCase() : 'U';
      const isSelf = item.id === effectiveActor?.id;
      const manager = item.managerId ? usersById.get(item.managerId) : null;

      return (
        <View
          accessibilityLabel={`User: ${item.name || item.email}`}
          style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}
        >
          <View style={styles.cardHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>

            <View style={styles.cardInfo}>
              <View style={styles.nameRow}>
                <Text style={[styles.userName, { color: palette.foreground }]}>
                  {item.name || item.email}
                </Text>
                {isSelf ? (
                  <View style={[styles.selfBadge, { backgroundColor: palette.badgeBg }]}>
                    <Text style={[styles.selfBadgeText, { color: colors.primary }]}>YOU</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.userEmail, { color: palette.muted }]}>{item.email}</Text>
              {item.title ? (
                <Text style={[styles.userTitle, { color: palette.muted }]}>
                  {item.title} {item.department ? `• ${item.department}` : ''}
                </Text>
              ) : null}

              {/* Roles Badge Row */}
              <View style={styles.metaRow}>
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: item.permissionRole === 'admin' ? '#FEF3C7' : palette.badgeBg,
                      borderColor: item.permissionRole === 'admin' ? '#FCD34D' : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      { color: item.permissionRole === 'admin' ? '#B45309' : palette.foreground },
                    ]}
                  >
                    {item.permissionRole.toUpperCase()}
                  </Text>
                </View>

                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor:
                        item.hierarchyRole === 'manager' || item.hierarchyRole === 'team_lead'
                          ? '#EFF6FF'
                          : palette.badgeBg,
                      borderColor:
                        item.hierarchyRole === 'manager' || item.hierarchyRole === 'team_lead'
                          ? '#BFDBFE'
                          : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      {
                        color:
                          item.hierarchyRole === 'manager' || item.hierarchyRole === 'team_lead'
                            ? colors.primary
                            : palette.muted,
                      },
                    ]}
                  >
                    {item.hierarchyRole.toUpperCase()}
                  </Text>
                </View>

                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: item.isActive ? '#ECFDF5' : '#FEF2F2',
                      borderColor: item.isActive ? '#A7F3D0' : '#FECACA',
                    },
                  ]}
                >
                  <Text style={[styles.badgeText, { color: item.isActive ? '#059669' : colors.danger }]}>
                    {item.isActive ? 'ACTIVE' : 'INACTIVE'}
                  </Text>
                </View>
              </View>

              {manager ? (
                <Text style={[styles.managerText, { color: palette.placeholder }]}>
                  Reports to: {manager.name || manager.email}
                </Text>
              ) : null}
            </View>

            <View style={styles.cardActions}>
              <PressableScale
                accessibilityLabel={`${item.isActive ? 'Deactivate' : 'Activate'} ${item.name || item.email}`}
                accessibilityRole="button"
                onPress={() => handleToggleActive(item)}
                style={[styles.iconButton, { backgroundColor: palette.badgeBg }]}
              >
                <Icon
                  color={item.isActive ? '#059669' : palette.muted}
                  name={item.isActive ? 'check' : 'close'}
                  size={16}
                />
              </PressableScale>

              <PressableScale
                accessibilityLabel={`Edit ${item.name || item.email}`}
                accessibilityRole="button"
                onPress={() => handleOpenEdit(item)}
                style={[styles.iconButton, { backgroundColor: palette.badgeBg }]}
              >
                <Icon color={colors.primary} name="edit" size={16} />
              </PressableScale>
            </View>
          </View>
        </View>
      );
    },
    [effectiveActor?.id, handleOpenEdit, handleToggleActive, palette, usersById]
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScreenHeader
        onBack={onBack}
        palette={palette}
        rightAction={
          activeTab === 'users' ? (
            <PressableScale
              accessibilityLabel="Add User"
              accessibilityRole="button"
              onPress={handleOpenCreate}
              style={styles.headerActionBtn}
            >
              <Icon color={colors.onPrimary} name="plus" size={16} />
              <Text style={styles.headerActionText}>New User</Text>
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
              style={styles.headerActionBtn}
            >
              <Icon color={colors.onPrimary} name="plus" size={16} />
              <Text style={styles.headerActionText}>New Title</Text>
            </PressableScale>
          )
        }
        subtitle="Provision accounts, roles, and reporting lines"
        title="User Management"
      />

      <View style={styles.content}>
        {/* Error Banner */}
        {errorMessage ? (
          <View style={styles.errorBanner}>
            <Icon color={colors.danger} name="alert-circle" size={18} />
            <Text style={styles.errorBannerText}>{errorMessage}</Text>
          </View>
        ) : null}

        {/* Tab Switcher: Users vs Titles */}
        <View style={styles.tabsRow}>
          <PressableScale
            accessibilityLabel="Users Tab"
            accessibilityRole="button"
            onPress={() => setActiveTab('users')}
            style={[
              styles.tabBtn,
              activeTab === 'users' && { backgroundColor: colors.primary, borderColor: colors.primary },
            ]}
          >
            <Text
              style={[
                styles.tabBtnText,
                { color: activeTab === 'users' ? colors.onPrimary : palette.foreground },
              ]}
            >
              Users ({users.length})
            </Text>
          </PressableScale>

          <PressableScale
            accessibilityLabel="Titles Tab"
            accessibilityRole="button"
            onPress={() => setActiveTab('titles')}
            style={[
              styles.tabBtn,
              activeTab === 'titles' && { backgroundColor: colors.primary, borderColor: colors.primary },
            ]}
          >
            <Text
              style={[
                styles.tabBtnText,
                { color: activeTab === 'titles' ? colors.onPrimary : palette.foreground },
              ]}
            >
              Titles ({titles.length})
            </Text>
          </PressableScale>
        </View>

        {activeTab === 'users' ? (
          <>
            {/* Search Input */}
            <View
              style={[
                styles.searchContainer,
                { backgroundColor: palette.card, borderColor: palette.border },
              ]}
            >
              <Icon color={palette.muted} name="search" size={18} />
              <TextInput
                accessibilityLabel="Search users"
                onChangeText={setSearch}
                placeholder="Search by name, email, department, title…"
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

            {loading && !refreshing ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text style={[styles.loadingText, { color: palette.muted }]}>Loading users…</Text>
              </View>
            ) : (
              <FlatList
                contentContainerStyle={styles.listContent}
                data={filteredUsers}
                keyExtractor={(item) => item.id}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Icon color={palette.muted} name="team" size={40} />
                    <Text style={[styles.emptyTitle, { color: palette.foreground }]}>No users found</Text>
                    <Text style={[styles.emptySubtitle, { color: palette.muted }]}>
                      {search ? 'Try a different search query.' : 'Add your first workspace user.'}
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
                renderItem={renderUserItem}
                showsVerticalScrollIndicator={false}
              />
            )}
          </>
        ) : (
          /* Titles Management Tab */
          <FlatList
            contentContainerStyle={styles.listContent}
            data={titles}
            keyExtractor={(item) => item.name}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Icon color={palette.muted} name="tag" size={40} />
                <Text style={[styles.emptyTitle, { color: palette.foreground }]}>No title definitions</Text>
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
            renderItem={({ item }) => (
              <View
                accessibilityLabel={`Title: ${item.name}`}
                style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}
              >
                <View style={styles.cardHeader}>
                  <View style={styles.cardInfo}>
                    <Text style={[styles.userName, { color: palette.foreground }]}>{item.name}</Text>
                    <View style={[styles.badge, { alignSelf: 'flex-start', marginTop: 4 }]}>
                      <Text style={[styles.badgeText, { color: colors.primary }]}>
                        {item.hierarchyRole.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.cardActions}>
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
                      style={[styles.iconButton, { backgroundColor: palette.badgeBg }]}
                    >
                      <Icon color={colors.primary} name="edit" size={16} />
                    </PressableScale>
                    <PressableScale
                      accessibilityLabel={`Delete ${item.name}`}
                      accessibilityRole="button"
                      onPress={() => handleDeleteTitle(item)}
                      style={[styles.iconButton, { backgroundColor: palette.badgeBg }]}
                    >
                      <Icon color={colors.danger} name="trash" size={16} />
                    </PressableScale>
                  </View>
                </View>
              </View>
            )}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      {/* Create User Modal */}
      <Modal animationType="slide" transparent visible={createModalVisible}>
        <View style={styles.modalOverlay}>
          <ScrollView
            contentContainerStyle={[
              styles.modalCard,
              { backgroundColor: palette.card, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: palette.foreground }]}>New User Account</Text>
            {createError ? <Text style={styles.modalError}>{createError}</Text> : null}

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Full Name *</Text>
            <TextInput
              accessibilityLabel="Full Name"
              onChangeText={setCreateName}
              placeholder="e.g. John Doe"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={createName}
            />

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Email Address *</Text>
            <TextInput
              accessibilityLabel="Email Address"
              autoCapitalize="none"
              keyboardType="email-address"
              onChangeText={setCreateEmail}
              placeholder="e.g. john@vsis.lk"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={createEmail}
            />

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Temporary Password *</Text>
            <TextInput
              accessibilityLabel="Password"
              autoCapitalize="none"
              onChangeText={setCreatePassword}
              placeholder="Min 8 chars, 1 uppercase, 1 number"
              placeholderTextColor={palette.placeholder}
              secureTextEntry
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={createPassword}
            />

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Department</Text>
            <TextInput
              accessibilityLabel="Department"
              onChangeText={setCreateDept}
              placeholder="e.g. Engineering"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={createDept}
            />

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Title</Text>
            <TextInput
              accessibilityLabel="Title"
              onChangeText={setCreateTitle}
              placeholder="e.g. Software Engineer"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={createTitle}
            />

            {/* Permission Role Selector */}
            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Permission Role</Text>
            <View style={styles.roleOptionsRow}>
              {PERMISSION_ROLE_OPTIONS.map((r) => (
                <PressableScale
                  key={r}
                  accessibilityLabel={`Select permission role ${r}`}
                  accessibilityRole="button"
                  onPress={() => setCreatePermRole(r)}
                  style={[
                    styles.roleOptionBtn,
                    {
                      backgroundColor: createPermRole === r ? colors.primary : palette.badgeBg,
                      borderColor: createPermRole === r ? colors.primary : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.roleOptionText,
                      { color: createPermRole === r ? colors.onPrimary : palette.foreground },
                    ]}
                  >
                    {r.toUpperCase()}
                  </Text>
                </PressableScale>
              ))}
            </View>

            {/* Hierarchy Role Selector */}
            <Text style={[styles.inputLabel, { color: palette.foreground, marginTop: spacing.sm }]}>Hierarchy Role</Text>
            <View style={styles.roleOptionsRow}>
              {HIERARCHY_ROLE_OPTIONS.map((r) => (
                <PressableScale
                  key={r}
                  accessibilityLabel={`Select hierarchy role ${r}`}
                  accessibilityRole="button"
                  onPress={() => setCreateHierRole(r)}
                  style={[
                    styles.roleOptionBtn,
                    {
                      backgroundColor: createHierRole === r ? colors.primary : palette.badgeBg,
                      borderColor: createHierRole === r ? colors.primary : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.roleOptionText,
                      { color: createHierRole === r ? colors.onPrimary : palette.foreground },
                    ]}
                  >
                    {r.toUpperCase()}
                  </Text>
                </PressableScale>
              ))}
            </View>

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
                accessibilityLabel="Save User"
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
          </ScrollView>
        </View>
      </Modal>

      {/* Edit User Modal */}
      <Modal animationType="slide" transparent visible={editModalVisible}>
        <View style={styles.modalOverlay}>
          <ScrollView
            contentContainerStyle={[
              styles.modalCard,
              { backgroundColor: palette.card, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.modalTitle, { color: palette.foreground }]}>Edit User</Text>
            {editError ? <Text style={styles.modalError}>{editError}</Text> : null}

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Full Name *</Text>
            <TextInput
              accessibilityLabel="Edit Full Name"
              onChangeText={setEditName}
              placeholder="Full Name"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={editName}
            />

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Department</Text>
            <TextInput
              accessibilityLabel="Edit Department"
              onChangeText={setEditDept}
              placeholder="Department"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={editDept}
            />

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Title</Text>
            <TextInput
              accessibilityLabel="Edit Title"
              onChangeText={setEditTitle}
              placeholder="Title"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={editTitle}
            />

            {/* Permission Role Selector */}
            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Permission Role</Text>
            <View style={styles.roleOptionsRow}>
              {PERMISSION_ROLE_OPTIONS.map((r) => (
                <PressableScale
                  key={r}
                  accessibilityLabel={`Edit permission role ${r}`}
                  accessibilityRole="button"
                  disabled={editingUser?.id === effectiveActor?.id}
                  onPress={() => setEditPermRole(r)}
                  style={[
                    styles.roleOptionBtn,
                    {
                      backgroundColor: editPermRole === r ? colors.primary : palette.badgeBg,
                      borderColor: editPermRole === r ? colors.primary : palette.border,
                      opacity: editingUser?.id === effectiveActor?.id ? 0.5 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.roleOptionText,
                      { color: editPermRole === r ? colors.onPrimary : palette.foreground },
                    ]}
                  >
                    {r.toUpperCase()}
                  </Text>
                </PressableScale>
              ))}
            </View>

            {/* Hierarchy Role Selector */}
            <Text style={[styles.inputLabel, { color: palette.foreground, marginTop: spacing.sm }]}>Hierarchy Role</Text>
            <View style={styles.roleOptionsRow}>
              {HIERARCHY_ROLE_OPTIONS.map((r) => (
                <PressableScale
                  key={r}
                  accessibilityLabel={`Edit hierarchy role ${r}`}
                  accessibilityRole="button"
                  disabled={editingUser?.id === effectiveActor?.id}
                  onPress={() => setEditHierRole(r)}
                  style={[
                    styles.roleOptionBtn,
                    {
                      backgroundColor: editHierRole === r ? colors.primary : palette.badgeBg,
                      borderColor: editHierRole === r ? colors.primary : palette.border,
                      opacity: editingUser?.id === effectiveActor?.id ? 0.5 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.roleOptionText,
                      { color: editHierRole === r ? colors.onPrimary : palette.foreground },
                    ]}
                  >
                    {r.toUpperCase()}
                  </Text>
                </PressableScale>
              ))}
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
                accessibilityLabel="Update User"
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
          </ScrollView>
        </View>
      </Modal>

      {/* Create Title Modal */}
      <Modal animationType="slide" transparent visible={createTitleModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.modalTitle, { color: palette.foreground }]}>New Title Definition</Text>
            {titleError ? <Text style={styles.modalError}>{titleError}</Text> : null}

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Title Name *</Text>
            <TextInput
              accessibilityLabel="New Title Name"
              onChangeText={setNewTitleName}
              placeholder="e.g. Lead Architect"
              placeholderTextColor={palette.placeholder}
              style={[styles.modalInput, { backgroundColor: palette.background, borderColor: palette.border, color: palette.foreground }]}
              value={newTitleName}
            />

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>Classified Hierarchy Role</Text>
            <View style={styles.roleOptionsRow}>
              {HIERARCHY_ROLE_OPTIONS.map((r) => (
                <PressableScale
                  key={r}
                  accessibilityLabel={`Classify as ${r}`}
                  accessibilityRole="button"
                  onPress={() => setNewTitleRole(r)}
                  style={[
                    styles.roleOptionBtn,
                    {
                      backgroundColor: newTitleRole === r ? colors.primary : palette.badgeBg,
                      borderColor: newTitleRole === r ? colors.primary : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.roleOptionText,
                      { color: newTitleRole === r ? colors.onPrimary : palette.foreground },
                    ]}
                  >
                    {r.toUpperCase()}
                  </Text>
                </PressableScale>
              ))}
            </View>

            <View style={styles.modalActions}>
              <PressableScale
                accessibilityLabel="Cancel Title"
                accessibilityRole="button"
                onPress={() => setCreateTitleModalVisible(false)}
                style={[styles.modalBtn, { backgroundColor: palette.badgeBg }]}
              >
                <Text style={[styles.modalBtnText, { color: palette.foreground }]}>Cancel</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Save Title"
                accessibilityRole="button"
                disabled={titleSubmitting}
                onPress={handleCreateTitleSubmit}
                style={[styles.modalBtn, { backgroundColor: colors.primary }]}
              >
                {titleSubmitting ? (
                  <ActivityIndicator color={colors.onPrimary} size="small" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: colors.onPrimary }]}>Create</Text>
                )}
              </PressableScale>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reclassify Title Modal */}
      <Modal animationType="slide" transparent visible={reclassifyModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
            <Text style={[styles.modalTitle, { color: palette.foreground }]}>
              Reclassify &ldquo;{reclassifyingTitle?.name}&rdquo;
            </Text>
            {titleError ? <Text style={styles.modalError}>{titleError}</Text> : null}

            <Text style={[styles.inputLabel, { color: palette.foreground }]}>New Hierarchy Role</Text>
            <View style={styles.roleOptionsRow}>
              {HIERARCHY_ROLE_OPTIONS.map((r) => (
                <PressableScale
                  key={r}
                  accessibilityLabel={`Reclassify to ${r}`}
                  accessibilityRole="button"
                  onPress={() => setReclassifyRole(r)}
                  style={[
                    styles.roleOptionBtn,
                    {
                      backgroundColor: reclassifyRole === r ? colors.primary : palette.badgeBg,
                      borderColor: reclassifyRole === r ? colors.primary : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.roleOptionText,
                      { color: reclassifyRole === r ? colors.onPrimary : palette.foreground },
                    ]}
                  >
                    {r.toUpperCase()}
                  </Text>
                </PressableScale>
              ))}
            </View>

            <View
              style={[
                styles.infoBanner,
                {
                  backgroundColor: palette.badgeBg,
                  borderColor: palette.border,
                  borderWidth: 1,
                  borderRadius: borderRadius.md,
                  padding: spacing.md,
                  marginVertical: spacing.md,
                },
              ]}
            >
              {impactLoading ? (
                <View style={styles.inlineRow}>
                  <ActivityIndicator color={colors.primary} size="small" />
                  <Text style={[styles.infoBannerText, { color: palette.muted }]}>
                    Calculating title impact…
                  </Text>
                </View>
              ) : impactInfo ? (
                <View>
                  <Text style={[styles.infoBannerTitle, { color: palette.foreground }]}>
                    Impact Analysis
                  </Text>
                  <Text style={[styles.infoBannerText, { color: palette.muted, marginTop: 2 }]}>
                    • {impactInfo.affectedCount} user(s) currently hold this title.
                  </Text>
                  {impactInfo.syncRequired ? (
                    <Text style={[styles.infoBannerText, { color: colors.primary, marginTop: 2 }]}>
                      • Enabling sync will atomically update all {impactInfo.affectedCount} user(s) to {reclassifyRole.toUpperCase()}.
                    </Text>
                  ) : (
                    <Text style={[styles.infoBannerText, { color: palette.muted, marginTop: 2 }]}>
                      • No users require role updates for this classification.
                    </Text>
                  )}
                </View>
              ) : null}
            </View>

            <View style={styles.switchRow}>
              <Text style={[styles.switchLabel, { color: palette.foreground }]}>
                Sync all users with this title
              </Text>
              <Switch
                accessibilityLabel="Sync users"
                onValueChange={setReclassifySyncUsers}
                thumbColor={reclassifySyncUsers ? colors.primary : '#ccc'}
                trackColor={{ false: '#767577', true: palette.badgeBg }}
                value={reclassifySyncUsers}
              />
            </View>

            <View style={styles.modalActions}>
              <PressableScale
                accessibilityLabel="Cancel Reclassify"
                accessibilityRole="button"
                onPress={() => setReclassifyModalVisible(false)}
                style={[styles.modalBtn, { backgroundColor: palette.badgeBg }]}
              >
                <Text style={[styles.modalBtnText, { color: palette.foreground }]}>Cancel</Text>
              </PressableScale>
              <PressableScale
                accessibilityLabel="Save Reclassification"
                accessibilityRole="button"
                disabled={titleSubmitting || impactLoading || isOffline}
                onPress={handleReclassifySubmit}
                style={[
                  styles.modalBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: titleSubmitting || impactLoading || isOffline ? 0.5 : 1,
                  },
                ]}
              >
                {titleSubmitting ? (
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
  tabsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tabBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabBtnText: {
    fontSize: typography.caption,
    fontWeight: '700',
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
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: {
    color: colors.onPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  cardInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  userName: {
    fontSize: typography.body,
    fontWeight: '700',
  },
  selfBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: borderRadius.sm,
  },
  selfBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  userEmail: {
    fontSize: typography.caption,
  },
  userTitle: {
    fontSize: 12,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
    marginTop: 6,
  },
  badge: {
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  managerText: {
    fontSize: 11,
    marginTop: 4,
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
  roleOptionsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
    marginBottom: spacing.xs,
  },
  roleOptionBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
  },
  roleOptionText: {
    fontSize: 11,
    fontWeight: '700',
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
    flex: 1,
    marginRight: spacing.sm,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  infoBanner: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  infoBannerTitle: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  infoBannerText: {
    fontSize: 12,
    fontWeight: '500',
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
