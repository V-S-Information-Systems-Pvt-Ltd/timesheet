import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSession } from '../auth/SessionProvider';
import type { PersonProfile } from '../api/contracts';
import { colors, spacing, typography } from '../theme';

interface TeamScreenProps {
  isDarkMode: boolean;
  onBack: () => void;
  onSelectMember?: (member: PersonProfile) => void;
}

export function TeamScreen({ isDarkMode, onBack, onSelectMember }: TeamScreenProps) {
  const palette = getPalette(isDarkMode);
  const { listPeople } = useSession();
  const [people, setPeople] = useState<PersonProfile[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPeople = useCallback(async () => {
    setError(null);
    try {
      const data = await listPeople();
      setPeople(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load team members.');
    }
  }, [listPeople]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setIsLoading(true);
      await fetchPeople();
      if (mounted) setIsLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [fetchPeople]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await fetchPeople();
    setIsRefreshing(false);
  }

  const filtered = people.filter((p) => {
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
  });

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back to dashboard"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.backButton}
        >
          <Text style={[styles.backButtonText, { color: colors.primary }]}>‹ Dashboard</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.foreground }]}>Team & People</Text>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          accessibilityLabel="Search team members"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearch}
          placeholder="Search by name or email..."
          placeholderTextColor={palette.placeholder}
          style={[
            styles.searchInput,
            { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground },
          ]}
          value={search}
        />
      </View>

      {error ? (
        <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: palette.errorBoxBg }]}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
        </View>
      ) : null}

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: palette.muted }]}>Loading team members...</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={filtered}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={[styles.emptyCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
              <Text style={[styles.emptyText, { color: palette.muted }]}>No team members found.</Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              onRefresh={handleRefresh}
              refreshing={isRefreshing}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => {
            const initial = item.name ? item.name[0].toUpperCase() : 'U';
            const isLeader = item.hierarchyRole === 'manager' || item.hierarchyRole === 'team_lead';

            return (
              <Pressable
                accessibilityLabel={`Team member: ${item.name}`}
                accessibilityRole="button"
                onPress={() => onSelectMember?.(item)}
                style={({ pressed }) => [
                  styles.personCard,
                  { backgroundColor: palette.card, borderColor: palette.border },
                  pressed && styles.cardPressed,
                ]}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>
                <View style={styles.personInfo}>
                  <View style={styles.personHeader}>
                    <Text style={[styles.personName, { color: palette.foreground }]}>{item.name}</Text>
                    {isLeader ? (
                      <View style={[styles.roleBadge, { backgroundColor: palette.badgeBg }]}>
                        <Text style={[styles.roleBadgeText, { color: colors.primary }]}>
                          {item.hierarchyRole === 'manager' ? 'MANAGER' : 'LEAD'}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.personEmail, { color: palette.muted }]}>{item.email}</Text>
                  {item.title ? (
                    <Text style={[styles.personTitle, { color: palette.muted }]}>{item.title}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}
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
        placeholder: colors.darkPlaceholder,
        badgeBg: '#1C2C4E',
        errorBoxBg: '#3A1E1E',
      }
    : {
        background: colors.background,
        foreground: colors.foreground,
        muted: colors.muted,
        card: colors.card,
        border: colors.border,
        placeholder: colors.placeholder,
        badgeBg: colors.primaryLight,
        errorBoxBg: colors.errorLight,
      };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  backButton: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  backButtonText: { fontSize: typography.body, fontWeight: '600' },
  title: {
    fontSize: typography.title,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  searchContainer: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  searchInput: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: typography.body,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  errorBox: {
    borderRadius: 10,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: typography.body, marginTop: spacing.md },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  emptyCard: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.xl,
    marginTop: spacing.md,
  },
  emptyText: { fontSize: typography.body },
  personCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  cardPressed: { opacity: 0.75 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  avatarText: { color: colors.onPrimary, fontSize: 18, fontWeight: '700' },
  personInfo: { flex: 1 },
  personHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  personName: { fontSize: typography.body, fontWeight: '700' },
  personEmail: { fontSize: typography.caption, marginTop: 1 },
  personTitle: { fontSize: typography.badge, marginTop: 2 },
  roleBadge: {
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  roleBadgeText: { fontSize: typography.badge, fontWeight: '700' },
});
