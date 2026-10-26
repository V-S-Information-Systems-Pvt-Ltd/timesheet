import { TimesheetReportFilters } from '../components/TimesheetReportFilters';
import type { ReportParams } from '../api/contracts';
import React, { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fonts, numeralSizes, spacing, typography, borderRadius, useTheme } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon } from '../components/Icon';
import { Chip } from '../components/Chip';
import { BucketRow } from '../components/BucketRow';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ProjectComparison } from '../components/ProjectComparison';
import { useSessionActions, useSessionData } from '../auth/SessionProvider';
import { isValidISODate } from '../utils/dates';
import type { PersonProfile, ReportTotals } from '../api/contracts';
import type { FilterUserParam } from '../navigation/navigation-reducer';
import { todayISO, addDaysISO } from '../utils/dates';
import { formatEntryCount } from '../utils/plural';

interface PrivilegedReportsScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
  filterUser?: FilterUserParam | null;
  onClearFilterUser?: () => void;
}

type DatePreset = 'month' | '30days' | '90days' | 'custom';
type GroupBy = 'project' | 'activity' | 'user' | 'type';

export function PrivilegedReportsScreen({
  isDarkMode: _isDarkMode,
  onBack,
  filterUser,
  onClearFilterUser,
}: PrivilegedReportsScreenProps) {
  const palette = useTheme().palette;
  const { reference } = useSessionData();
  const { getReports, listAdminUsers } = useSessionActions();

  const [preset, setPreset] = useState<DatePreset>('month');
  const [groupBy, setGroupBy] = useState<GroupBy>('user');
  const [customFrom, setCustomFrom] = useState(todayISO().slice(0, 7) + '-01');
  const [customTo, setCustomTo] = useState(todayISO());

  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [selectedUserId, setSelectedUserId] = useState<string>(filterUser?.id || 'all');
  const [users, setUsers] = useState<PersonProfile[]>([]);

  const [classificationFilters, setClassificationFilters] = useState<Pick<ReportParams, 'entryType' | 'activityCode'>>({});
  const [report, setReport] = useState<ReportTotals>({ totalHours: 0, totalEntries: 0, byGroup: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);

  useEffect(() => {
    if (filterUser) {
      setSelectedUserId(filterUser.id);
    }
  }, [filterUser]);

  useEffect(() => {
    listAdminUsers()
      .then((data) => setUsers(data))
      .catch((err: unknown) => {
        // A failed member list must not read as "no members to filter by".
        setUsersError(err instanceof Error ? `Team list could not be loaded: ${err.message}` : 'Team list could not be loaded.');
        setUsers([]);
      });
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
    return { from: customFrom, to: customTo };
  }, [customFrom, customTo, preset]);

  const fetchReports = useCallback(async () => {
    setError(null);
    try {
      const { from, to } = getDateRange();
      if (preset === 'custom') {
        // Refuse a malformed or inverted range client-side: a server error
        // string explains nothing, and an inverted range reads as "no data".
        if (!isValidISODate(from) || !isValidISODate(to)) {
          setError('Dates must use the YYYY-MM-DD format, e.g. 2026-09-10.');
          return;
        }
        if (from > to) {
          setError('"From" must be on or before "To".');
          return;
        }
      }
      const params = {
        from,
        to,
        groupBy,
        ...classificationFilters,
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
      setError(err instanceof Error ? err.message : 'Could not generate reports.');
    }
  }, [getDateRange, getReports, groupBy, selectedProjectId, selectedUserId, classificationFilters, preset]);

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

  const totalHours = report.totalHours || 0;
  const presets = [
    { key: 'month', label: 'This month' },
    { key: '30days', label: 'Past 30 days' },
    { key: '90days', label: 'Past 90 days' },
    { key: 'custom', label: 'Custom' },
  ] as const;
  const groups = [
    { key: 'type', label: 'Type' },
    { key: 'user', label: 'Member' },
    { key: 'project', label: 'Project' },
    { key: 'activity', label: 'Activity' },
  ] as const;

  return (
    <View style={[styles.container, { backgroundColor: palette.paper }]}>
      <ScreenHeader
        onBack={onBack}
        palette={palette}
        subtitle="Hours across the organization and its members"
        title="Privileged reports"
      />

      {filterUser ? (
        <View style={[styles.filterBanner, { borderColor: palette.hairline }]}>
          <View style={styles.filterBannerContent}>
            <Icon name="team" size={16} color={palette.primaryText} />
            <Text style={[styles.filterBannerText, { color: palette.foreground }]}>
              Showing <Text style={styles.filterBannerName}>{filterUser.name || filterUser.email}</Text>
            </Text>
          </View>
          {onClearFilterUser ? (
            <PressableScale
              accessibilityLabel="Clear member filter"
              accessibilityRole="button"
              onPress={onClearFilterUser}
              style={styles.clearFilterBtn}
            >
              <Text style={[styles.clearFilterText, { color: palette.primaryText }]}>Show everyone</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={isRefreshing} />}
        showsVerticalScrollIndicator={false}
        style={[styles.sheet, { backgroundColor: palette.sheet }]}
      >
        <View style={[styles.row, { borderBottomColor: palette.hairline }]}>
          <Text style={[styles.rowLabel, { color: palette.muted }]}>Date range</Text>
          <View style={styles.chipLine}>
            {presets.map((p) => (
              <Chip
                key={p.key}
                accessibilityLabel={`Date preset ${p.label}`}
                active={preset === p.key}
                label={p.label}
                onPress={() => setPreset(p.key)}
                palette={palette}
              />
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
                  style={[styles.input, { borderColor: palette.controlBorder, color: palette.foreground }]}
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
                  style={[styles.input, { borderColor: palette.controlBorder, color: palette.foreground }]}
                  value={customTo}
                />
              </View>
            </View>
          ) : null}
        </View>

        <View style={[styles.row, { borderBottomColor: palette.hairline }]}>
          <TimesheetReportFilters value={classificationFilters} onChange={setClassificationFilters} palette={palette} />
        </View>

        <View style={[styles.row, { borderBottomColor: palette.hairline }]}>
          <Text style={[styles.rowLabel, { color: palette.muted }]}>Group by</Text>
          <View style={styles.chipLine}>
            {groups.map((g) => (
              <Chip
                key={g.key}
                accessibilityLabel={`Group by ${g.label.toLowerCase()}`}
                active={groupBy === g.key}
                label={g.label}
                onPress={() => setGroupBy(g.key)}
                palette={palette}
              />
            ))}
          </View>
        </View>

        <View style={[styles.row, { borderBottomColor: palette.hairline }]}>
          <Text style={[styles.rowLabel, { color: palette.muted }]}>Member</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipScroll}>
              <Chip
                accessibilityLabel="Filter all members"
                active={selectedUserId === 'all'}
                label="All members"
                onPress={() => setSelectedUserId('all')}
                palette={palette}
              />
              {users.map((u) => (
                <Chip
                  key={u.id}
                  accessibilityLabel={`Filter member ${u.name || u.email}`}
                  active={selectedUserId === u.id}
                  label={u.name || u.email}
                  onPress={() => setSelectedUserId(u.id)}
                  palette={palette}
                />
              ))}
            </View>
          </ScrollView>
        </View>

        <View style={[styles.row, { borderBottomColor: palette.hairline }]}>
          <Text style={[styles.rowLabel, { color: palette.muted }]}>Project</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipScroll}>
              <Chip
                accessibilityLabel="Filter all projects"
                active={selectedProjectId === 'all'}
                label="All projects"
                onPress={() => setSelectedProjectId('all')}
                palette={palette}
              />
              {(reference?.projects || []).map((p) => (
                <Chip
                  key={p.id}
                  accessibilityLabel={`Filter project ${p.name}`}
                  active={selectedProjectId === p.id}
                  label={p.name}
                  onPress={() => setSelectedProjectId(p.id)}
                  palette={palette}
                />
              ))}
            </View>
          </ScrollView>
        </View>

        <ProjectComparison getReports={getReports} palette={palette} projects={reference?.projects ?? []} />

        {error ? (
          <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.error }]}>
            {error}
          </Text>
        ) : null}
        {usersError ? (
          <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.error }]}>
            {usersError}
          </Text>
        ) : null}

        <View style={[styles.summary, { borderBottomColor: palette.hairline }]}>
          <Text style={[styles.rowLabel, { color: palette.muted }]}>Total hours</Text>
          <View style={styles.summaryLine}>
            <Text style={[styles.summaryValue, { color: palette.foreground }]}>{totalHours.toFixed(1)}</Text>
            <Text style={[styles.summaryUnit, { color: palette.muted }]}>
              {`hrs in ${formatEntryCount(report.totalEntries)}`}
            </Text>
          </View>
        </View>

        {isLoading ? (
          <LoadingState message="Adding up your hours..." palette={palette} />
        ) : report.byGroup.length === 0 ? (
          <EmptyState
            icon="document-text"
            message="No records match these filters. Try a wider date range or fewer member and project filters."
            palette={palette}
          />
        ) : (
          report.byGroup.map((item, idx) => {
            const itemHours = Number(item.hours) || 0;
            const total = report.totalHours || 1;
            const pct = Math.min(100, Math.max(0, (itemHours / total) * 100));

            return (
              <BucketRow
                key={item.label || `b-${idx}`}
                accessibilityLabel={`Report bucket ${item.label}: ${itemHours.toFixed(1)} hours`}
                hours={itemHours}
                label={item.label}
                meta={`${formatEntryCount(item.entries)}, ${pct.toFixed(0)}%`}
                palette={palette}
                percent={pct}
              />
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sheet: {
    flex: 1,
    marginTop: spacing.sm,
    borderTopLeftRadius: borderRadius.sheet,
    borderTopRightRadius: borderRadius.sheet,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: typography.caption, fontWeight: '600', marginBottom: spacing.xs },
  chipLine: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chipScroll: { flexDirection: 'row', gap: spacing.sm },
  customDateRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  customDateCol: { flex: 1 },
  fieldCaption: { fontSize: typography.caption, marginBottom: spacing.xs },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.control,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    fontSize: typography.body,
  },
  summary: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  summaryValue: {
    fontFamily: fonts.numeral,
    fontSize: numeralSizes.xl,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  summaryUnit: { fontSize: typography.body },
  errorText: {
    fontSize: typography.caption,
    fontWeight: '600',
    marginTop: spacing.md,
  },
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
  },
  filterBannerText: { fontSize: typography.caption },
  filterBannerName: { fontWeight: '600' },
  clearFilterBtn: { minHeight: 32, justifyContent: 'center', paddingHorizontal: spacing.sm },
  clearFilterText: { fontSize: typography.caption, fontWeight: '600' },
});
