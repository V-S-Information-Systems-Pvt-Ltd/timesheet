import { TimesheetReportFilters } from '../components/TimesheetReportFilters';
import type { ReportParams } from '../api/contracts';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { afterOfficeHours, expectedHours, leaveHours } from '@vsis/core';
import { useSessionActions, useSessionStatus } from '../auth/SessionProvider';
import type { ReportTotals, ReportBucketItem } from '../api/contracts';
import { fonts, numeralSizes, spacing, typography, borderRadius, useTheme } from '../theme';

import { MetricCard } from '../components/MetricCard';
import { DailyHoursBars } from '../components/DailyHoursBars';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { FilterTab } from '../components/FilterTab';
import { Chip } from '../components/Chip';
import { BucketRow } from '../components/BucketRow';
import { Icon } from '../components/Icon';
import { todayISO, addDaysISO } from '../utils/dates';
import { formatEntryCount } from '../utils/plural';
import type { FilterUserParam } from '../navigation/navigation-reducer';

interface ReportsScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
  filterUser?: FilterUserParam | null;
  onClearFilterUser?: () => void;
}

type DatePreset = 'month' | '30days' | '90days';
type GroupBy = 'project' | 'activity' | 'user' | 'type';

const INSIGHT_PAGE_SIZE = 1000;

export function ReportsScreen({
  isDarkMode: _isDarkMode,
  onBack,
  filterUser,
  onClearFilterUser,
}: ReportsScreenProps) {
  const palette = useTheme().palette;
  const { actor, effectiveActor } = useSessionStatus();
  const currentActor = effectiveActor || actor;
  const { getReports, listLeaves, listTimesheets } = useSessionActions();
  const [preset, setPreset] = useState<DatePreset>('month');
  const [groupBy, setGroupBy] = useState<GroupBy>('project');
  const [classificationFilters, setClassificationFilters] = useState<Pick<ReportParams, 'entryType' | 'activityCode'>>({});
  const [report, setReport] = useState<ReportTotals>({ totalHours: 0, totalEntries: 0, byGroup: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Insight inputs load independently of the report: null means that source
  // failed (or was incomplete), which hides only the cards that need it.
  const [insightRange, setInsightRange] = useState<{ from: string; to: string } | null>(null);
  const [leaveDates, setLeaveDates] = useState<string[] | null>(null);
  const [dayRows, setDayRows] = useState<Array<{ log_date: string; hours_worked: number }> | null>(null);

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
          ...classificationFilters,
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
    [getDateRange, getReports, classificationFilters]
  );

  // Own-report insights only; another member's leaves are not readable here.
  const ownerId = currentActor?.id;
  const showInsights = !filterUser && Boolean(ownerId);
  const fetchInsights = useCallback(async () => {
    if (!showInsights) return;
    const { from, to } = getDateRange();
    const [leaves, rows] = await Promise.allSettled([
      listLeaves({ from, to }),
      listTimesheets({ userId: ownerId, dateFrom: from, dateTo: to, from: 0, to: INSIGHT_PAGE_SIZE - 1 }),
    ]);
    setInsightRange({ from, to });
    setLeaveDates(leaves.status === 'fulfilled' ? leaves.value.map((l) => l.leave_date) : null);
    // A full page may be truncated, so totals from it would be understated.
    setDayRows(
      rows.status === 'fulfilled' && rows.value.rows.length < INSIGHT_PAGE_SIZE ? rows.value.rows : null
    );
  }, [showInsights, getDateRange, listLeaves, listTimesheets, ownerId]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

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
    await Promise.all([fetchReports(preset, groupBy, filterUser), fetchInsights()]);
    setIsRefreshing(false);
  }

  // Cards whose source failed are left out; the rest are laid out two per row.
  const insightCards = useMemo(() => {
    if (!insightRange) return [];
    const { from, to } = insightRange;
    const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
    const cards: React.ReactElement[] = [
      <MetricCard key="expected" label="Expected hours" palette={palette} value={fmt(expectedHours(from, to))} />,
    ];
    if (dayRows) {
      cards.push(<MetricCard key="after" label="After-office hours" palette={palette} value={fmt(afterOfficeHours(dayRows))} />);
    }
    if (leaveDates) {
      cards.push(<MetricCard key="leave" label="Leave hours" palette={palette} value={fmt(leaveHours(leaveDates, from, to))} />);
    }
    const rows: React.ReactElement[][] = [];
    for (let i = 0; i < cards.length; i += 2) rows.push(cards.slice(i, i + 2));
    return rows;
  }, [insightRange, dayRows, leaveDates, palette]);

  const keyExtractor = useCallback((item: ReportBucketItem, index: number) => item.label || `report-${index}`, []);

  const renderItem = useCallback(
    ({ item }: { item: ReportBucketItem }) => {
      const itemHours = Number(item.hours) || 0;
      const totalHours = Number(report?.totalHours) || 0;
      const pct = totalHours > 0 ? Math.min(100, Math.max(0, (itemHours / totalHours) * 100)) : 0;
      const entriesCount = Number(item.entries) || 0;

      return (
        <BucketRow
          hours={itemHours}
          label={item.label}
          meta={`${formatEntryCount(entriesCount)}, ${pct.toFixed(0)}%`}
          palette={palette}
          percent={pct}
        />
      );
    },
    [palette, report?.totalHours]
  );

  const totalHours = Number(report?.totalHours) || 0;
  const showSummary = !isLoading && !error;

  const emptyComponent = isLoading ? (
    <LoadingState message="Adding up your hours..." palette={palette} />
  ) : error ? (
    /* A failed load must not read as "no data": suppress the empty state
       and the zeroed summary, and offer the retry the RefreshControl hides. */
    <View style={styles.errorContainer}>
      <PressableScale
        accessibilityLabel="Retry loading report"
        accessibilityRole="button"
        onPress={handleRefresh}
        style={[styles.retryButton, { backgroundColor: palette.primary }]}
      >
        <Text style={[styles.retryButtonText, { color: palette.onPrimary }]}>Try again</Text>
      </PressableScale>
    </View>
  ) : (
    <EmptyState
      icon="reports"
      message="No hours logged in this period. Log time and your totals will show up here."
      palette={palette}
    />
  );

  const groupOptions: Array<{ key: GroupBy; label: string; accessibilityLabel: string }> = [
    { key: 'type', label: 'Type', accessibilityLabel: 'Group by type' },
    { key: 'project', label: 'Project', accessibilityLabel: 'Group by project' },
    { key: 'activity', label: 'Activity', accessibilityLabel: 'Group by activity' },
    ...(canSeeMembers
      ? [{ key: 'user' as GroupBy, label: 'Member', accessibilityLabel: 'Group by member' }]
      : []),
  ];

  return (
    <View style={[styles.container, { backgroundColor: palette.paper }]}>
      <ScreenHeader
        backLabel="‹ Dashboard"
        onBack={onBack}
        palette={palette}
        title="Reports"
      />

      {filterUser ? (
        <View style={[styles.filterBanner, { borderColor: palette.hairline }]}>
          <View style={styles.filterBannerContent}>
            <Icon color={palette.primaryText} name="team" size={14} />
            <Text numberOfLines={1} style={[styles.filterBannerText, { color: palette.foreground }]}>
              Showing {filterUser.name || filterUser.email || 'selected member'}
            </Text>
          </View>
          {onClearFilterUser ? (
            <Pressable
              accessibilityLabel="Clear member filter"
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={onClearFilterUser}
              style={styles.clearBtn}
            >
              <Text style={[styles.clearBtnText, { color: palette.primaryText }]}>Show everyone</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.filterRow}>
        <FilterTab active={preset === 'month'} label="This month" onPress={() => setPreset('month')} palette={palette} />
        <FilterTab active={preset === '30days'} label="Past 30 days" onPress={() => setPreset('30days')} palette={palette} />
        <FilterTab active={preset === '90days'} label="Past 90 days" onPress={() => setPreset('90days')} palette={palette} />
      </View>

      <View style={[styles.sheet, { backgroundColor: palette.sheet }]}>
        <FlatList
          contentContainerStyle={styles.listContent}
          data={isLoading || error ? [] : report.byGroup}
          initialNumToRender={10}
          keyExtractor={keyExtractor}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={emptyComponent}
          ListHeaderComponent={
            <>
              <TimesheetReportFilters value={classificationFilters} onChange={setClassificationFilters} palette={palette} />

              <Text style={[styles.groupByLabel, { color: palette.muted }]}>Group by</Text>
              <View style={styles.chipLine}>
                {groupOptions.map((g) => (
                  <Chip
                    key={g.key}
                    accessibilityLabel={g.accessibilityLabel}
                    accessibilityRole="tab"
                    active={groupBy === g.key}
                    label={g.label}
                    onPress={() => setGroupBy(g.key)}
                    palette={palette}
                  />
                ))}
              </View>

              {error ? (
                <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
                  <Text style={[styles.errorText, { color: palette.error }]}>{error}</Text>
                </View>
              ) : null}

              {showSummary ? (
                <View style={[styles.summary, { borderBottomColor: palette.hairline }]}>
                  <Text style={[styles.summaryLabel, { color: palette.muted }]}>Total logged</Text>
                  <View style={styles.summaryLine}>
                    <Text style={[styles.summaryValue, { color: palette.foreground }]}>{totalHours.toFixed(1)}</Text>
                    <Text style={[styles.summaryUnit, { color: palette.muted }]}>
                      {`hrs in ${formatEntryCount(Number(report?.totalEntries) || 0)}`}
                    </Text>
                  </View>
                </View>
              ) : null}
              {showSummary && showInsights && insightRange ? (
                <>
                  <View style={[styles.insights, { borderBottomColor: palette.hairline }]}>
                    {insightCards.map((row, index) => (
                      <View key={index} style={styles.insightRow}>
                        {row}
                      </View>
                    ))}
                  </View>
                  {dayRows ? (
                    <DailyHoursBars from={insightRange.from} palette={palette} rows={dayRows} to={insightRange.to} />
                  ) : null}
                </>
              ) : null}
            </>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  sheet: {
    flex: 1,
    borderTopLeftRadius: borderRadius.sheet,
    borderTopRightRadius: borderRadius.sheet,
    overflow: 'hidden',
  },
  listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  groupByLabel: { fontSize: typography.caption, fontWeight: '600', marginBottom: spacing.xs },
  chipLine: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  retryButton: {
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonText: { fontSize: typography.body, fontWeight: '600' },
  errorBox: {
    borderRadius: borderRadius.control,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  summary: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryLabel: { fontSize: typography.caption, fontWeight: '500' },
  summaryLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  summaryValue: {
    fontFamily: fonts.numeral,
    fontSize: numeralSizes.xl,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  summaryUnit: { fontSize: typography.body },
  insights: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  insightRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.xs },
  filterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.control,
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
    fontWeight: '600',
    flex: 1,
  },
  clearBtn: { minHeight: 32, justifyContent: 'center' },
  clearBtnText: { fontSize: typography.caption, fontWeight: '600' },
});
