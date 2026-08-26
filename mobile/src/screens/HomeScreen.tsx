import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useColorScheme } from 'react-native';

import type { MobileDashboardData } from '../api/contracts';
import { useSession } from '../auth/SessionProvider';
import { DashboardCache } from '../cache/dashboard-cache';
import { Card, describeApiError, getPalette, MutedText, PrimaryButton, SectionTitle } from '../components';
import { colors, spacing, typography } from '../theme';

function formatHours(hours: number): string {
  return Number(hours.toFixed(2)).toString();
}

export function HomeScreen({ cache = new DashboardCache() }: { cache?: DashboardCache }) {
  const palette = getPalette(useColorScheme() === 'dark');
  const { state, controller, client } = useSession();

  const [dashboard, setDashboard] = useState<MobileDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async ({ soft }: { soft: boolean }) => {
      if (soft) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        await controller.ensureAccessToken();
        const data = await client.getDashboard();
        setDashboard(data);
        setOffline(false);
        await cache.save(data).catch(() => undefined);
      } catch (reason) {
        const code = (reason as { code?: string } | null)?.code;
        if (code === 'NETWORK_ERROR' || code === 'TIMEOUT') {
          setOffline(true);
          const cached = await cache.load();
          if (!cached) setError('You are offline and there is no saved dashboard yet.');
          else setDashboard(cached);
        } else {
          setError(describeApiError(reason));
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [cache, client, controller],
  );

  useEffect(() => {
    void load({ soft: false });
  }, [load]);

  const actorName = dashboard?.actor.email ?? (state.status === 'signed-in' ? state.actor.email : '');

  return (
    <View style={[styles.flex, { backgroundColor: palette.background }]}>
      <FlatList
        contentContainerStyle={styles.content}
        data={dashboard?.recentEntries ?? []}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load({ soft: true })} tintColor={colors.primary} colors={[colors.primary]} />
        }
        renderItem={({ item }) => (
          <Card palette={palette} style={styles.entry}>
            <View style={styles.entryHeader}>
              <Text numberOfLines={1} style={[styles.entryProject, { color: palette.foreground }]}>
                {item.projects?.name ?? 'Project'}
              </Text>
              <Text style={[styles.entryHours, { color: colors.primary }]}>{formatHours(item.hours_worked)} h</Text>
            </View>
            <MutedText palette={palette}>{item.log_date}</MutedText>
            <Text numberOfLines={2} style={[styles.entryWork, { color: palette.foreground }]}>
              {item.work_done}
            </Text>
          </Card>
        )}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View>
            <Text accessibilityRole="header" style={[styles.greeting, { color: palette.foreground }]}>
              Hello{actorName ? `, ${actorName}` : ''}
            </Text>
            {offline ? (
              <Text accessibilityLiveRegion="polite" style={[styles.offlineBanner, { color: palette.muted }]}>
                Offline — showing your last saved dashboard. Pull to retry.
              </Text>
            ) : null}
            <View style={styles.totalsRow}>
              <Card palette={palette} style={styles.totalCard}>
                <MutedText palette={palette}>Today</MutedText>
                <Text style={[styles.totalHours, { color: palette.foreground }]}>
                  {dashboard ? `${formatHours(dashboard.today.hours)} h` : '–'}
                </Text>
              </Card>
              <Card palette={palette} style={styles.totalCard}>
                <MutedText palette={palette}>This week</MutedText>
                <Text style={[styles.totalHours, { color: palette.foreground }]}>
                  {dashboard ? `${formatHours(dashboard.week.hours)} h` : '–'}
                </Text>
              </Card>
            </View>
            <SectionTitle palette={palette}>Recent entries</SectionTitle>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <Card palette={palette}>
              <MutedText palette={palette}>Loading your dashboard…</MutedText>
            </Card>
          ) : error ? (
            <Card palette={palette}>
              <SectionTitle palette={palette}>Could not load the dashboard</SectionTitle>
              <MutedText palette={palette} style={styles.errorBody}>{error}</MutedText>
              <PrimaryButton label="Try again" onPress={() => void load({ soft: true })} />
            </Card>
          ) : (
            <Card palette={palette}>
              <MutedText palette={palette}>No timesheet entries yet.</MutedText>
            </Card>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg },
  greeting: { fontSize: typography.title - 10, fontWeight: '800', marginBottom: spacing.md },
  offlineBanner: { fontSize: typography.caption, marginBottom: spacing.md },
  totalsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm, marginBottom: spacing.lg },
  totalCard: { flex: 1 },
  totalHours: { fontSize: typography.title - 8, fontWeight: '800', marginTop: spacing.xs },
  entry: { marginBottom: spacing.md },
  entryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  entryProject: { flexShrink: 1, fontSize: typography.body, fontWeight: '700' },
  entryHours: { fontSize: typography.body, fontWeight: '700' },
  entryWork: { fontSize: typography.caption, marginTop: spacing.sm },
  errorBody: { marginVertical: spacing.md },
});
