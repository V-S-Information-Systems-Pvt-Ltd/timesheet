import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSession } from '../auth/SessionProvider';
import type { TimesheetEntry } from '../api/contracts';
import { colors, spacing, typography } from '../theme';

interface HomeScreenProps {
  isDarkMode: boolean;
  onViewTimesheets: () => void;
}

export function HomeScreen({ isDarkMode, onViewTimesheets }: HomeScreenProps) {
  const palette = getPalette(isDarkMode);
  const { actor, dashboard, loadDashboard, signOut, isOffline } = useSession();
  const [isLoading, setIsLoading] = useState(!dashboard);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  const todayHours = dashboard?.today?.hours ?? 0;
  const weekHours = dashboard?.week?.hours ?? 0;
  const recentEntries = dashboard?.recentEntries ?? [];

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
          <View style={styles.userInfo}>
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
          </View>
          <Pressable
            accessibilityLabel="Sign out"
            accessibilityRole="button"
            onPress={signOut}
            style={({ pressed }) => [styles.signOutButton, pressed && styles.buttonPressed]}
          >
            <Text style={[styles.signOutText, { color: colors.error }]}>Sign Out</Text>
          </Pressable>
        </View>

        {isOffline ? (
          <View
            accessibilityRole="alert"
            style={[styles.offlineBanner, { backgroundColor: palette.card, borderColor: palette.border }]}
          >
            <Text style={[styles.offlineText, { color: palette.muted }]}>
              📡 Viewing cached data while offline.
            </Text>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[styles.loadingText, { color: palette.muted }]}>Loading dashboard...</Text>
          </View>
        ) : (
          <>
            {/* Metric Cards */}
            <View style={styles.metricsContainer}>
              <View
                style={[
                  styles.metricCard,
                  { backgroundColor: palette.card, borderColor: palette.border },
                ]}
              >
                <Text style={[styles.metricLabel, { color: palette.muted }]}>Today&apos;s Hours</Text>
                <Text style={[styles.metricValue, { color: colors.primary }]}>
                  {Number(todayHours).toFixed(1)} <Text style={styles.metricUnit}>hrs</Text>
                </Text>
                <Text style={[styles.metricDate, { color: palette.muted }]}>
                  {dashboard?.today?.date ?? 'Today'}
                </Text>
              </View>

              <View
                style={[
                  styles.metricCard,
                  { backgroundColor: palette.card, borderColor: palette.border },
                ]}
              >
                <Text style={[styles.metricLabel, { color: palette.muted }]}>This Week</Text>
                <Text style={[styles.metricValue, { color: palette.foreground }]}>
                  {Number(weekHours).toFixed(1)} <Text style={styles.metricUnit}>hrs</Text>
                </Text>
                <Text style={[styles.metricDate, { color: palette.muted }]}>Last 7 days</Text>
              </View>
            </View>

            {/* Quick Actions */}
            <View style={styles.actionsRow}>
              <Pressable
                accessibilityLabel="View all timesheets"
                accessibilityRole="button"
                onPress={onViewTimesheets}
                style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.actionButtonText}>View All Timesheets →</Text>
              </Pressable>
            </View>

            {/* Recent Entries Section */}
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: palette.foreground }]}>
                Recent Timesheet Entries
              </Text>
            </View>

            {recentEntries.length === 0 ? (
              <View
                style={[
                  styles.emptyCard,
                  { backgroundColor: palette.card, borderColor: palette.border },
                ]}
              >
                <Text style={[styles.emptyText, { color: palette.muted }]}>
                  No recent timesheets logged.
                </Text>
              </View>
            ) : (
              recentEntries.slice(0, 10).map((entry: TimesheetEntry, index: number) => (
                <View
                  key={entry.id || String(index)}
                  style={[
                    styles.entryCard,
                    { backgroundColor: palette.card, borderColor: palette.border },
                  ]}
                >
                  <View style={styles.entryHeader}>
                    <Text style={[styles.entryDate, { color: palette.foreground }]}>
                      {entry.log_date}
                    </Text>
                    <View style={styles.hoursBadge}>
                      <Text style={styles.hoursText}>
                        {Number(entry.hours_worked).toFixed(1)} hrs
                      </Text>
                    </View>
                  </View>
                  {entry.notes ? (
                    <Text numberOfLines={2} style={[styles.entryNotes, { color: palette.muted }]}>
                      {entry.notes}
                    </Text>
                  ) : null}
                  {entry.status ? (
                    <View style={styles.entryFooter}>
                      <Text style={[styles.statusText, { color: palette.muted }]}>
                        Status: {entry.status}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
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
        badgeBg: '#1C2C4E',
      }
    : {
        background: colors.background,
        foreground: colors.foreground,
        muted: colors.muted,
        card: colors.card,
        border: colors.border,
        badgeBg: colors.primaryLight,
      };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: spacing.lg },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  userInfo: { flex: 1, marginRight: spacing.md },
  greeting: { fontSize: typography.caption, fontWeight: '600', marginBottom: 2 },
  userEmail: { fontSize: typography.heading, fontWeight: '800' },
  roleBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  roleText: { fontSize: typography.badge, fontWeight: '700' },
  signOutButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  signOutText: { fontSize: typography.caption, fontWeight: '700' },
  buttonPressed: { opacity: 0.7 },
  offlineBanner: {
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.sm,
  },
  offlineText: { fontSize: typography.caption, textAlign: 'center' },
  loadingContainer: { alignItems: 'center', marginVertical: spacing.xxl },
  loadingText: { fontSize: typography.body, marginTop: spacing.md },
  metricsContainer: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  metricCard: {
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    padding: spacing.md,
  },
  metricLabel: { fontSize: typography.caption, fontWeight: '600' },
  metricValue: {
    fontSize: 28,
    fontWeight: '800',
    marginVertical: spacing.xs,
  },
  metricUnit: { fontSize: typography.caption, fontWeight: '500' },
  metricDate: { fontSize: typography.badge },
  actionsRow: { marginBottom: spacing.lg },
  actionButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.lg,
  },
  actionButtonText: {
    color: colors.onPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  sectionHeader: { marginBottom: spacing.sm },
  sectionTitle: { fontSize: typography.heading, fontWeight: '700' },
  emptyCard: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.xl,
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
