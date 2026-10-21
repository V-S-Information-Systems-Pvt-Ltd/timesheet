import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSessionActor, useSessionSync, useSessionDashboard, useSessionActions } from '../auth/SessionProvider';
import type { TimesheetEntry } from '../api/contracts';
import { fonts, numeralSizes, spacing, typography, borderRadius, useTheme } from '../theme';
import { formatDatePreview, formatDateRangeShort, formatDayLine } from '../utils/dates';

import { MetricCard } from '../components/MetricCard';
import { FeatureHub } from '../components/FeatureHub';
import { TimesheetEntryCard } from '../components/TimesheetEntryCard';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { PressableScale } from '../components/PressableScale';
import { DayGauge, GAUGE_HOURS, formatGaugeHours } from '../components/DayGauge';
import { MissingDaysStrip } from '../components/MissingDaysStrip';
import { todayISO } from '@vsis/core';
import { formatEntryCount } from '../utils/plural';
import { useBackfillMinDate } from '../utils/use-backfill-min-date';

interface HomeScreenProps {
  isDarkMode: boolean;
  onViewTimesheets: () => void;
  onLogTime: () => void;
  /** Opens Log time with the hours prefilled (what is left of today's 8 h). */
  onLogTimeWithHours?: (hours: number) => void;
  onViewProfile: () => void;
  onViewReports: () => void;
  onViewLeaves: () => void;
  onViewReminders: () => void;
  onViewTeam?: () => void;
  /** Opens Log Time on a given date (from the missing-days strip). */
  onLogTimeForDate?: (iso: string) => void;
}

export function HomeScreen({
  isDarkMode: _isDarkMode,
  onViewTimesheets,
  onLogTime,
  onLogTimeWithHours,
  onViewProfile,
  onViewReports,
  onViewLeaves,
  onViewReminders,
  onViewTeam,
  onLogTimeForDate,
}: HomeScreenProps) {
  const palette = useTheme().palette;
  const { actor } = useSessionActor();
  const { isOffline } = useSessionSync();
  const { dashboard, loadDashboard } = useSessionDashboard();
  const { deleteTimesheet, listTimesheets, listLeaves } = useSessionActions();
  const minLogDate = useBackfillMinDate(dashboard?.today?.date ?? todayISO());
  const effectiveActor = actor ?? dashboard?.actor;
  const [isLoading, setIsLoading] = useState(!dashboard);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // null until the strip's month read lands, and again if it fails.
  const [month, setMonth] = useState<{ hours: number; entries: number } | null>(null);

  const canViewTeam = Boolean(
    effectiveActor?.capabilities?.canViewTeam ?? (
      effectiveActor?.hierarchyRole === 'manager' ||
      effectiveActor?.hierarchyRole === 'team_lead' ||
      effectiveActor?.permissionRole === 'admin' ||
      effectiveActor?.permissionRole === 'co'
    )
  );

  useEffect(() => {
    let mounted = true;
    async function fetchInitial() {
      if (!dashboard) {
        setIsLoading(true);
        await loadDashboard();
        if (mounted) setIsLoading(false);
      }
    }
    fetchInitial();
    return () => {
      mounted = false;
    };
  }, [dashboard, loadDashboard]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await loadDashboard(true);
    setIsRefreshing(false);
  }

  const handleDelete = useCallback(
    async (entry: TimesheetEntry) => {
      Alert.alert(
        'Delete entry',
        `Are you sure you want to delete the ${entry.hours_worked}h entry on ${formatDatePreview(entry.log_date)}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              setDeletingId(entry.id);
              try {
                await deleteTimesheet(entry.id);
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
    [deleteTimesheet]
  );

  const todayHours = Number(dashboard?.today?.hours ?? 0) || 0;
  const weekHours = dashboard?.week?.hours ?? 0;
  const recentEntries = dashboard?.recentEntries ?? [];
  const todayDate = dashboard?.today?.date ?? todayISO();

  // Part of the day logged: offer to log what is left. Nothing or a full day:
  // a plain "Log time".
  const remainder = todayHours > 0 && todayHours < GAUGE_HOURS ? GAUGE_HOURS - todayHours : null;
  const logLabel = remainder !== null ? `Log ${formatGaugeHours(remainder)} h for today` : 'Log time';
  const handleLog = () => {
    if (remainder !== null && onLogTimeWithHours) onLogTimeWithHours(Math.round(remainder * 10) / 10);
    else onLogTime();
  };

  // `dashboard.week` is a rolling 7-day window ending today (from = today - 6,
  // to = today; see lib/api/v1/services/dashboard.ts), not a calendar week, so
  // the metric is labelled "Last 7 days" and shows that exact payload window in
  // readable form — machine-facing ISO dates stay out of the UI.
  const weekRangeLabel =
    dashboard?.week?.from && dashboard?.week?.to
      ? formatDateRangeShort(dashboard.week.from, dashboard.week.to)
      : undefined;

  const hubItems = useMemo(
    () => [
      {
        key: 'reports',
        icon: 'reports',
        label: 'Reports',
        onPress: onViewReports,
        accessibilityLabel: 'View reports',
      },
      {
        key: 'leaves',
        icon: 'calendar',
        label: 'Leaves',
        onPress: onViewLeaves,
        accessibilityLabel: 'View leaves',
      },
      {
        key: 'reminders',
        icon: 'bell',
        label: 'Reminders',
        onPress: onViewReminders,
        accessibilityLabel: 'View reminders',
      },
      ...(canViewTeam && onViewTeam
        ? [
            {
              key: 'team',
              icon: 'team',
              label: 'Team',
              onPress: onViewTeam,
              accessibilityLabel: 'View team',
            },
          ]
        : []),
    ],
    [canViewTeam, onViewLeaves, onViewReminders, onViewReports, onViewTeam]
  );

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: palette.paper }]}>
        <LoadingState message="Loading your dashboard..." palette={palette} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: palette.paper }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          Platform.OS !== 'windows' ? (
            <RefreshControl
              onRefresh={handleRefresh}
              refreshing={isRefreshing}
              tintColor={palette.primary}
            />
          ) : undefined
        }
      >
        {/* The day: date, hours so far, gauge, and the one thing to do next. */}
        <View style={styles.top}>
          <View style={styles.headerRow}>
            <View style={styles.userInfo}>
              <Text style={[styles.dayLine, { color: palette.foreground }]}>
                {formatDayLine(todayDate)}
              </Text>
              {/* Identity is informational only; the single profile entry point
                  is the labelled "Profile" button (no duplicate tap target). */}
              <Text numberOfLines={1} style={[styles.userEmail, { color: palette.muted }]}>
                {actor?.email ?? 'User'}
              </Text>
            </View>
            <PressableScale
              accessibilityLabel="My profile"
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={onViewProfile}
              style={[styles.profileButton, { borderColor: palette.controlBorder }]}
            >
              <Text style={[styles.profileButtonText, { color: palette.foreground }]}>Profile</Text>
            </PressableScale>
          </View>

          {isOffline ? (
            <View
              accessibilityRole="alert"
              style={[styles.offlineBanner, { borderColor: palette.hairline }]}
            >
              <Text style={[styles.offlineText, { color: palette.muted }]}>
                Viewing cached data while offline.
              </Text>
            </View>
          ) : null}

          <View style={styles.heroRow}>
            <Text style={[styles.heroValue, { color: palette.foreground }]}>
              {formatGaugeHours(todayHours)}
            </Text>
            <Text style={[styles.heroUnit, { color: palette.muted }]}>{`of ${GAUGE_HOURS} h today`}</Text>
          </View>
          <DayGauge hours={todayHours} palette={palette} />

          <PressableScale
            accessibilityLabel={logLabel}
            accessibilityRole="button"
            onPress={handleLog}
            style={[styles.primaryActionButton, { backgroundColor: palette.primary }]}
          >
            <Text style={[styles.primaryActionText, { color: palette.onPrimary }]}>{logLabel}</Text>
          </PressableScale>
        </View>

        <View style={[styles.sheet, { backgroundColor: palette.sheet }]}>
          {effectiveActor?.id && onLogTimeForDate ? (
            <MissingDaysStrip
              listLeaves={listLeaves}
              listTimesheets={listTimesheets}
              minLogDate={minLogDate}
              onMonthLoaded={setMonth}
              onPick={onLogTimeForDate}
              refreshKey={dashboard}
              today={todayDate}
              userId={effectiveActor.id}
            />
          ) : null}

          <View style={[styles.metricsRow, { borderColor: palette.hairline }]}>
            {effectiveActor?.id && onLogTimeForDate ? (
              <MetricCard
                accessibilityLabel={month ? `This Month: ${month.hours.toFixed(1)} hrs, ${formatEntryCount(month.entries)}.` : 'This Month: unavailable.'}
                dateLabel={month ? formatEntryCount(month.entries) : undefined}
                label="This month"
                palette={palette}
                value={month ? (Math.round(month.hours * 10) / 10).toFixed(1) : '—'}
                unit={month ? 'hrs' : ''}
              />
            ) : null}
            <MetricCard
              accessibilityLabel={`Last 7 Days: ${Number(weekHours).toFixed(1)} hrs. Tap to view reports.`}
              dateLabel={weekRangeLabel}
              label="Last 7 days"
              onPress={onViewReports}
              palette={palette}
              value={Number(weekHours).toFixed(1)}
            />
          </View>

          <FeatureHub items={hubItems} palette={palette} />

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: palette.foreground }]}>Recent entries</Text>
            <PressableScale
              accessibilityLabel="View all timesheets"
              accessibilityRole="button"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={onViewTimesheets}
              scaleTo={1}
              style={styles.sectionLink}
            >
              <Text style={[styles.sectionLinkText, { color: palette.primary }]}>All timesheets</Text>
            </PressableScale>
          </View>

          {recentEntries.length === 0 ? (
            <EmptyState
              icon="clock"
              message="Nothing logged yet. Entries you log will show up here."
              palette={palette}
            />
          ) : (
            recentEntries.slice(0, 10).map((entry: TimesheetEntry, index: number) => (
              <TimesheetEntryCard
                key={entry.id || String(index)}
                entry={entry}
                isDeleting={deletingId === entry.id}
                canDelete={entry.user_id === effectiveActor?.id}
                onDelete={handleDelete}
                palette={palette}
              />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerContent: { justifyContent: 'center', alignItems: 'center' },
  scrollContent: { flexGrow: 1 },
  top: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.lg },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  userInfo: { flex: 1, marginRight: spacing.md },
  dayLine: { fontSize: typography.subtitle, fontWeight: '600' },
  userEmail: { fontSize: typography.caption, marginTop: 2 },
  profileButton: {
    borderRadius: borderRadius.control,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  profileButtonText: { fontSize: typography.caption, fontWeight: '600' },
  offlineBanner: {
    borderRadius: borderRadius.control,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.sm,
  },
  offlineText: { fontSize: typography.caption, textAlign: 'center' },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: spacing.sm },
  heroValue: {
    fontFamily: fonts.numeral,
    fontSize: numeralSizes.xl,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  heroUnit: { fontSize: typography.body },
  primaryActionButton: {
    alignItems: 'center',
    borderRadius: borderRadius.control,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  primaryActionText: { fontSize: typography.body, fontWeight: '600' },
  sheet: {
    flexGrow: 1,
    borderTopLeftRadius: borderRadius.sheet,
    borderTopRightRadius: borderRadius.sheet,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  sectionTitle: { fontSize: typography.heading, fontWeight: '600' },
  sectionLink: { minHeight: 44, justifyContent: 'center' },
  sectionLinkText: { fontSize: typography.caption, fontWeight: '600' },
});
