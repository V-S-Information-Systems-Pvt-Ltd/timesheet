import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { colors, spacing, typography } from '../theme';

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
  const [isLoading, setIsLoading] = useState(!dashboard);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isLeaderOrManagement =
    actor?.hierarchyRole === 'manager' ||
    actor?.hierarchyRole === 'team_lead' ||
    actor?.role === 'admin' ||
    actor?.role === 'pm' ||
    actor?.role === 'co';

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
          <Pressable
            accessibilityLabel="My profile"
            accessibilityRole="button"
            onPress={onViewProfile}
            style={({ pressed }) => [
              styles.profileButton,
              { borderColor: palette.border },
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={[styles.profileButtonText, { color: palette.foreground }]}>Profile</Text>
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

            {/* Quick Actions Primary */}
            <View style={styles.actionsContainer}>
              <Pressable
                accessibilityLabel="Log time"
                accessibilityRole="button"
                onPress={onLogTime}
                style={({ pressed }) => [styles.primaryActionButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.primaryActionText}>+ Log Time</Text>
              </Pressable>

              <Pressable
                accessibilityLabel="View all timesheets"
                accessibilityRole="button"
                onPress={onViewTimesheets}
                style={({ pressed }) => [
                  styles.secondaryActionButton,
                  { backgroundColor: palette.card, borderColor: palette.border },
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={[styles.secondaryActionText, { color: palette.foreground }]}>
                  Timesheets →
                </Text>
              </Pressable>
            </View>

            {/* Feature Hub Buttons */}
            <View style={styles.hubContainer}>
              <Pressable
                accessibilityLabel="View reports"
                accessibilityRole="button"
                onPress={onViewReports}
                style={[styles.hubButton, { backgroundColor: palette.card, borderColor: palette.border }]}
              >
                <Text style={styles.hubIcon}>📊</Text>
                <Text style={[styles.hubLabel, { color: palette.foreground }]}>Reports</Text>
              </Pressable>

              <Pressable
                accessibilityLabel="View leaves"
                accessibilityRole="button"
                onPress={onViewLeaves}
                style={[styles.hubButton, { backgroundColor: palette.card, borderColor: palette.border }]}
              >
                <Text style={styles.hubIcon}>🌴</Text>
                <Text style={[styles.hubLabel, { color: palette.foreground }]}>Leaves</Text>
              </Pressable>

              <Pressable
                accessibilityLabel="View reminders"
                accessibilityRole="button"
                onPress={onViewReminders}
                style={[styles.hubButton, { backgroundColor: palette.card, borderColor: palette.border }]}
              >
                <Text style={styles.hubIcon}>🔔</Text>
                <Text style={[styles.hubLabel, { color: palette.foreground }]}>Reminders</Text>
              </Pressable>

              {isLeaderOrManagement && onViewTeam ? (
                <Pressable
                  accessibilityLabel="View team"
                  accessibilityRole="button"
                  onPress={onViewTeam}
                  style={[styles.hubButton, { backgroundColor: palette.card, borderColor: palette.border }]}
                >
                  <Text style={styles.hubIcon}>👥</Text>
                  <Text style={[styles.hubLabel, { color: palette.foreground }]}>Team</Text>
                </Pressable>
              ) : null}
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
              recentEntries.slice(0, 10).map((entry: TimesheetEntry, index: number) => {
                const isDeleting = deletingId === entry.id;
                return (
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
                      <View style={styles.entryHeaderRight}>
                        <View style={styles.hoursBadge}>
                          <Text style={styles.hoursText}>
                            {Number(entry.hours_worked).toFixed(1)} hrs
                          </Text>
                        </View>
                        {entry.user_id === actor?.id ? (
                          <Pressable
                            accessibilityLabel={`Delete entry on ${entry.log_date}`}
                            accessibilityRole="button"
                            disabled={isDeleting}
                            onPress={() => handleDelete(entry)}
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
                );
              })
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
    alignItems: 'center',
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
  profileButton: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  profileButtonText: { fontSize: typography.caption, fontWeight: '700' },
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
  metricsContainer: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
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
  actionsContainer: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  primaryActionButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  primaryActionText: {
    color: colors.onPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  secondaryActionButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  secondaryActionText: {
    fontSize: typography.caption,
    fontWeight: '700',
  },
  hubContainer: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  hubButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  hubIcon: { fontSize: 20, marginBottom: 2 },
  hubLabel: { fontSize: typography.badge, fontWeight: '700' },
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
  entryFooter: { marginTop: spacing.xs },
  statusText: { fontSize: typography.badge, fontStyle: 'italic' },
});
