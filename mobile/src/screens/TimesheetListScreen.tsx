import React, { useCallback, useEffect, useState } from 'react';
import {
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
}

type FilterRange = 'all' | '7days' | '30days';

export function TimesheetListScreen({ isDarkMode, onBack, onLogTime }: TimesheetListScreenProps) {
  const palette = getPalette(isDarkMode);
  const { actor, listTimesheets, deleteTimesheet } = useSession();
  const [filter, setFilter] = useState<FilterRange>('all');
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(
    async (selectedFilter: FilterRange) => {
      setError(null);
      try {
        let dateFrom: string | undefined;
        const now = new Date();
        if (selectedFilter === '7days') {
          const past = new Date(now);
          past.setUTCDate(past.getUTCDate() - 6);
          dateFrom = past.toISOString().slice(0, 10);
        } else if (selectedFilter === '30days') {
          const past = new Date(now);
          past.setUTCDate(past.getUTCDate() - 29);
          dateFrom = past.toISOString().slice(0, 10);
        }

        const result = await listTimesheets({
          dateFrom,
          limit: 50,
        });
        setEntries(result.rows ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load timesheets.');
      }
    },
    [listTimesheets]
  );

  useEffect(() => {
    let mounted = true;
    async function load() {
      setIsLoading(true);
      await fetchEntries(filter);
      if (mounted) setIsLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [filter, fetchEntries]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await fetchEntries(filter);
    setIsRefreshing(false);
  }

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
              setDeletingId(entry.id);
              try {
                await deleteTimesheet(entry.id);
                await fetchEntries(filter);
              } catch (err) {
                Alert.alert('Error', err instanceof Error ? err.message : 'Could not delete entry.');
              } finally {
                setDeletingId(null);
              }
            },
          },
        ]
      );
    },
    [deleteTimesheet, fetchEntries, filter]
  );

  const keyExtractor = useCallback((item: TimesheetEntry, index: number) => item.id || String(index), []);

  const renderItem = useCallback(
    ({ item }: { item: TimesheetEntry }) => (
      <TimesheetEntryCard
        entry={item}
        isDeleting={deletingId === item.id}
        canDelete={item.user_id === actor?.id}
        onDelete={handleDelete}
        palette={palette}
      />
    ),
    [actor?.id, deletingId, handleDelete, palette]
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

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* Header */}
      <ScreenHeader
        title="Timesheets"
        onBack={onBack}
        backLabel="‹ Dashboard"
        rightAction={logTimeAction}
        palette={palette}
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
          maxToRenderPerBatch={10}
          windowSize={5}
          keyExtractor={keyExtractor}
          ListEmptyComponent={
            <EmptyState
              icon="📋"
              message="No timesheet entries found."
              actionLabel="+ Log Time"
              onAction={onLogTime}
              palette={palette}
            />
          }
          refreshControl={
            <RefreshControl
              onRefresh={handleRefresh}
              refreshing={isRefreshing}
              tintColor={colors.primary}
            />
          }
          renderItem={renderItem}
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
});
