import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSession } from '../auth/SessionProvider';
import type { TimesheetEntry } from '../api/contracts';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';

import { MetricCard } from '../components/MetricCard';
import { FeatureHub } from '../components/FeatureHub';
import { TimesheetEntryCard } from '../components/TimesheetEntryCard';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { PressableScale } from '../components/PressableScale';

interface HomeScreenProps {
  isDarkMode: boolean;
  onViewTimesheets: () => void;
  onLogTime: () => void;
  onViewProfile: () => void;
  onViewReports: () => void;
  onViewLeaves: () => void;
  onViewReminders: () => void;
  onViewTeam?: () => void;
}

export function HomeScreen({
  isDarkMode,
  onViewTimesheets,
  onLogTime,
  onViewProfile,
  onViewReports,
  onViewLeaves,
  onViewReminders,
  onViewTeam,
}: HomeScreenProps) {
  const palette = getPalette(isDarkMode);
  const { actor, dashboard, loadDashboard, deleteTimesheet, isOffline } = useSession();
  const effectiveActor = actor ?? dashboard?.actor;
  const [isLoading, setIsLoading] = useState(!dashboard);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    await loadDashboard();
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

  const todayHours = dashboard?.today?.hours ?? 0;
  const weekHours = dashboard?.week?.hours ?? 0;
  const recentEntries = dashboard?.recentEntries ?? [];

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

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            onRefresh={handleRefresh}
            refreshing={isRefreshing}
            tintColor={colors.primary}
          />
        }
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <Pressable
            accessibilityLabel="View profile"
            accessibilityRole="button"
            onPress={onViewProfile}
            style={styles.userInfo}
          >
            <Text style={[styles.greeting, { color: palette.muted }]}>Signed in as</Text>
            <Text numberOfLines={1} style={[styles.userEmail, { color: palette.foreground }]}>
              {actor?.email ?? 'User'}
            </Text>
            {actor?.role ? (
              <View style={[styles.roleBadge, { backgroundColor: palette.badgeBg }]}>
                <Text style={[styles.roleText, { color: colors.primary }]}>
                  {actor.role.toUpperCase()}
                </Text>
              </View>
            ) : null}
          </Pressable>
          <PressableScale
            accessibilityLabel="My profile"
            accessibilityRole="button"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={onViewProfile}
            style={[
              styles.profileButton,
              { borderColor: palette.border, backgroundColor: palette.card },
            ]}
          >
            <Text style={[styles.profileButtonText, { color: palette.foreground }]}>Profile</Text>
          </PressableScale>
        </View>

        {isOffline ? (
          <View
            accessibilityRole="alert"
            style={[styles.offlineBanner, { backgroundColor: palette.card, borderColor: palette.border }]}
          >
            <Text style={[styles.offlineText, { color: palette.muted }]}>
              Viewing cached data while offline.
            </Text>
          </View>
        ) : null}

        {isLoading ? (
          <LoadingState message="Loading dashboard..." palette={palette} />
        ) : (
          <>
            {/* Metric Cards */}
            <View style={styles.metricsContainer}>
              <MetricCard
                accessibilityLabel={`Today's Hours: ${Number(todayHours).toFixed(1)} hrs. Tap to view timesheets.`}
                dateLabel={dashboard?.today?.date ?? 'Today'}
                isPrimary
                label="Today's Hours"
                onPress={onViewTimesheets}
                palette={palette}
                value={Number(todayHours).toFixed(1)}
              />
              <MetricCard
                accessibilityLabel={`This Week: ${Number(weekHours).toFixed(1)} hrs. Tap to view reports.`}
                dateLabel="Last 7 days"
                label="This Week"
                onPress={onViewReports}
                palette={palette}
                value={Number(weekHours).toFixed(1)}
              />
            </View>

            {/* Quick Actions Primary */}
            <View style={styles.actionsContainer}>
              <View style={styles.actionWrapper}>
                <PressableScale
                  accessibilityLabel="Log time"
                  accessibilityRole="button"
                  onPress={onLogTime}
                  style={styles.primaryActionButton}
                >
                  <Text style={styles.primaryActionText}>+ Log Time</Text>
                </PressableScale>
              </View>

              <View style={styles.actionWrapper}>
                <PressableScale
                  accessibilityLabel="View all timesheets"
                  accessibilityRole="button"
                  onPress={onViewTimesheets}
                  style={[
                    styles.secondaryActionButton,
                    { backgroundColor: palette.card, borderColor: palette.border },
                  ]}
                >
                  <Text style={[styles.secondaryActionText, { color: palette.foreground }]}>
                    Timesheets →
                  </Text>
                </PressableScale>
              </View>
            </View>

            {/* Feature Hub Buttons */}
            <FeatureHub items={hubItems} palette={palette} />

            {/* Recent Entries Section */}
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: palette.foreground }]}>
                Recent Timesheet Entries
              </Text>
            </View>

            {recentEntries.length === 0 ? (
              <EmptyState
                icon="clock"
                message="No recent timesheets logged."
                actionLabel="+ Log Time"
                onAction={onLogTime}
                palette={palette}
              />
            ) : (
              recentEntries.slice(0, 10).map((entry: TimesheetEntry, index: number) => (
                <TimesheetEntryCard
                  key={entry.id || String(index)}
                  entry={entry}
                  isDeleting={deletingId === entry.id}
                  canDelete={entry.user_id === actor?.id}
                  onDelete={handleDelete}
                  palette={palette}
                />
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: spacing.lg },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  userInfo: { flex: 1, marginRight: spacing.md },
  greeting: { fontSize: typography.caption, fontWeight: '600', marginBottom: 2 },
  userEmail: { fontSize: typography.heading, fontWeight: '800' },
  roleBadge: {
    alignSelf: 'flex-start',
    borderRadius: borderRadius.xs,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  roleText: { fontSize: typography.badge, fontWeight: '700' },
  profileButton: {
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    ...shadows.sm,
  },
  profileButtonText: { fontSize: typography.caption, fontWeight: '700' },
  offlineBanner: {
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.sm,
  },
  offlineText: { fontSize: typography.caption, textAlign: 'center' },
  metricsContainer: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  actionsContainer: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  actionWrapper: {
    flex: 1,
  },
  primaryActionButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    width: '100%',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
    ...shadows.sm,
  },
  primaryActionText: {
    color: colors.onPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  secondaryActionButton: {
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    width: '100%',
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
    ...shadows.sm,
  },
  secondaryActionText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  sectionHeader: { marginBottom: spacing.sm },
  sectionTitle: { fontSize: typography.heading, fontWeight: '700' },
});
