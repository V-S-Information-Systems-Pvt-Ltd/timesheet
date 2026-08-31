import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DimensionValue,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { useSessionActions, useSessionData } from '../auth/SessionProvider';
import type { PersonProfile, ReportTotals } from '../api/contracts';
import { todayISO, addDaysISO } from '../utils/dates';

interface PrivilegedReportsScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
  filterUser?: PersonProfile | null;
  onClearFilterUser?: () => void;
}

type DatePreset = 'month' | '30days' | '90days' | 'custom';
type GroupBy = 'project' | 'activity' | 'user';

export function PrivilegedReportsScreen({
  isDarkMode,
  onBack,
  filterUser,
  onClearFilterUser,
}: PrivilegedReportsScreenProps) {
  const palette = getPalette(isDarkMode);
  const { reference } = useSessionData();
  const { getReports, exportReportsCsv, listAdminUsers } = useSessionActions();

  const [preset, setPreset] = useState<DatePreset>('month');
  const [groupBy, setGroupBy] = useState<GroupBy>('user');
  const [customFrom, setCustomFrom] = useState(todayISO().slice(0, 7) + '-01');
  const [customTo, setCustomTo] = useState(todayISO());

  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [selectedUserId, setSelectedUserId] = useState<string>(filterUser?.id || 'all');
  const [users, setUsers] = useState<PersonProfile[]>([]);

  const [report, setReport] = useState<ReportTotals>({ totalHours: 0, totalEntries: 0, byGroup: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (filterUser) {
      setSelectedUserId(filterUser.id);
    }
  }, [filterUser]);

  useEffect(() => {
    listAdminUsers()
      .then((data) => setUsers(data))
      .catch(() => setUsers([]));
  }, [listAdminUsers]);

  const getDateRange = useCallback((): { from: string; to: string } => {
    const to = todayISO();
    if (preset === 'month') {
      return { from: `${to.slice(0, 7)}-01`, to };
    }
    if (preset === '30days') {
      return { from: addDaysISO(to, -29), to };
    }
    if (preset === '90days') {
      return { from: addDaysISO(to, -89), to };
    }
    return { from: customFrom || `${to.slice(0, 7)}-01`, to: customTo || to };
  }, [preset, customFrom, customTo]);

  const fetchReports = useCallback(async () => {
    setError(null);
    try {
      const { from, to } = getDateRange();
      const params = {
        from,
        to,
        groupBy,
        project: selectedProjectId !== 'all' ? selectedProjectId : undefined,
        user: selectedUserId !== 'all' ? selectedUserId : undefined,
      };

      const data = await getReports(params);
      setReport({
        totalHours: Number(data?.totalHours) || 0,
        totalEntries: Number(data?.totalEntries) || 0,
        byGroup: Array.isArray(data?.byGroup) ? data.byGroup : [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate report.');
    }
  }, [getDateRange, getReports, groupBy, selectedProjectId, selectedUserId]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setIsLoading(true);
      await fetchReports();
      if (mounted) setIsLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [fetchReports]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchReports();
    setIsRefreshing(false);
  }, [fetchReports]);

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      const { from, to } = getDateRange();
      const params = {
        from,
        to,
        project: selectedProjectId !== 'all' ? selectedProjectId : undefined,
        user: selectedUserId !== 'all' ? selectedUserId : undefined,
      };

      const csvContent = await exportReportsCsv(params);
      if (!csvContent || csvContent.trim().length === 0) {
        Alert.alert('Export CSV', 'No timesheet records found for the selected filter criteria.');
        return;
      }

      await Share.share({
        message: csvContent,
        title: `Timesheets_${from.replace(/-/g, '')}_${to.replace(/-/g, '')}.csv`,
      });
    } catch (err) {
      Alert.alert('Export Failed', err instanceof Error ? err.message : 'Failed to export CSV report.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScreenHeader
        onBack={onBack}
        palette={palette}
        rightAction={
          <PressableScale
            accessibilityLabel="Export Report CSV"
            accessibilityRole="button"
            disabled={isExporting || isLoading}
            onPress={handleExportCsv}
            style={styles.exportBtn}
          >
            {isExporting ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <>
                <Icon color={colors.onPrimary} name="download" size={16} />
                <Text style={styles.exportBtnText}>Export CSV</Text>
              </>
            )}
          </PressableScale>
        }
        subtitle="Organization and team member timesheet analytics"
        title="Privileged Reports"
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={isRefreshing} />}
        showsVerticalScrollIndicator={false}
      >
        {filterUser ? (
          <View
            style={[
              styles.filterBanner,
              { backgroundColor: palette.badgeBg, borderColor: palette.border },
            ]}
          >
            <View style={styles.filterBannerContent}>
              <Icon name="team" size={16} color={colors.primary} />
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
                <Text style={[styles.clearFilterText, { color: colors.primary }]}>Reset to All</Text>
              </PressableScale>
            ) : null}
          </View>
        ) : null}

        {/* Date Presets */}
        <Text style={[styles.sectionLabel, { color: palette.foreground }]}>Date Range</Text>
        <View style={styles.presetRow}>
          {(
            [
              { key: 'month', label: 'This Month' },
              { key: '30days', label: 'Past 30d' },
              { key: '90days', label: 'Past 90d' },
              { key: 'custom', label: 'Custom' },
            ] as const
          ).map((p) => (
            <PressableScale
              key={p.key}
              accessibilityLabel={`Date preset ${p.label}`}
              accessibilityRole="button"
              onPress={() => setPreset(p.key)}
              style={[
                styles.presetBtn,
                {
                  backgroundColor: preset === p.key ? colors.primary : palette.badgeBg,
                  borderColor: preset === p.key ? colors.primary : palette.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.presetBtnText,
                  { color: preset === p.key ? colors.onPrimary : palette.foreground },
                ]}
              >
                {p.label}
              </Text>
            </PressableScale>
          ))}
        </View>

        {preset === 'custom' ? (
          <View style={styles.customDateRow}>
            <View style={styles.customDateCol}>
              <Text style={[styles.fieldCaption, { color: palette.muted }]}>From (YYYY-MM-DD)</Text>
              <TextInput
                accessibilityLabel="Custom From Date"
                onChangeText={setCustomFrom}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={palette.placeholder}
                style={[styles.input, { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground }]}
                value={customFrom}
              />
            </View>
            <View style={styles.customDateCol}>
              <Text style={[styles.fieldCaption, { color: palette.muted }]}>To (YYYY-MM-DD)</Text>
              <TextInput
                accessibilityLabel="Custom To Date"
                onChangeText={setCustomTo}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={palette.placeholder}
                style={[styles.input, { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground }]}
                value={customTo}
              />
            </View>
          </View>
        ) : null}

        {/* Group By Filter */}
        <Text style={[styles.sectionLabel, { color: palette.foreground }]}>Group Aggregation By</Text>
        <View style={styles.presetRow}>
          {(
            [
              { key: 'user', label: 'By Member' },
              { key: 'project', label: 'By Project' },
              { key: 'activity', label: 'By Activity' },
            ] as const
          ).map((g) => (
            <PressableScale
              key={g.key}
              accessibilityLabel={`Group by ${g.label}`}
              accessibilityRole="button"
              onPress={() => setGroupBy(g.key)}
              style={[
                styles.presetBtn,
                {
                  backgroundColor: groupBy === g.key ? colors.primary : palette.badgeBg,
                  borderColor: groupBy === g.key ? colors.primary : palette.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.presetBtnText,
                  { color: groupBy === g.key ? colors.onPrimary : palette.foreground },
                ]}
              >
                {g.label}
              </Text>
            </PressableScale>
          ))}
        </View>

        {/* Member Filter Picker */}
        <Text style={[styles.sectionLabel, { color: palette.foreground }]}>Filter by Member</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          <PressableScale
            accessibilityLabel="Filter all members"
            accessibilityRole="button"
            onPress={() => setSelectedUserId('all')}
            style={[
              styles.filterPill,
              {
                backgroundColor: selectedUserId === 'all' ? colors.primary : palette.badgeBg,
                borderColor: selectedUserId === 'all' ? colors.primary : palette.border,
              },
            ]}
          >
            <Text style={[styles.filterPillText, { color: selectedUserId === 'all' ? colors.onPrimary : palette.foreground }]}>
              All Members
            </Text>
          </PressableScale>
          {users.map((u) => (
            <PressableScale
              key={u.id}
              accessibilityLabel={`Filter member ${u.name || u.email}`}
              accessibilityRole="button"
              onPress={() => setSelectedUserId(u.id)}
              style={[
                styles.filterPill,
                {
                  backgroundColor: selectedUserId === u.id ? colors.primary : palette.badgeBg,
                  borderColor: selectedUserId === u.id ? colors.primary : palette.border,
                },
              ]}
            >
              <Text style={[styles.filterPillText, { color: selectedUserId === u.id ? colors.onPrimary : palette.foreground }]}>
                {u.name || u.email}
              </Text>
            </PressableScale>
          ))}
        </ScrollView>

        {/* Project Filter Picker */}
        <Text style={[styles.sectionLabel, { color: palette.foreground }]}>Filter by Project</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          <PressableScale
            accessibilityLabel="Filter all projects"
            accessibilityRole="button"
            onPress={() => setSelectedProjectId('all')}
            style={[
              styles.filterPill,
              {
                backgroundColor: selectedProjectId === 'all' ? colors.primary : palette.badgeBg,
                borderColor: selectedProjectId === 'all' ? colors.primary : palette.border,
              },
            ]}
          >
            <Text style={[styles.filterPillText, { color: selectedProjectId === 'all' ? colors.onPrimary : palette.foreground }]}>
              All Projects
            </Text>
          </PressableScale>
          {(reference?.projects || []).map((p) => (
            <PressableScale
              key={p.id}
              accessibilityLabel={`Filter project ${p.name}`}
              accessibilityRole="button"
              onPress={() => setSelectedProjectId(p.id)}
              style={[
                styles.filterPill,
                {
                  backgroundColor: selectedProjectId === p.id ? colors.primary : palette.badgeBg,
                  borderColor: selectedProjectId === p.id ? colors.primary : palette.border,
                },
              ]}
            >
              <Text style={[styles.filterPillText, { color: selectedProjectId === p.id ? colors.onPrimary : palette.foreground }]}>
                {p.name}
              </Text>
            </PressableScale>
          ))}
        </ScrollView>

        {/* Summary Card */}
        <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
          <View style={styles.summaryStat}>
            <Text style={[styles.summaryValue, { color: colors.primary }]}>{report.totalHours.toFixed(1)}</Text>
            <Text style={[styles.summaryLabel, { color: palette.muted }]}>Total Hours</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: palette.border }]} />
          <View style={styles.summaryStat}>
            <Text style={[styles.summaryValue, { color: palette.foreground }]}>{report.totalEntries}</Text>
            <Text style={[styles.summaryLabel, { color: palette.muted }]}>Total Entries</Text>
          </View>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {isLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[styles.loadingText, { color: palette.muted }]}>Aggregating report totals…</Text>
          </View>
        ) : report.byGroup.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Icon color={palette.muted} name="document-text" size={36} />
            <Text style={[styles.emptyTitle, { color: palette.foreground }]}>No records found</Text>
            <Text style={[styles.emptySubtitle, { color: palette.muted }]}>
              Try broadening your date range or adjusting member/project filters.
            </Text>
          </View>
        ) : (
          <View style={styles.bucketsContainer}>
            {report.byGroup.map((item, idx) => {
              const itemHours = Number(item.hours) || 0;
              const total = report.totalHours || 1;
              const pct = Math.min(100, Math.max(0, (itemHours / total) * 100));

              return (
                <View
                  key={item.label || `b-${idx}`}
                  accessibilityLabel={`Report bucket ${item.label}: ${itemHours.toFixed(1)} hours`}
                  style={[styles.bucketCard, { backgroundColor: palette.card, borderColor: palette.border }]}
                >
                  <View style={styles.bucketHeader}>
                    <Text numberOfLines={1} style={[styles.bucketLabel, { color: palette.foreground }]}>
                      {item.label || 'Unknown'}
                    </Text>
                    <Text style={[styles.bucketHours, { color: colors.primary }]}>{itemHours.toFixed(1)} hrs</Text>
                  </View>

                  <View style={[styles.progressTrack, { backgroundColor: palette.badgeBg }]}>
                    <View
                      style={[
                        styles.progressBar,
                        {
                          backgroundColor: colors.primary,
                          width: `${pct.toFixed(1)}%` as DimensionValue,
                        },
                      ]}
                    />
                  </View>

                  <View style={styles.bucketFooter}>
                    <Text style={[styles.bucketEntries, { color: palette.muted }]}>{item.entries} entries</Text>
                    <Text style={[styles.bucketPercent, { color: palette.muted }]}>{pct.toFixed(0)}%</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  exportBtnText: {
    color: colors.onPrimary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  sectionLabel: {
    fontSize: typography.caption,
    fontWeight: '700',
    marginTop: spacing.xs,
    marginBottom: 4,
  },
  presetRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  presetBtn: {
    flex: 1,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  customDateRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  customDateCol: {
    flex: 1,
  },
  fieldCaption: {
    fontSize: 11,
    marginBottom: 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    fontSize: typography.caption,
  },
  filterScroll: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  filterPill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    marginRight: spacing.xs,
  },
  filterPillText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  summaryCard: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing.md,
    marginVertical: spacing.xs,
    ...shadows.sm,
  },
  summaryStat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryValue: {
    fontSize: typography.hero,
    fontWeight: '800',
  },
  summaryLabel: {
    fontSize: typography.caption,
    fontWeight: '600',
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    height: '70%',
    alignSelf: 'center',
  },
  centerContainer: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: typography.caption,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.xs,
  },
  emptyTitle: {
    fontSize: typography.body,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  emptySubtitle: {
    fontSize: typography.caption,
    textAlign: 'center',
  },
  bucketsContainer: {
    gap: spacing.sm,
  },
  bucketCard: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    ...shadows.sm,
  },
  bucketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  bucketLabel: {
    fontSize: typography.body,
    fontWeight: '700',
    flex: 1,
    marginRight: spacing.sm,
  },
  bucketHours: {
    fontSize: typography.body,
    fontWeight: '800',
  },
  progressTrack: {
    height: 6,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
    marginVertical: spacing.xs,
  },
  progressBar: {
    height: '100%',
    borderRadius: borderRadius.full,
  },
  bucketFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  bucketEntries: {
    fontSize: 12,
  },
  bucketPercent: {
    fontSize: 12,
    fontWeight: '600',
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  filterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
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
