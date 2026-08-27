import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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

  const getDateFromFilter = useCallback((selectedFilter: FilterRange): string | undefined => {
    const now = new Date();
    if (selectedFilter === '7days') {
      const past = new Date(now);
      past.setUTCDate(past.getUTCDate() - 6);
      return past.toISOString().slice(0, 10);
    } else if (selectedFilter === '30days') {
      const past = new Date(now);
      past.setUTCDate(past.getUTCDate() - 29);
      return past.toISOString().slice(0, 10);
    }
    return undefined;
  }, []);

  const fetchEntries = useCallback(
    async (selectedFilter: FilterRange, offset = 0, isAppend = false) => {
      setError(null);
      try {
        const dateFrom = getDateFromFilter(selectedFilter);
        const result = await listTimesheets({
          dateFrom,
          limit: PAGE_SIZE,
          ...(offset > 0 ? { offset } : {}),
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

  const keyExtractor = useCallback((item: TimesheetEntry, index: number) => item?.id || String(index), []);

  const renderItem = useCallback(
    ({ item }: { item: TimesheetEntry }) => {
      const allowed = canManageEntry(item);
      return (
        <TimesheetEntryCard
          canDelete={allowed}
          canDuplicate={true}
          canEdit={allowed && Boolean(onEditTime)}
          entry={item}
          isDeleting={deletingId === item.id}
          isDuplicating={duplicatingId === item.id}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onEdit={onEditTime ? () => onEditTime(item) : undefined}
          palette={palette}
        />
      );
    },
    [canManageEntry, deletingId, duplicatingId, handleDelete, handleDuplicate, onEditTime, palette]
  );

  const logTimeAction = (
    <PressableScale
      accessibilityLabel="Log time"
      accessibilityRole="button"
      onPress={onLogTime}
      style={styles.logButton}
    >
      <Text style={styles.logButtonText}>+ Log Time</Text>
    </PressableScale>
  );

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
        rightAction={logTimeAction}
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
            <RefreshControl
              onRefresh={handleRefresh}
              refreshing={isRefreshing}
              tintColor={colors.primary}
            />
          }
          removeClippedSubviews={true}
          renderItem={renderItem}
          windowSize={5}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  logButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    ...shadows.sm,
  },
  logButtonText: { color: colors.onPrimary, fontSize: typography.caption, fontWeight: '700' },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
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
