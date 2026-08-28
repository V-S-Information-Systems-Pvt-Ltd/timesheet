import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSession } from '../auth/SessionProvider';
import type { ReportTotals, ReportBucketItem } from '../api/contracts';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';

import { ScreenHeader } from '../components/ScreenHeader';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { FilterTab } from '../components/FilterTab';
import { todayISO, addDaysISO } from '../utils/dates';

interface ReportsScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
}

type DatePreset = 'month' | '30days' | '90days';
type GroupBy = 'project' | 'activity';

export function ReportsScreen({ isDarkMode, onBack }: ReportsScreenProps) {
  const palette = getPalette(isDarkMode);
  const { getReports } = useSession();
  const [preset, setPreset] = useState<DatePreset>('month');
  const [groupBy, setGroupBy] = useState<GroupBy>('project');
  const [report, setReport] = useState<ReportTotals>({ totalHours: 0, totalEntries: 0, byGroup: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = useCallback(
    async (selectedPreset: DatePreset, selectedGroup: GroupBy) => {
      setError(null);
      try {
        const to = todayISO();
        let from: string;

        if (selectedPreset === 'month') {
          from = `${to.slice(0, 7)}-01`;
        } else if (selectedPreset === '30days') {
          from = addDaysISO(to, -29);
        } else {
          from = addDaysISO(to, -89);
        }

        const data = await getReports({
          from,
          to,
          groupBy: selectedGroup,
        });
        setReport({
          totalHours: Number(data?.totalHours) || 0,
          totalEntries: Number(data?.totalEntries) || 0,
          byGroup: Array.isArray(data?.byGroup) ? data.byGroup : [],
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not generate report.');
      }
    },
    [getReports]
  );

  useEffect(() => {
    let mounted = true;
    async function load() {
      setIsLoading(true);
      await fetchReports(preset, groupBy);
      if (mounted) setIsLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [preset, groupBy, fetchReports]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await fetchReports(preset, groupBy);
    setIsRefreshing(false);
  }

  const keyExtractor = useCallback((item: ReportBucketItem, index: number) => item.label || `report-${index}`, []);

  const renderItem = useCallback(
    ({ item }: { item: ReportBucketItem }) => {
      const itemHours = Number(item.hours) || 0;
      const totalHours = Number(report?.totalHours) || 0;
      const pct = totalHours > 0 ? Math.min(100, Math.max(0, (itemHours / totalHours) * 100)) : 0;
      const entriesCount = Number(item.entries) || 0;

      return (
        <View style={[styles.itemCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.itemHeader}>
            <Text numberOfLines={1} style={[styles.itemName, { color: palette.foreground }]}>
              {item.label || 'Unknown'}
            </Text>
            <Text style={[styles.itemHours, { color: colors.primary }]}>{itemHours.toFixed(1)} hrs</Text>
          </View>

          {/* Progress bar */}
          <View style={[styles.progressTrack, { backgroundColor: palette.progressTrack }]}>
            <View style={[styles.progressBar, { width: `${pct.toFixed(1)}%` }]} />
          </View>

          <View style={styles.itemFooter}>
            <Text style={[styles.itemDetail, { color: palette.muted }]}>{entriesCount} entries</Text>
            <Text style={[styles.itemDetail, { color: palette.muted }]}>{pct.toFixed(0)}%</Text>
          </View>
        </View>
      );
    },
    [palette, report?.totalHours]
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* Header */}
      <ScreenHeader
        backLabel="‹ Dashboard"
        onBack={onBack}
        palette={palette}
        title="Reports & Analytics"
      />

      {/* Preset Filters */}
      <View style={styles.filterRow}>
        <FilterTab
          active={preset === 'month'}
          label="This Month"
          onPress={() => setPreset('month')}
          palette={palette}
        />
        <FilterTab
          active={preset === '30days'}
          label="Past 30 Days"
          onPress={() => setPreset('30days')}
          palette={palette}
        />
        <FilterTab
          active={preset === '90days'}
          label="Past 90 Days"
          onPress={() => setPreset('90days')}
          palette={palette}
        />
      </View>

      {/* Group By Toggle */}
      <View style={styles.groupByRow}>
        <Text style={[styles.groupByLabel, { color: palette.muted }]}>Group by:</Text>
        <Pressable
          accessibilityLabel="Group by project"
          accessibilityRole="tab"
          accessibilityState={{ selected: groupBy === 'project' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => setGroupBy('project')}
          style={[styles.pill, groupBy === 'project' && { backgroundColor: palette.badgeBg }]}
        >
          <Text style={[styles.pillText, groupBy === 'project' ? styles.pillTextActive : { color: palette.foreground }]}>
            Project
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Group by activity"
          accessibilityRole="tab"
          accessibilityState={{ selected: groupBy === 'activity' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => setGroupBy('activity')}
          style={[styles.pill, groupBy === 'activity' && { backgroundColor: palette.badgeBg }]}
        >
          <Text style={[styles.pillText, groupBy === 'activity' ? styles.pillTextActive : { color: palette.foreground }]}>
            Activity
          </Text>
        </Pressable>
      </View>

      {error ? (
        <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      ) : null}

      {isLoading ? (
        <LoadingState message="Aggregating report totals..." palette={palette} />
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={report.byGroup}
          initialNumToRender={10}
          keyExtractor={keyExtractor}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              icon="reports"
              message="No hours logged in this period."
              palette={palette}
            />
          }
          ListHeaderComponent={
            <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <View style={styles.summaryCol}>
                <Text style={[styles.summaryLabel, { color: palette.muted }]}>Total Logged</Text>
                <Text style={[styles.summaryValue, { color: colors.primary }]}>
                  {(Number(report?.totalHours) || 0).toFixed(1)} <Text style={styles.summaryUnit}>hrs</Text>
                </Text>
              </View>
              <View style={styles.summaryCol}>
                <Text style={[styles.summaryLabel, { color: palette.muted }]}>Entries</Text>
                <Text style={[styles.summaryValue, { color: palette.foreground }]}>{Number(report?.totalEntries) || 0}</Text>
              </View>
            </View>
          }
          maxToRenderPerBatch={10}
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
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  groupByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginVertical: spacing.sm,
  },
  groupByLabel: { fontSize: typography.caption, fontWeight: '600' },
  pill: {
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillText: { fontSize: typography.caption, fontWeight: '600' },
  pillTextActive: { color: colors.primary, fontWeight: '700' },
  errorBox: {
    borderRadius: borderRadius.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  summaryCard: {
    flexDirection: 'row',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  summaryCol: { flex: 1 },
  summaryLabel: { fontSize: typography.caption, fontWeight: '600' },
  summaryValue: { fontSize: 24, fontWeight: '800', marginTop: 2 },
  summaryUnit: { fontSize: typography.caption },
  itemCard: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
    ...shadows.sm,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  itemName: { fontSize: typography.body, fontWeight: '700', flex: 1, marginRight: spacing.sm },
  itemHours: { fontSize: typography.body, fontWeight: '800' },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginVertical: spacing.xs,
  },
  progressBar: { height: '100%', backgroundColor: colors.primary, borderRadius: 4 },
  itemFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  itemDetail: { fontSize: typography.badge, fontWeight: '600' },
});
