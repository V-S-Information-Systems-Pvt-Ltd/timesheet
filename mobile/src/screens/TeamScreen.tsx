import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSessionActions } from '../auth/SessionProvider';
import type { PersonProfile } from '../api/contracts';
import { spacing, typography, borderRadius, useTheme } from '../theme';

import { ScreenHeader } from '../components/ScreenHeader';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { Chip } from '../components/Chip';
import { buildHierarchyTree, type HierarchyTreeNode } from '@vsis/core';
import { useModalBounds } from '../utils/modal-layout';

interface TeamScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
  onSelectMember?: (member: PersonProfile, destination: 'timesheets' | 'reports') => void;
}

type TeamViewMode = 'tree' | 'directory';

export function TeamScreen({ isDarkMode: _isDarkMode, onBack, onSelectMember }: TeamScreenProps) {
  const palette = useTheme().palette;
  const bounds = useModalBounds(420, 520);
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

  const roleLabel = useCallback((item: PersonProfile) => {
    switch (item.hierarchyRole) {
      case 'manager':
        return 'Manager';
      case 'team_lead':
        return 'Team lead';
      case 'engineer':
        return 'Engineer';
      default:
        return '';
    }
  }, []);

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
      const isActionable = Boolean(onSelectMember);
      const subtitle = item.title || roleLabel(item);

      return (
        <PressableScale
          accessibilityLabel={`Team member: ${item.name}`}
          accessibilityRole={isActionable ? 'button' : 'none'}
          disabled={!isActionable}
          onPress={() => handleMemberPress(item)}
          scaleTo={1}
          style={[styles.personRow, { borderBottomColor: palette.hairline }]}
        >
          <View style={styles.personInfo}>
            <Text style={[styles.personName, { color: palette.foreground }]}>{item.name}</Text>
            {subtitle ? <Text style={[styles.personMeta, { color: palette.muted }]}>{subtitle}</Text> : null}
            <Text style={[styles.personMeta, { color: palette.muted }]}>{item.email}</Text>
            {item.department ? (
              <Text style={[styles.personMeta, { color: palette.muted }]}>{item.department}</Text>
            ) : null}
          </View>
        </PressableScale>
      );
    },
    [handleMemberPress, onSelectMember, palette, roleLabel]
  );

  const renderTreeItem = useCallback(
    ({ item: node }: { item: HierarchyTreeNode<PersonProfile> }) => {
      const item = node.item;
      const hasChildren = node.children.length > 0;
      const isExpanded = expandedIds.has(item.id);
      const indent = node.depth * 20;
      const isActionable = Boolean(onSelectMember);
      const subtitle = item.title || roleLabel(item);

      return (
        <PressableScale
          accessibilityLabel={`Team member: ${item.name}, ${item.title || item.hierarchyRole || 'User'}`}
          accessibilityRole={isActionable ? 'button' : 'none'}
          disabled={!isActionable}
          onPress={() => handleMemberPress(item)}
          scaleTo={1}
          style={[styles.personRow, { borderBottomColor: palette.hairline, paddingLeft: indent }]}
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
                color={palette.muted}
                name={isExpanded ? 'chevron-down' : 'chevron-right'}
                size={16}
              />
            </Pressable>
          ) : (
            <View style={styles.expandToggle} />
          )}

          <View style={styles.personInfo}>
            <Text style={[styles.personName, { color: palette.foreground }]}>{item.name}</Text>
            {subtitle ? <Text style={[styles.personMeta, { color: palette.muted }]}>{subtitle}</Text> : null}
          </View>
          {hasChildren ? (
            <Text style={[styles.directReportsCount, { color: palette.muted }]}>
              {node.children.length} {node.children.length === 1 ? 'report' : 'reports'}
            </Text>
          ) : null}
        </PressableScale>
      );
    },
    [expandedIds, handleMemberPress, onSelectMember, palette, roleLabel, toggleExpand]
  );

  const refreshControl =
    Platform.OS !== 'windows' ? (
      <RefreshControl
        onRefresh={handleRefresh}
        refreshing={isRefreshing}
        tintColor={palette.primary}
      />
    ) : undefined;

  return (
    <View style={[styles.container, { backgroundColor: palette.paper }]}>
      <ScreenHeader
        backLabel="‹ Dashboard"
        onBack={onBack}
        palette={palette}
        title="Team"
      />

      <View style={styles.toolbarRow}>
        <Chip
          accessibilityLabel="Switch to Org Tree View"
          accessibilityRole="tab"
          active={viewMode === 'tree'}
          label="Org tree"
          onPress={() => setViewMode('tree')}
          palette={palette}
        />
        <Chip
          accessibilityLabel="Switch to Directory View"
          accessibilityRole="tab"
          active={viewMode === 'directory'}
          label={`Directory (${people.length})`}
          onPress={() => setViewMode('directory')}
          palette={palette}
        />
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          accessibilityLabel="Search team members"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearch}
          placeholder="Search by name, email, department or title"
          placeholderTextColor={palette.placeholder}
          style={[
            styles.searchInput,
            { borderColor: palette.controlBorder, color: palette.foreground },
          ]}
          value={search}
        />
      </View>

      {error ? (
        <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
          <Text style={[styles.errorText, { color: palette.error }]}>{error}</Text>
        </View>
      ) : null}

      <View style={[styles.sheet, { backgroundColor: palette.sheet }]}>
        {isLoading ? (
          <LoadingState message="Loading your team..." palette={palette} />
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
                message="No team members match your search. Try a different name or clear the search."
                palette={palette}
              />
            }
            maxToRenderPerBatch={15}
            refreshControl={refreshControl}
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
                message="No team members found. Try a different name or clear the search."
                palette={palette}
              />
            }
            maxToRenderPerBatch={15}
            refreshControl={refreshControl}
            removeClippedSubviews={Platform.OS !== 'windows'}
            renderItem={renderDirectoryItem}
            windowSize={10}
          />
        )}
      </View>

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
            style={[styles.modalOverlay, bounds]}
            onPress={() => setSelectedMember(null)}
          >
            <ScrollView
              style={styles.modalScroll}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[
                styles.actionModal,
                { backgroundColor: palette.sheet, borderColor: palette.hairline },
              ]}
            >
              <Text style={[styles.modalTitle, { color: palette.foreground }]}>
                {selectedMember.name}
              </Text>
              <Text style={[styles.modalSubtitle, { color: palette.muted }]}>
                {selectedMember.title ? `${selectedMember.email}, ${selectedMember.title}` : selectedMember.email}
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
                  <Text style={[styles.modalActionBtnText, { color: palette.onPrimary }]}>View timesheets</Text>
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
                    styles.outlined,
                    { borderColor: palette.controlBorder },
                  ]}
                >
                  <Icon name="reports" size={16} color={palette.foreground} />
                  <Text style={[styles.modalActionBtnText, { color: palette.foreground }]}>
                    View reports
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
            </ScrollView>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sheet: {
    flex: 1,
    borderTopLeftRadius: borderRadius.sheet,
    borderTopRightRadius: borderRadius.sheet,
    overflow: 'hidden',
  },
  toolbarRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  searchContainer: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  searchInput: {
    borderRadius: borderRadius.control,
    borderWidth: 1,
    fontSize: typography.body,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  errorBox: {
    borderRadius: borderRadius.control,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  expandToggle: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  personInfo: { flex: 1 },
  personName: { fontSize: typography.body, fontWeight: '600' },
  personMeta: { fontSize: typography.caption, marginTop: 2 },
  directReportsCount: { fontSize: typography.caption, marginLeft: spacing.sm },
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
    borderRadius: borderRadius.sheet,
    borderWidth: 1,
    padding: spacing.xl,
  },
  modalScroll: {
    flexGrow: 0,
    flexShrink: 1,
    width: '100%',
    maxWidth: 360,
  },
  modalTitle: {
    fontSize: typography.subtitle,
    fontWeight: '600',
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
    minHeight: 52,
    borderRadius: borderRadius.control,
  },
  outlined: { borderWidth: 1 },
  modalActionBtnText: {
    fontSize: typography.body,
    fontWeight: '600',
  },
  modalCancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: spacing.xs,
  },
  modalCancelText: {
    fontSize: typography.body,
    fontWeight: '600',
  },
});
