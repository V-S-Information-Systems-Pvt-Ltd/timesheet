import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSessionActor, useSessionActions } from '../auth/SessionProvider';
import type { TimesheetEntry } from '../api/contracts';
import type { FilterUserParam } from '../navigation/navigation-reducer';
import { colors, spacing, typography, borderRadius, shadows, useTheme } from '../theme';

import { TimesheetEntryCard } from '../components/TimesheetEntryCard';
import { EmptyState } from '../components/EmptyState';
import { FilterTab } from '../components/FilterTab';
import { ScreenHeader } from '../components/ScreenHeader';
import { LoadingState } from '../components/LoadingState';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { DateChooserModal } from '../components/DateChooserModal';
import { todayISO, addDaysISO } from '../utils/dates';
import { entryWord, formatEntryCount } from '../utils/plural';
import { isNetworkFailure } from '../auth/domains/types';
import { ApiClientError } from '../api/client';

interface TimesheetListScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
  onLogTime: () => void;
  onEditTime?: (entry: TimesheetEntry) => void;
  filterUser?: FilterUserParam | null;
  onClearFilterUser?: () => void;
}

type FilterRange = 'all' | '7days' | '30days';

const PAGE_SIZE = 25;

export function TimesheetListScreen({
  isDarkMode: _isDarkMode,
  onBack,
  onLogTime,
  onEditTime,
  filterUser,
  onClearFilterUser,
}: TimesheetListScreenProps) {
  const palette = useTheme().palette;
  const { actor, effectiveActor } = useSessionActor();
  const { listTimesheets, deleteTimesheet, deleteTimesheets, duplicateTimesheet, duplicateTimesheets } = useSessionActions();
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
  // Separates "loaded and genuinely empty" from "never loaded / load failed",
  // so a failed read never renders the empty state.
  const [hasLoaded, setHasLoaded] = useState(false);

  // Date-aware duplication modal state
  const [duplicateModalVisible, setDuplicateModalVisible] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState<
    { type: 'single'; entry: TimesheetEntry } | { type: 'bulk'; ids: string[] } | null
  >(null);
  const [isDuplicatingLoading, setIsDuplicatingLoading] = useState(false);

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
    async (selectedFilter: FilterRange, from = 0, isAppend = false, isCurrent: () => boolean = () => true) => {
      if (!isCurrent()) return;
      setError(null);
      try {
        const dateFrom = getDateFromFilter(selectedFilter);
        const result = await listTimesheets({
          userId: filterUser ? filterUser.id : undefined,
          dateFrom,
          limit: PAGE_SIZE,
          from,
          to: from + PAGE_SIZE - 1,
        });

        const rows = result.rows ?? [];
        const total = result.total ?? result.count ?? rows.length;
        if (!isCurrent()) return;
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
        setHasLoaded(true);
      } catch (err) {
        if (!isCurrent()) return;
        // Keep any previously loaded rows visible and surface the failure, so a
        // failed read never renders as an empty list. Raw server payloads are
        // never shown to the user; unexpected transport errors get a generic,
        // actionable message.
        setError(
          isNetworkFailure(err)
            ? 'You appear to be offline. Check your connection and try again.'
            : err instanceof ApiClientError
            ? 'Could not load timesheets. Please try again.'
            : err instanceof Error
            ? err.message
            : 'Could not load timesheets.'
        );
      }
    },
    [listTimesheets, getDateFromFilter, filterUser]
  );

  // Identical requests are coalesced while a request for a different filter or
  // user supersedes the old one. Only the active request may update the screen.
  const nextLoadIdRef = useRef(0);
  const activeLoadRef = useRef<{ id: number; key: string; clearBusy: () => void } | null>(null);
  const runFetch = useCallback(
    async (setBusy: (busy: boolean) => void) => {
      const key = `${filter}:${filterUser?.id ?? ''}:page:0`;
      if (activeLoadRef.current?.key === key) return;

      // A first-page request supersedes an in-flight request for another page,
      // filter, or user. Clear that request's busy indicator immediately; its
      // stale response is still ignored by the id guard below.
      activeLoadRef.current?.clearBusy();

      const id = ++nextLoadIdRef.current;
      const clearBusy = () => setBusy(false);
      activeLoadRef.current = { id, key, clearBusy };
      const isCurrent = () => activeLoadRef.current?.id === id;
      setBusy(true);
      try {
        await fetchEntries(filter, 0, false, isCurrent);
      } finally {
        if (isCurrent()) {
          activeLoadRef.current = null;
          clearBusy();
        }
      }
    },
    [fetchEntries, filter, filterUser?.id]
  );

  useEffect(() => {
    runFetch(setIsLoading);
  }, [filter, runFetch]);

  // Pull-to-refresh does not exist on Windows and a long-idle screen can hold a
  // stale page, so refresh when the app returns to the foreground; the header
  // also exposes an explicit refresh action and failed loads can be retried.
  // The request key covers the initial load, retry, refresh, foreground refetch,
  // and pagination so stale responses cannot overwrite a new filter selection.

  useEffect(() => {
    const appState = AppState as { addEventListener?: unknown } | undefined;
    if (typeof appState?.addEventListener !== 'function') {
      return;
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // fetchEntries handles its own errors, so the promise needs no handler.
        runFetch(() => {});
      }
    });
    return () => {
      if (typeof subscription?.remove === 'function') subscription.remove();
    };
  }, [filter, runFetch]);

  const handleRetry = useCallback(() => runFetch(setIsLoading), [runFetch]);

  const handleRefresh = useCallback(() => runFetch(setIsRefreshing), [runFetch]);

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || isLoading || entries.length >= totalCount || activeLoadRef.current) return;
    const id = ++nextLoadIdRef.current;
    const clearBusy = () => setIsLoadingMore(false);
    activeLoadRef.current = {
      id,
      key: `${filter}:${filterUser?.id ?? ''}:page:${entries.length}`,
      clearBusy,
    };
    const isCurrent = () => activeLoadRef.current?.id === id;
    setIsLoadingMore(true);
    try {
      await fetchEntries(filter, entries.length, true, isCurrent);
    } finally {
      if (isCurrent()) {
        activeLoadRef.current = null;
        clearBusy();
      }
    }
  }, [isLoadingMore, isLoading, entries.length, totalCount, fetchEntries, filter, filterUser?.id]);

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

  const handleDuplicate = useCallback((entry: TimesheetEntry) => {
    setDuplicateTarget({ type: 'single', entry });
    setDuplicateModalVisible(true);
  }, []);

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
      `Are you sure you want to delete ${count} selected ${entryWord(count)}?`,
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

            try {
              const res = await deleteTimesheets(idsToDelete);
              deletedCount = res.deletedCount;
              for (const r of res.results) {
                if (!r.success && r.error) {
                  errors.push(r.error);
                }
              }
            } catch (err) {
              errors.push(err instanceof Error ? err.message : 'Failed to delete entries');
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
  }, [selectedIds, deleteTimesheets, handleExitSelection]);

  const handleBulkDuplicate = useCallback(() => {
    if (selectedIds.size === 0) return;
    setDuplicateTarget({ type: 'bulk', ids: Array.from(selectedIds) });
    setDuplicateModalVisible(true);
  }, [selectedIds]);

  const handleConfirmDuplicate = useCallback(
    async (targetDate: string) => {
      if (!duplicateTarget) return;
      setIsDuplicatingLoading(true);

      if (duplicateTarget.type === 'single') {
        const entry = duplicateTarget.entry;
        setDuplicatingId(entry.id);
        try {
          const newEntry = await duplicateTimesheet(entry.id, targetDate);
          setEntries((prev) => [newEntry, ...prev]);
          setTotalCount((c) => c + 1);
          setDuplicateModalVisible(false);
          setDuplicateTarget(null);
        } catch (err) {
          Alert.alert('Error', err instanceof Error ? err.message : 'Could not duplicate entry.');
        } finally {
          setDuplicatingId(null);
          setIsDuplicatingLoading(false);
        }
      } else if (duplicateTarget.type === 'bulk') {
        setIsBulkOperating(true);
        const idsToDuplicate = duplicateTarget.ids;
        const duplicatedEntries: TimesheetEntry[] = [];
        const errors: string[] = [];

        try {
          const res = await duplicateTimesheets(
            idsToDuplicate.map((id) => ({ id, targetDate }))
          );
          for (const r of res.results) {
            if (r.success && r.entry) {
              duplicatedEntries.push(r.entry);
            } else if (!r.success && r.error) {
              errors.push(r.error);
            }
          }
        } catch (err) {
          errors.push(err instanceof Error ? err.message : 'Failed to duplicate entries');
        }

        if (duplicatedEntries.length > 0) {
          setEntries((prev) => [...duplicatedEntries, ...prev]);
          setTotalCount((c) => c + duplicatedEntries.length);
        }
        setIsBulkOperating(false);
        setIsDuplicatingLoading(false);
        setDuplicateModalVisible(false);
        setDuplicateTarget(null);
        handleExitSelection();

        if (errors.length > 0) {
          Alert.alert(
            'Bulk Duplicate Result',
            `Duplicated ${duplicatedEntries.length} entries. Errors:\n${errors.join('\n')}`
          );
        }
      }
    },
    [duplicateTarget, duplicateTimesheet, duplicateTimesheets, handleExitSelection]
  );

  const handleCancelDuplicate = useCallback(() => {
    if (isDuplicatingLoading) return;
    setDuplicateModalVisible(false);
    setDuplicateTarget(null);
  }, [isDuplicatingLoading]);

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
          <Text style={[styles.cancelSelectionText, { color: palette.primary }]}>Done</Text>
        </Pressable>
      );
    }

    return (
      <View style={styles.headerActionRow}>
        {Platform.OS === 'windows' ? (
          <Pressable
            accessibilityLabel="Refresh timesheets"
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={handleRefresh}
            style={styles.selectBtn}
          >
            <Text style={[styles.selectBtnText, { color: palette.foreground }]}>
              {isRefreshing ? 'Refreshing' : 'Refresh'}
            </Text>
          </Pressable>
        ) : null}
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
          style={[styles.logButton, { backgroundColor: palette.primary }]}
        >
          <Text style={[styles.logButtonText, { color: palette.onPrimary }]}>+ Log</Text>
        </PressableScale>
      </View>
    );
  }, [isSelectionMode, entries.length, handleExitSelection, handleRefresh, isRefreshing, onLogTime, palette.foreground, palette.primary, palette.onPrimary]);

  const listFooter = useMemo(() => {
    if (!isLoadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator color={palette.primary} size="small" />
        <Text style={[styles.footerText, { color: palette.muted }]}>Loading more entries...</Text>
      </View>
    );
  }, [isLoadingMore, palette.muted, palette.primary]);

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* Header */}
      <ScreenHeader
        backLabel="‹ Dashboard"
        onBack={onBack}
        palette={palette}
        rightAction={rightHeaderAction}
        subtitle={totalCount > 0 ? `${formatEntryCount(totalCount)} logged` : undefined}
        title="Timesheets"
      />

      {filterUser ? (
        <View
          style={[
            styles.filterBanner,
            { backgroundColor: palette.badgeBg, borderColor: palette.border },
          ]}
        >
          <View style={styles.filterBannerContent}>
            <Icon name="team" size={16} color={palette.primary} />
            <Text style={[styles.filterBannerText, { color: palette.foreground }]}>
              Filtered by: <Text style={styles.filterBannerName}>{filterUser.name || filterUser.email}</Text>
            </Text>
          </View>
          {onClearFilterUser ? (
            <PressableScale
              accessibilityLabel="Clear member filter"
              accessibilityRole="button"
              onPress={onClearFilterUser}
              style={styles.clearFilterBtn}
            >
              <Text style={[styles.clearFilterText, { color: palette.primary }]}>Clear</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}

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
            <Text style={[styles.toolbarSelectAllText, { color: palette.primary }]}>
              {selectedIds.size === entries.length ? 'Deselect All' : 'Select All'}
            </Text>
          </Pressable>

          <Text style={[styles.toolbarCount, { color: palette.muted }]}>
            {selectedIds.size} of {entries.length} selected
          </Text>

          <View style={styles.toolbarActions}>
            {isBulkOperating ? (
              <ActivityIndicator color={palette.primary} size="small" />
            ) : (
              <>
                <Pressable
                  accessibilityLabel={`Duplicate ${selectedIds.size} selected ${entryWord(selectedIds.size)}`}
                  accessibilityRole="button"
                  disabled={selectedIds.size === 0}
                  onPress={handleBulkDuplicate}
                  style={[styles.toolbarBtn, selectedIds.size === 0 && styles.toolbarBtnDisabled]}
                >
                  <Icon color={selectedIds.size > 0 ? palette.primary : palette.muted} name="plus" size={14} />
                  <Text
                    style={[
                      styles.toolbarBtnText,
                      { color: selectedIds.size > 0 ? palette.primary : palette.muted },
                    ]}
                  >
                    Copy ({selectedIds.size})
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityLabel={`Delete ${selectedIds.size} selected ${entryWord(selectedIds.size)}`}
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

      {error && entries.length > 0 ? (
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
            error || !hasLoaded ? (
              <View style={styles.loadErrorState}>
                <Text style={[styles.loadErrorTitle, { color: palette.foreground }]}>
                  Could not load timesheets
                </Text>
                {error ? (
                  <Text style={[styles.loadErrorText, { color: palette.muted }]}>{error}</Text>
                ) : null}
                <PressableScale
                  accessibilityLabel="Retry loading timesheets"
                  accessibilityRole="button"
                  onPress={handleRetry}
                  style={[styles.retryButton, { backgroundColor: palette.primary }]}
                >
                  <Text style={[styles.retryButtonText, { color: palette.onPrimary }]}>Try Again</Text>
                </PressableScale>
              </View>
            ) : (
              <EmptyState
                actionLabel="+ Log Time"
                icon="clock"
                message="No timesheet entries found."
                onAction={onLogTime}
                palette={palette}
              />
            )
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
                tintColor={palette.primary}
              />
            ) : undefined
          }
          removeClippedSubviews={Platform.OS !== 'windows'}
          renderItem={renderItem}
          windowSize={5}
        />
      )}

      <DateChooserModal
        initialDate={
          duplicateTarget?.type === 'single'
            ? duplicateTarget.entry.log_date
            : todayISO()
        }
        isLoading={isDuplicatingLoading}
        onCancel={handleCancelDuplicate}
        onConfirm={handleConfirmDuplicate}
        palette={palette}
        subtitle={
          duplicateTarget?.type === 'single'
            ? `Duplicate ${duplicateTarget.entry.hours_worked}h from ${duplicateTarget.entry.log_date}`
            : duplicateTarget?.type === 'bulk'
            ? `Duplicate ${duplicateTarget.ids.length} selected entries`
            : undefined
        }
        title={
          duplicateTarget?.type === 'bulk'
            ? `Duplicate ${duplicateTarget.ids.length} Entries`
            : 'Duplicate Timesheet'
        }
        visible={duplicateModalVisible}
      />
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
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 36,
    justifyContent: 'center',
    ...shadows.sm,
  },
  logButtonText: { fontSize: typography.caption, fontWeight: '700' },
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
  loadErrorState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  loadErrorTitle: { fontSize: typography.body, fontWeight: '700' },
  loadErrorText: { fontSize: typography.caption, textAlign: 'center' },
  retryButton: {
    borderRadius: borderRadius.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    ...shadows.sm,
  },
  retryButtonText: { fontSize: typography.caption, fontWeight: '700' },
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
  filterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  filterBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  filterBannerText: {
    fontSize: typography.caption,
  },
  filterBannerName: {
    fontWeight: '700',
  },
  clearFilterBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  clearFilterText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
