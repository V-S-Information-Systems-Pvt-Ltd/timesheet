import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
}

type FilterRange = 'all' | '7days' | '30days';

export function TimesheetListScreen({ isDarkMode, onBack }: TimesheetListScreenProps) {
  const palette = getPalette(isDarkMode);
  const { listTimesheets } = useSession();
  const [filter, setFilter] = useState<FilterRange>('all');
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
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

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back to dashboard"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.backButton}
        >
          <Text style={[styles.backButtonText, { color: colors.primary }]}>‹ Dashboard</Text>
        </Pressable>
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
          label="Last 7 Days"
          onPress={() => setFilter('7days')}
          palette={palette}
        />
        <FilterTab
          active={filter === '30days'}
          label="Last 30 Days"
          onPress={() => setFilter('30days')}
          palette={palette}
        />
      </View>

      {error ? (
        <View
          accessibilityRole="alert"
          style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}
        >
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: palette.muted }]}>Loading timesheets...</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={entries}
          keyExtractor={(item, index) => item.id || String(index)}
          ListEmptyComponent={
            <View
              style={[
                styles.emptyCard,
                { backgroundColor: palette.card, borderColor: palette.border },
              ]}
            >
              <Text style={[styles.emptyText, { color: palette.muted }]}>
                No timesheet entries found for this range.
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              onRefresh={handleRefresh}
              refreshing={isRefreshing}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.entryCard,
                { backgroundColor: palette.card, borderColor: palette.border },
              ]}
            >
              <View style={styles.entryHeader}>
                <Text style={[styles.entryDate, { color: palette.foreground }]}>
                  {item.log_date}
                </Text>
                <View style={styles.hoursBadge}>
                  <Text style={styles.hoursText}>
                    {Number(item.hours_worked).toFixed(1)} hrs
                  </Text>
                </View>
              </View>
              {item.notes ? (
                <Text style={[styles.entryNotes, { color: palette.muted }]}>{item.notes}</Text>
              ) : null}
              {item.status ? (
                <View style={styles.entryFooter}>
                  <Text style={[styles.statusText, { color: palette.muted }]}>
                    Status: {item.status}
                  </Text>
                </View>
              ) : null}
            </View>
          )}
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
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.filterTab,
        {
          backgroundColor: active ? colors.primary : palette.card,
          borderColor: active ? colors.primary : palette.border,
        },
      ]}
    >
      <Text
        style={[
          styles.filterTabText,
          { color: active ? colors.onPrimary : palette.foreground },
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
  backButton: { alignSelf: 'flex-start', marginBottom: spacing.xs, paddingVertical: spacing.xs },
  backButtonText: { fontSize: typography.body, fontWeight: '600' },
  title: { fontSize: typography.title, fontWeight: '800', letterSpacing: -0.5 },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  filterTab: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  filterTabText: { fontSize: typography.caption, fontWeight: '700' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  loadingContainer: { alignItems: 'center', marginVertical: spacing.xxl },
  loadingText: { fontSize: typography.body, marginTop: spacing.md },
  errorBox: {
    borderRadius: 10,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
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
  entryDate: { fontSize: typography.body, fontWeight: '700' },
  hoursBadge: {
    backgroundColor: colors.primaryLight,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  hoursText: { color: colors.primary, fontSize: typography.caption, fontWeight: '700' },
  entryNotes: { fontSize: typography.caption, marginTop: spacing.xs },
  entryFooter: { marginTop: spacing.xs },
  statusText: { fontSize: typography.badge, fontStyle: 'italic' },
});
