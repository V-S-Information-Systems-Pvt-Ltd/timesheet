import React, { useCallback, useEffect, useState } from 'react';
import {
  DimensionValue,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSessionActions, useSessionStatus } from '../auth/SessionProvider';
import type { ReportTotals, ReportBucketItem } from '../api/contracts';
import { colors, spacing, typography, borderRadius, shadows, useTheme } from '../theme';

import { ScreenHeader } from '../components/ScreenHeader';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { FilterTab } from '../components/FilterTab';
import { Icon } from '../components/Icon';
import { todayISO, addDaysISO } from '../utils/dates';
import type { FilterUserParam } from '../navigation/navigation-reducer';

interface ReportsScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
  filterUser?: FilterUserParam | null;
  onClearFilterUser?: () => void;
}

type DatePreset = 'month' | '30days' | '90days';
type GroupBy = 'project' | 'activity' | 'user';

export function ReportsScreen({
  isDarkMode: _isDarkMode,
  onBack,
  filterUser,
  onClearFilterUser,
}: ReportsScreenProps) {
  const palette = useTheme().palette;
  const { actor, effectiveActor } = useSessionStatus();
  const currentActor = effectiveActor || actor;
  const { getReports } = useSessionActions();
  const [preset, setPreset] = useState<DatePreset>('month');
  const [groupBy, setGroupBy] = useState<GroupBy>('project');
  const [report, setReport] = useState<ReportTotals>({ totalHours: 0, totalEntries: 0, byGroup: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSeeMembers = Boolean(
    currentActor?.capabilities?.canManageSettings ||
      currentActor?.permissionRole === 'admin' ||
      currentActor?.permissionRole === 'co' ||
      currentActor?.hierarchyRole === 'manager' ||
      currentActor?.hierarchyRole === 'team_lead' ||
      currentActor?.role === 'admin' ||
      currentActor?.role === 'manager' ||
      currentActor?.role === 'lead'
  );

  const getDateRange = useCallback((): { from: string; to: string } => {
    const to = todayISO();
    let from: string;
    if (preset === 'month') {
      from = `${to.slice(0, 7)}-01`;
    } else if (preset === '30days') {
      from = addDaysISO(to, -29);
    } else {
      from = addDaysISO(to, -89);
    }
    return { from, to };
  }, [preset]);

  const fetchReports = useCallback(
    async (selectedPreset: DatePreset, selectedGroup: GroupBy, currentFilterUser?: FilterUserParam | null) => {
      setError(null);
      try {
        const { from, to } = getDateRange();
        const data = await getReports({
          from,
          to,
          groupBy: selectedGroup,
          userId: currentFilterUser?.id,
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
    [getDateRange, getReports]
  );

  useEffect(() => {
    let mounted = true;
    async function load() {
      setIsLoading(true);
      await fetchReports(preset, groupBy, filterUser);
      if (mounted) setIsLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [preset, groupBy, filterUser, fetchReports]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await fetchReports(preset, groupBy, filterUser);
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
            <Text style={[styles.itemHours, { color: palette.primary }]}>{itemHours.toFixed(1)} hrs</Text>
          </View>

          {/* Progress bar */}
          <View style={[styles.progressTrack, { backgroundColor: palette.progressTrack }]}>
            <View style={[styles.progressBar, { backgroundColor: palette.primary, width: `${pct.toFixed(1)}%` as DimensionValue }]} />
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

      {/* Member Filter Banner */}
      {filterUser ? (
        <View style={[styles.filterBanner, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.filterBannerContent}>
            <Icon color={palette.primary} name="team" size={14} />
            <Text numberOfLines={1} style={[styles.filterBannerText, { color: palette.foreground }]}>
              Filtered: {filterUser.name || filterUser.email || 'Selected Member'}
            </Text>
          </View>
          {onClearFilterUser ? (
            <Pressable
              accessibilityLabel="Clear member filter"
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={onClearFilterUser}
              style={[styles.clearBtn, { backgroundColor: palette.badgeBg }]}
            >
              <Text style={[styles.clearBtnText, { color: palette.muted }]}>✕ Clear</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

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
          <Text style={[styles.pillText, groupBy === 'project' ? [styles.pillTextActive, { color: palette.primary }] : { color: palette.foreground }]}>
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
          <Text style={[styles.pillText, groupBy === 'activity' ? [styles.pillTextActive, { color: palette.primary }] : { color: palette.foreground }]}>
            Activity
          </Text>
        </Pressable>
        {canSeeMembers ? (
          <Pressable
            accessibilityLabel="Group by member"
            accessibilityRole="tab"
            accessibilityState={{ selected: groupBy === 'user' }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => setGroupBy('user')}
            style={[styles.pill, groupBy === 'user' && { backgroundColor: palette.badgeBg }]}
          >
            <Text style={[styles.pillText, groupBy === 'user' ? [styles.pillTextActive, { color: palette.primary }] : { color: palette.foreground }]}>
              Member
            </Text>
          </Pressable>
        ) : null}
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
                <Text style={[styles.summaryValue, { color: palette.primary }]}>
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
                tintColor={palette.primary}
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
  pillTextActive: { fontWeight: '700' },
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
  progressBar: { height: '100%', borderRadius: 4 },
  itemFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  itemDetail: { fontSize: typography.badge, fontWeight: '600' },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
  },
  exportBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  filterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
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
    marginRight: spacing.sm,
  },
  filterBannerText: {
    fontSize: typography.caption,
    fontWeight: '700',
    flex: 1,
  },
  clearBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  clearBtnText: {
    fontSize: typography.badge,
    fontWeight: '700',
  },
});
