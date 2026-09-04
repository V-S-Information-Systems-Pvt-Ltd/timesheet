import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSessionActions } from '../auth/SessionProvider';
import type { PersonProfile } from '../api/contracts';
import { colors, spacing, typography, borderRadius, shadows, useTheme } from '../theme';

import { ScreenHeader } from '../components/ScreenHeader';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { buildHierarchyTree, type HierarchyTreeNode } from '../utils/hierarchy';

interface TeamScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
  onSelectMember?: (member: PersonProfile, destination: 'timesheets' | 'reports') => void;
}

type TeamViewMode = 'tree' | 'directory';

export function TeamScreen({ isDarkMode: _isDarkMode, onBack, onSelectMember }: TeamScreenProps) {
  const palette = useTheme().palette;
  const { listPeople } = useSessionActions();
  const [people, setPeople] = useState<PersonProfile[]>([]);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<TeamViewMode>('tree');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<PersonProfile | null>(null);

  const fetchPeople = useCallback(async () => {
    setError(null);
    try {
      const data = await listPeople();
      setPeople(data ?? []);
      // Default: expand top level roots
      const roots = data?.filter((p) => !p.managerId) ?? [];
      setExpandedIds(new Set(roots.map((r) => r.id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load team members.');
    }
  }, [listPeople]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setIsLoading(true);
      await fetchPeople();
      if (mounted) setIsLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [fetchPeople]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await fetchPeople();
    setIsRefreshing(false);
  }

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const filteredPeople = useMemo(() => {
    if (!search.trim()) return people;
    const q = search.toLowerCase().trim();
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        (p.department && p.department.toLowerCase().includes(q)) ||
        (p.title && p.title.toLowerCase().includes(q))
    );
  }, [people, search]);

  const treeResult = useMemo(() => {
    return buildHierarchyTree(filteredPeople);
  }, [filteredPeople]);

  // Flatten the expandable tree based on expandedIds
  const flattenedTreeNodes = useMemo(() => {
    const flattened: HierarchyTreeNode<PersonProfile>[] = [];

    function traverse(nodes: HierarchyTreeNode<PersonProfile>[]) {
      for (const node of nodes) {
        flattened.push(node);
        if (node.children.length > 0 && expandedIds.has(node.item.id)) {
          traverse(node.children);
        }
      }
    }

    traverse(treeResult.roots);
    return flattened;
  }, [treeResult.roots, expandedIds]);

  const renderRoleBadge = useCallback(
    (item: PersonProfile) => {
      const role = item.hierarchyRole;
      let label = 'USER';
      let isLeader = false;

      if (role === 'manager') {
        label = 'MANAGER';
        isLeader = true;
      } else if (role === 'team_lead') {
        label = 'LEAD';
        isLeader = true;
      } else if (role === 'engineer') {
        label = 'ENGINEER';
      }

      return (
        <View
          style={[
            styles.roleBadge,
            { backgroundColor: isLeader ? palette.badgeBg : palette.card, borderColor: palette.border },
          ]}
        >
          <Text
            style={[
              styles.roleBadgeText,
              { color: isLeader ? palette.primary : palette.muted },
            ]}
          >
            {label}
          </Text>
        </View>
      );
    },
    [palette]
  );

  const handleMemberPress = useCallback(
    (item: PersonProfile) => {
      if (onSelectMember) {
        setSelectedMember(item);
      }
    },
    [onSelectMember]
  );

  const renderDirectoryItem = useCallback(
    ({ item }: { item: PersonProfile }) => {
      const initial = item.name ? item.name[0].toUpperCase() : 'U';
      const isActionable = Boolean(onSelectMember);

      return (
        <PressableScale
          accessibilityLabel={`Team member: ${item.name}`}
          accessibilityRole={isActionable ? 'button' : 'none'}
          disabled={!isActionable}
          onPress={() => handleMemberPress(item)}
          style={[
            styles.personCard,
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}
        >
          <View style={[styles.avatar, { backgroundColor: palette.primary }]}>
            <Text style={[styles.avatarText, { color: palette.onPrimary }]}>{initial}</Text>
          </View>
          <View style={styles.personInfo}>
            <View style={styles.personHeader}>
              <Text style={[styles.personName, { color: palette.foreground }]}>{item.name}</Text>
              {renderRoleBadge(item)}
            </View>
            <Text style={[styles.personEmail, { color: palette.muted }]}>{item.email}</Text>
            {item.title ? (
              <Text style={[styles.personTitle, { color: palette.muted }]}>{item.title}</Text>
            ) : null}
            {item.department ? (
              <Text style={[styles.personDept, { color: palette.placeholder }]}>{item.department}</Text>
            ) : null}
          </View>
        </PressableScale>
      );
    },
    [handleMemberPress, onSelectMember, palette, renderRoleBadge]
  );

  const renderTreeItem = useCallback(
    ({ item: node }: { item: HierarchyTreeNode<PersonProfile> }) => {
      const item = node.item;
      const initial = item.name ? item.name[0].toUpperCase() : 'U';
      const hasChildren = node.children.length > 0;
      const isExpanded = expandedIds.has(item.id);
      const indent = node.depth * 20;
      const isActionable = Boolean(onSelectMember);

      return (
        <View style={[styles.treeRowContainer, { paddingLeft: indent }]}>
          <PressableScale
            accessibilityLabel={`Team member: ${item.name}, ${item.title || item.hierarchyRole || 'User'}`}
            accessibilityRole={isActionable ? 'button' : 'none'}
            disabled={!isActionable}
            onPress={() => handleMemberPress(item)}
            style={[
              styles.treeCard,
              { backgroundColor: palette.card, borderColor: palette.border },
            ]}
          >
            {hasChildren ? (
              <Pressable
                accessibilityLabel={`${isExpanded ? 'Collapse' : 'Expand'} reports for ${item.name}`}
                accessibilityRole="button"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={() => toggleExpand(item.id)}
                style={styles.expandToggle}
              >
                <Icon
                  color={palette.primary}
                  name={isExpanded ? 'chevron-down' : 'chevron-right'}
                  size={16}
                />
              </Pressable>
            ) : (
              <View style={styles.expandPlaceholder} />
            )}

            <View style={[styles.treeAvatar, { backgroundColor: palette.primary }]}>
              <Text style={[styles.treeAvatarText, { color: palette.onPrimary }]}>{initial}</Text>
            </View>

            <View style={styles.personInfo}>
              <View style={styles.personHeader}>
                <Text style={[styles.personName, { color: palette.foreground }]}>{item.name}</Text>
                {renderRoleBadge(item)}
              </View>
              <Text style={[styles.personEmail, { color: palette.muted }]}>{item.email}</Text>
              {item.title ? (
                <Text style={[styles.personTitle, { color: palette.muted }]}>{item.title}</Text>
              ) : null}
              {hasChildren ? (
                <Text style={[styles.directReportsCount, { color: palette.primary }]}>
                  {node.children.length} direct {node.children.length === 1 ? 'report' : 'reports'}
                </Text>
              ) : null}
            </View>
          </PressableScale>
        </View>
      );
    },
    [expandedIds, handleMemberPress, onSelectMember, palette, renderRoleBadge, toggleExpand]
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* Header */}
      <ScreenHeader
        backLabel="‹ Dashboard"
        onBack={onBack}
        palette={palette}
        title="Team & Org Tree"
      />

      {/* View Mode Segmented Controls */}
      <View style={styles.toolbarRow}>
        <View style={[styles.segmentedContainer, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Pressable
            accessibilityLabel="Switch to Org Tree View"
            accessibilityRole="tab"
            accessibilityState={{ selected: viewMode === 'tree' }}
            onPress={() => setViewMode('tree')}
            style={[
              styles.segmentBtn,
              viewMode === 'tree' && { backgroundColor: palette.primary },
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                viewMode === 'tree' ? [styles.segmentTextActive, { color: palette.onPrimary }] : { color: palette.foreground },
              ]}
            >
              Org Tree
            </Text>
          </Pressable>

          <Pressable
            accessibilityLabel="Switch to Directory View"
            accessibilityRole="tab"
            accessibilityState={{ selected: viewMode === 'directory' }}
            onPress={() => setViewMode('directory')}
            style={[
              styles.segmentBtn,
              viewMode === 'directory' && { backgroundColor: palette.primary },
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                viewMode === 'directory' ? [styles.segmentTextActive, { color: palette.onPrimary }] : { color: palette.foreground },
              ]}
            >
              Directory ({people.length})
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          accessibilityLabel="Search team members"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearch}
          placeholder="Search by name, email, department or title..."
          placeholderTextColor={palette.placeholder}
          style={[
            styles.searchInput,
            { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground },
          ]}
          value={search}
        />
      </View>

      {error ? (
        <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      ) : null}

      {isLoading ? (
        <LoadingState message="Loading organizational hierarchy..." palette={palette} />
      ) : viewMode === 'tree' ? (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={flattenedTreeNodes}
          initialNumToRender={15}
          keyExtractor={(node) => node.item.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              icon="team"
              message="No team members match your filter."
              palette={palette}
            />
          }
          maxToRenderPerBatch={15}
          refreshControl={
            Platform.OS !== 'windows' ? (
              <RefreshControl
                onRefresh={handleRefresh}
                refreshing={isRefreshing}
                tintColor={palette.primary}
              />
            ) : undefined
          }
          removeClippedSubviews={Platform.OS !== 'windows'}
          renderItem={renderTreeItem}
          windowSize={10}
        />
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={filteredPeople}
          initialNumToRender={15}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              icon="team"
              message="No team members found."
              palette={palette}
            />
          }
          maxToRenderPerBatch={15}
          refreshControl={
            Platform.OS !== 'windows' ? (
              <RefreshControl
                onRefresh={handleRefresh}
                refreshing={isRefreshing}
                tintColor={palette.primary}
              />
            ) : undefined
          }
          removeClippedSubviews={Platform.OS !== 'windows'}
          renderItem={renderDirectoryItem}
          windowSize={10}
        />
      )}

      {selectedMember ? (
        <Modal
          animationType="fade"
          transparent
          visible={!!selectedMember}
          onRequestClose={() => setSelectedMember(null)}
        >
          <Pressable
            accessibilityLabel="Dismiss member actions"
            accessibilityRole="button"
            style={styles.modalOverlay}
            onPress={() => setSelectedMember(null)}
          >
            <View
              style={[
                styles.actionModal,
                { backgroundColor: palette.card, borderColor: palette.border },
              ]}
            >
              <Text style={[styles.modalTitle, { color: palette.foreground }]}>
                {selectedMember.name}
              </Text>
              <Text style={[styles.modalSubtitle, { color: palette.placeholder }]}>
                {selectedMember.email} {selectedMember.title ? `• ${selectedMember.title}` : ''}
              </Text>

              <View style={styles.modalButtons}>
                <PressableScale
                  accessibilityLabel={`View Timesheets for ${selectedMember.name}`}
                  accessibilityRole="button"
                  onPress={() => {
                    const member = selectedMember;
                    setSelectedMember(null);
                    onSelectMember?.(member, 'timesheets');
                  }}
                  style={[styles.modalActionBtn, { backgroundColor: palette.primary }]}
                >
                  <Icon name="clock" size={16} color={palette.onPrimary} />
                  <Text style={[styles.modalActionBtnText, { color: palette.onPrimary }]}>View Timesheets</Text>
                </PressableScale>

                <PressableScale
                  accessibilityLabel={`View Reports for ${selectedMember.name}`}
                  accessibilityRole="button"
                  onPress={() => {
                    const member = selectedMember;
                    setSelectedMember(null);
                    onSelectMember?.(member, 'reports');
                  }}
                  style={[
                    styles.modalActionBtn,
                    {
                      backgroundColor: palette.badgeBg,
                      borderColor: palette.border,
                      borderWidth: 1,
                    },
                  ]}
                >
                  <Icon name="reports" size={16} color={palette.foreground} />
                  <Text style={[styles.modalActionBtnText, { color: palette.foreground }]}>
                    View Reports
                  </Text>
                </PressableScale>

                <PressableScale
                  accessibilityLabel="Cancel"
                  accessibilityRole="button"
                  onPress={() => setSelectedMember(null)}
                  style={styles.modalCancelBtn}
                >
                  <Text style={[styles.modalCancelText, { color: palette.muted }]}>Cancel</Text>
                </PressableScale>
              </View>
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbarRow: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  segmentedContainer: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: 3,
    minHeight: 44,
  },
  segmentBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.xs,
  },
  segmentText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  segmentTextActive: {
    fontWeight: '700',
  },
  searchContainer: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  searchInput: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    fontSize: typography.body,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  errorBox: {
    borderRadius: borderRadius.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  personCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
    ...shadows.sm,
  },
  treeRowContainer: {
    marginBottom: spacing.xs,
  },
  treeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    padding: spacing.sm,
    minHeight: 56,
    ...shadows.sm,
  },
  expandToggle: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  expandPlaceholder: {
    width: 28,
    marginRight: 4,
  },
  treeAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  treeAvatarText: { fontSize: 14, fontWeight: '700' },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: { fontSize: 18, fontWeight: '700' },
  personInfo: { flex: 1 },
  personHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  personName: { fontSize: typography.body, fontWeight: '700', flexShrink: 1 },
  personEmail: { fontSize: typography.caption, marginTop: 1 },
  personTitle: { fontSize: typography.badge, marginTop: 2 },
  personDept: { fontSize: typography.badge, marginTop: 1 },
  directReportsCount: { fontSize: typography.badge, fontWeight: '600', marginTop: 2 },
  roleBadge: {
    borderWidth: 1,
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  roleBadgeText: { fontSize: typography.badge, fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  actionModal: {
    width: '100%',
    maxWidth: 360,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing.xl,
    ...shadows.md,
  },
  modalTitle: {
    fontSize: typography.title,
    fontWeight: '700',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: typography.caption,
    marginBottom: spacing.lg,
  },
  modalButtons: {
    gap: spacing.sm,
  },
  modalActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  modalActionBtnText: {
    fontSize: typography.body,
    fontWeight: '700',
  },
  modalCancelBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  modalCancelText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
});
