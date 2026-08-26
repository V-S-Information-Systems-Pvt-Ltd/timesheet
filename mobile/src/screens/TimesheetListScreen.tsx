import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSession } from '../auth/SessionProvider';
import type { TimesheetEntry } from '../api/contracts';
import { colors, spacing, typography } from '../theme';

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

  async function handleDelete(entry: TimesheetEntry) {
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
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable
            accessibilityLabel="Back to dashboard"
            accessibilityRole="button"
            onPress={onBack}
            style={styles.backButton}
          >
            <Text style={[styles.backButtonText, { color: colors.primary }]}>‹ Dashboard</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Log time"
            accessibilityRole="button"
            onPress={onLogTime}
            style={styles.logButton}
          >
            <Text style={styles.logButtonText}>+ Log Time</Text>
          </Pressable>
        </View>
        <Text style={[styles.title, { color: palette.foreground }]}>Timesheets</Text>
      </View>

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
        <View style={styles.centerContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: palette.muted }]}>Loading entries...</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={entries}
          keyExtractor={(item, index) => item.id || String(index)}
          ListEmptyComponent={
            <View style={[styles.emptyCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <Text style={[styles.emptyText, { color: palette.muted }]}>No timesheet entries found.</Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              onRefresh={handleRefresh}
              refreshing={isRefreshing}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => {
            const isDeleting = deletingId === item.id;
            return (
              <View style={[styles.entryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <View style={styles.entryHeader}>
                  <Text style={[styles.entryDate, { color: palette.foreground }]}>{item.log_date}</Text>
                  <View style={styles.entryHeaderRight}>
                    <View style={styles.hoursBadge}>
                      <Text style={styles.hoursText}>{Number(item.hours_worked).toFixed(1)} hrs</Text>
                    </View>
                    {item.user_id === actor?.id ? (
                      <Pressable
                        accessibilityLabel={`Delete entry on ${item.log_date}`}
                        accessibilityRole="button"
                        disabled={isDeleting}
                        onPress={() => handleDelete(item)}
                        style={styles.deleteButton}
                      >
                        {isDeleting ? (
                          <ActivityIndicator color={colors.error} size="small" />
                        ) : (
                          <Text style={styles.deleteButtonText}>✕</Text>
                        )}
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                {(item.work_done || item.notes) ? (
                  <Text numberOfLines={3} style={[styles.entryNotes, { color: palette.muted }]}>
                    {item.work_done || item.notes}
                  </Text>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

function FilterTab({
  label,
  active,
  onPress,
  palette,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  palette: ReturnType<typeof getPalette>;
}) {
  return (
    <Pressable
      accessibilityLabel={`Filter: ${label}`}
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.filterTab,
        active
          ? styles.filterTabActive
          : { backgroundColor: palette.card, borderColor: palette.border },
      ]}
    >
      <Text
        style={[
          styles.filterLabel,
          active ? styles.filterLabelActive : { color: palette.muted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function getPalette(isDarkMode: boolean) {
  return isDarkMode
    ? {
        background: colors.darkBackground,
        foreground: colors.darkForeground,
        muted: colors.darkMuted,
        card: colors.darkCard,
        border: colors.darkBorder,
        errorBoxBg: '#3A1E1E',
      }
    : {
        background: colors.background,
        foreground: colors.foreground,
        muted: colors.muted,
        card: colors.card,
        border: colors.border,
        errorBoxBg: colors.errorLight,
      };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  backButton: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  backButtonText: { fontSize: typography.body, fontWeight: '600' },
  logButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  logButtonText: { color: colors.onPrimary, fontSize: typography.caption, fontWeight: '700' },
  title: {
    fontSize: typography.title,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  filterTab: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  filterTabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterLabel: { fontSize: typography.caption, fontWeight: '600' },
  filterLabelActive: { color: colors.onPrimary },
  errorBox: {
    borderRadius: 10,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: typography.body, marginTop: spacing.md },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  emptyCard: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.xl,
    marginTop: spacing.md,
  },
  emptyText: { fontSize: typography.body },
  entryCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  entryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  entryHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  entryDate: { fontSize: typography.body, fontWeight: '700' },
  hoursBadge: {
    backgroundColor: colors.primaryLight,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  hoursText: { color: colors.primary, fontSize: typography.caption, fontWeight: '700' },
  deleteButton: { padding: spacing.xs },
  deleteButtonText: { color: colors.error, fontSize: 16, fontWeight: '700' },
  entryNotes: { fontSize: typography.caption, marginTop: spacing.xs },
});
