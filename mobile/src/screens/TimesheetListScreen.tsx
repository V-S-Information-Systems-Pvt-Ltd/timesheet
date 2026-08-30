import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSession } from '../auth/SessionProvider';
import type { TimesheetEntry } from '../api/contracts';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';

import { TimesheetEntryCard } from '../components/TimesheetEntryCard';
import { EmptyState } from '../components/EmptyState';
import { FilterTab } from '../components/FilterTab';
import { ScreenHeader } from '../components/ScreenHeader';
import { LoadingState } from '../components/LoadingState';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { todayISO, addDaysISO } from '../utils/dates';

interface TimesheetListScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
  onLogTime: () => void;
  onEditTime?: (entry: TimesheetEntry) => void;
}

type FilterRange = 'all' | '7days' | '30days';

const PAGE_SIZE = 25;

export function TimesheetListScreen({
  isDarkMode,
  onBack,
  onLogTime,
  onEditTime,
}: TimesheetListScreenProps) {
  const palette = getPalette(isDarkMode);
  const { actor, effectiveActor, listTimesheets, deleteTimesheet, duplicateTimesheet } = useSession();
  const currentActor = effectiveActor || actor;

  const [filter, setFilter] = useState<FilterRange>('all');
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Multi-select state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkOperating, setIsBulkOperating] = useState(false);

  const getDateFromFilter = useCallback((selectedFilter: FilterRange): string | undefined => {
    const today = todayISO();
    if (selectedFilter === '7days') {
      return addDaysISO(today, -6);
    } else if (selectedFilter === '30days') {
      return addDaysISO(today, -29);
    }
    return undefined;
  }, []);

  const fetchEntries = useCallback(
    async (selectedFilter: FilterRange, from = 0, isAppend = false) => {
      setError(null);
      try {
        const dateFrom = getDateFromFilter(selectedFilter);
        const result = await listTimesheets({
          dateFrom,
          limit: PAGE_SIZE,
          from,
          to: from + PAGE_SIZE - 1,
        });

        const rows = result.rows ?? [];
        const total = result.total ?? result.count ?? rows.length;
        setTotalCount(total);

        if (isAppend) {
          setEntries((prev) => {
            const existingIds = new Set(prev.map((e) => e.id));
            const newRows = rows.filter((r) => !existingIds.has(r.id));
            return [...prev, ...newRows];
          });
        } else {
          setEntries(rows);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load timesheets.');
      }
    },
    [listTimesheets, getDateFromFilter]
  );

  useEffect(() => {
    let mounted = true;
    async function load() {
      setIsLoading(true);
      await fetchEntries(filter, 0, false);
      if (mounted) setIsLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [filter, fetchEntries]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await fetchEntries(filter, 0, false);
    setIsRefreshing(false);
  }

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || isLoading || entries.length >= totalCount) return;
    setIsLoadingMore(true);
    await fetchEntries(filter, entries.length, true);
    setIsLoadingMore(false);
  }, [isLoadingMore, isLoading, entries.length, totalCount, fetchEntries, filter]);

  const handleDelete = useCallback(
    async (entry: TimesheetEntry) => {
      Alert.alert(
        'Delete Entry',
        `Are you sure you want to delete the ${entry.hours_worked}h entry on ${entry.log_date}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              const previousEntries = entries;
              setEntries((prev) => prev.filter((e) => e.id !== entry.id));
              setDeletingId(entry.id);
              try {
                await deleteTimesheet(entry.id);
                setTotalCount((c) => Math.max(0, c - 1));
              } catch (err) {
                setEntries(previousEntries);
                Alert.alert('Error', err instanceof Error ? err.message : 'Could not delete entry.');
              } finally {
                setDeletingId(null);
              }
            },
          },
        ]
      );
    },
    [deleteTimesheet, entries]
  );

  const handleDuplicate = useCallback(
    async (entry: TimesheetEntry) => {
      setDuplicatingId(entry.id);
      try {
        const newEntry = await duplicateTimesheet(entry.id);
        // Prepend duplicated entry optimistically
        setEntries((prev) => [newEntry, ...prev]);
        setTotalCount((c) => c + 1);
      } catch (err) {
        Alert.alert('Error', err instanceof Error ? err.message : 'Could not duplicate entry.');
      } finally {
        setDuplicatingId(null);
      }
    },
    [duplicateTimesheet]
  );

  const canManageEntry = useCallback(
    (entry: TimesheetEntry) => {
      if (!currentActor) return true;
      const isOwner = entry.user_id === currentActor.id;
      const isAdmin = currentActor.role === 'admin' || currentActor.permissionRole === 'admin';
      return isOwner || isAdmin;
    },
    [currentActor]
  );

  // Multi-select handlers
  const handleToggleSelect = useCallback((entry: TimesheetEntry) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entry.id)) {
        next.delete(entry.id);
      } else {
        next.add(entry.id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map((e) => e.id)));
    }
  }, [entries, selectedIds.size]);

  const handleExitSelection = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    Alert.alert(
      'Bulk Delete',
      `Are you sure you want to delete ${count} selected ${count === 1 ? 'entry' : 'entries'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsBulkOperating(true);
            const idsToDelete = Array.from(selectedIds);
            let deletedCount = 0;
            const errors: string[] = [];

            for (const id of idsToDelete) {
              try {
                await deleteTimesheet(id);
                deletedCount++;
              } catch (err) {
                errors.push(err instanceof Error ? err.message : `Failed to delete ${id}`);
              }
            }

            setEntries((prev) => prev.filter((e) => !selectedIds.has(e.id)));
            setTotalCount((c) => Math.max(0, c - deletedCount));
            setIsBulkOperating(false);
            handleExitSelection();

            if (errors.length > 0) {
              Alert.alert('Bulk Delete Completed with Errors', `Deleted ${deletedCount} entries. Errors:\n${errors.join('\n')}`);
            }
          },
        },
      ]
    );
  }, [selectedIds, deleteTimesheet, handleExitSelection]);

  const handleBulkDuplicate = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setIsBulkOperating(true);
    const idsToDuplicate = Array.from(selectedIds);
    const duplicatedEntries: TimesheetEntry[] = [];
    const errors: string[] = [];

    for (const id of idsToDuplicate) {
      try {
        const newEntry = await duplicateTimesheet(id);
        duplicatedEntries.push(newEntry);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `Failed to duplicate ${id}`);
      }
    }

    if (duplicatedEntries.length > 0) {
      setEntries((prev) => [...duplicatedEntries, ...prev]);
      setTotalCount((c) => c + duplicatedEntries.length);
    }
    setIsBulkOperating(false);
    handleExitSelection();

    if (errors.length > 0) {
      Alert.alert('Bulk Duplicate Result', `Duplicated ${duplicatedEntries.length} entries. Errors:\n${errors.join('\n')}`);
    }
  }, [selectedIds, duplicateTimesheet, handleExitSelection]);

  const keyExtractor = useCallback((item: TimesheetEntry, index: number) => item?.id || String(index), []);

  const renderItem = useCallback(
    ({ item }: { item: TimesheetEntry }) => {
      const allowed = canManageEntry(item);
      const isSelected = selectedIds.has(item.id);

      return (
        <TimesheetEntryCard
          canDelete={allowed}
          canDuplicate={true}
          canEdit={allowed && Boolean(onEditTime)}
          entry={item}
          isDeleting={deletingId === item.id}
          isDuplicating={duplicatingId === item.id}
          isSelected={isSelected}
          isSelectionMode={isSelectionMode}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onEdit={onEditTime ? () => onEditTime(item) : undefined}
          onToggleSelect={handleToggleSelect}
          palette={palette}
        />
      );
    },
    [canManageEntry, deletingId, duplicatingId, handleDelete, handleDuplicate, handleToggleSelect, isSelectionMode, onEditTime, palette, selectedIds]
  );

  const rightHeaderAction = useMemo(() => {
    if (isSelectionMode) {
      return (
        <Pressable
          accessibilityLabel="Done selection"
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={handleExitSelection}
          style={styles.cancelSelectionBtn}
        >
          <Text style={[styles.cancelSelectionText, { color: colors.primary }]}>Done</Text>
        </Pressable>
      );
    }

    return (
      <View style={styles.headerActionRow}>
        {entries.length > 0 ? (
          <Pressable
            accessibilityLabel="Select multiple entries"
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => setIsSelectionMode(true)}
            style={styles.selectBtn}
          >
            <Text style={[styles.selectBtnText, { color: palette.foreground }]}>Select</Text>
          </Pressable>
        ) : null}
        <PressableScale
          accessibilityLabel="Log time"
          accessibilityRole="button"
          onPress={onLogTime}
          style={styles.logButton}
        >
          <Text style={styles.logButtonText}>+ Log</Text>
        </PressableScale>
      </View>
    );
  }, [isSelectionMode, entries.length, handleExitSelection, onLogTime, palette.foreground]);

  const listFooter = useMemo(() => {
    if (!isLoadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator color={colors.primary} size="small" />
        <Text style={[styles.footerText, { color: palette.muted }]}>Loading more entries...</Text>
      </View>
    );
  }, [isLoadingMore, palette.muted]);

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* Header */}
      <ScreenHeader
        backLabel="‹ Dashboard"
        onBack={onBack}
        palette={palette}
        rightAction={rightHeaderAction}
        subtitle={totalCount > 0 ? `${totalCount} entries logged` : undefined}
        title="Timesheets"
      />

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        <FilterTab
          active={filter === 'all'}
          label="All"
          onPress={() => setFilter('all')}
          palette={palette}
        />
        <FilterTab
          active={filter === '7days'}
          label="Past 7 Days"
          onPress={() => setFilter('7days')}
          palette={palette}
        />
        <FilterTab
          active={filter === '30days'}
          label="Past 30 Days"
          onPress={() => setFilter('30days')}
          palette={palette}
        />
      </View>

      {/* Selection Action Toolbar */}
      {isSelectionMode ? (
        <View style={[styles.selectionToolbar, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <Pressable
            accessibilityLabel={selectedIds.size === entries.length ? 'Deselect all' : 'Select all'}
            accessibilityRole="button"
            onPress={handleSelectAll}
            style={styles.toolbarSelectAll}
          >
            <Text style={[styles.toolbarSelectAllText, { color: colors.primary }]}>
              {selectedIds.size === entries.length ? 'Deselect All' : 'Select All'}
            </Text>
          </Pressable>

          <Text style={[styles.toolbarCount, { color: palette.muted }]}>
            {selectedIds.size} of {entries.length} selected
          </Text>

          <View style={styles.toolbarActions}>
            {isBulkOperating ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <>
                <Pressable
                  accessibilityLabel={`Duplicate ${selectedIds.size} selected entries`}
                  accessibilityRole="button"
                  disabled={selectedIds.size === 0}
                  onPress={handleBulkDuplicate}
                  style={[styles.toolbarBtn, selectedIds.size === 0 && styles.toolbarBtnDisabled]}
                >
                  <Icon color={selectedIds.size > 0 ? colors.primary : palette.muted} name="plus" size={14} />
                  <Text
                    style={[
                      styles.toolbarBtnText,
                      { color: selectedIds.size > 0 ? colors.primary : palette.muted },
                    ]}
                  >
                    Copy ({selectedIds.size})
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityLabel={`Delete ${selectedIds.size} selected entries`}
                  accessibilityRole="button"
                  disabled={selectedIds.size === 0}
                  onPress={handleBulkDelete}
                  style={[styles.toolbarBtn, selectedIds.size === 0 && styles.toolbarBtnDisabled]}
                >
                  <Icon color={selectedIds.size > 0 ? colors.error : palette.muted} name="trash" size={14} />
                  <Text
                    style={[
                      styles.toolbarBtnText,
                      { color: selectedIds.size > 0 ? colors.error : palette.muted },
                    ]}
                  >
                    Delete ({selectedIds.size})
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      ) : null}

      {error ? (
        <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      ) : null}

      {isLoading ? (
        <LoadingState message="Loading entries..." palette={palette} />
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={entries}
          initialNumToRender={10}
          keyExtractor={keyExtractor}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              actionLabel="+ Log Time"
              icon="clock"
              message="No timesheet entries found."
              onAction={onLogTime}
              palette={palette}
            />
          }
          ListFooterComponent={listFooter}
          maxToRenderPerBatch={10}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          refreshControl={
            Platform.OS !== 'windows' ? (
              <RefreshControl
                onRefresh={handleRefresh}
                refreshing={isRefreshing}
                tintColor={colors.primary}
              />
            ) : undefined
          }
          removeClippedSubviews={Platform.OS !== 'windows'}
          renderItem={renderItem}
          windowSize={5}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  selectBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 36,
    justifyContent: 'center',
  },
  selectBtnText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  cancelSelectionBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 36,
    justifyContent: 'center',
  },
  cancelSelectionText: {
    fontSize: typography.body,
    fontWeight: '700',
  },
  logButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 36,
    justifyContent: 'center',
    ...shadows.sm,
  },
  logButtonText: { color: colors.onPrimary, fontSize: typography.caption, fontWeight: '700' },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  selectionToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    ...shadows.sm,
  },
  toolbarSelectAll: {
    paddingVertical: spacing.xs,
  },
  toolbarSelectAllText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  toolbarCount: {
    fontSize: typography.badge,
    fontWeight: '600',
  },
  toolbarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toolbarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.xs,
  },
  toolbarBtnDisabled: {
    opacity: 0.5,
  },
  toolbarBtnText: {
    fontSize: typography.badge,
    fontWeight: '700',
  },
  errorBox: {
    borderRadius: borderRadius.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  footerLoader: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  footerText: {
    fontSize: typography.badge,
    fontWeight: '500',
  },
});
