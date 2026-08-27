import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSession } from '../auth/SessionProvider';
import type { PersonProfile } from '../api/contracts';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';

import { ScreenHeader } from '../components/ScreenHeader';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';

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

  const filtered = useMemo(() => {
    if (!search.trim()) return people;
    const q = search.toLowerCase().trim();
    return people.filter((p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));
  }, [people, search]);

  const keyExtractor = useCallback((item: PersonProfile) => item.id, []);

  const renderItem = useCallback(
    ({ item }: { item: PersonProfile }) => {
      const initial = item.name ? item.name[0].toUpperCase() : 'U';
      const isLeader = item.hierarchyRole === 'manager' || item.hierarchyRole === 'team_lead';

      return (
        <PressableScale
          accessibilityLabel={`Team member: ${item.name}`}
          accessibilityRole="button"
          onPress={() => onSelectMember?.(item)}
          style={[
            styles.personCard,
            { backgroundColor: palette.card, borderColor: palette.border },
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
        </PressableScale>
      );
    },
    [onSelectMember, palette]
  );

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {/* Header */}
      <ScreenHeader
        backLabel="‹ Dashboard"
        onBack={onBack}
        palette={palette}
        title="Team & People"
      />

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
        <LoadingState message="Loading team members..." palette={palette} />
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={filtered}
          initialNumToRender={10}
          keyExtractor={keyExtractor}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              icon="team"
              message="No team members found."
              palette={palette}
            />
          }
          maxToRenderPerBatch={10}
          refreshControl={
            <RefreshControl
              onRefresh={handleRefresh}
              refreshing={isRefreshing}
              tintColor={colors.primary}
            />
          }
          removeClippedSubviews={true}
          renderItem={renderItem}
          windowSize={5}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchContainer: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  searchInput: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    fontSize: typography.body,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  errorBox: {
    borderRadius: borderRadius.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: { fontSize: typography.caption, fontWeight: '600' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  personCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
    ...shadows.sm,
  },
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
    borderRadius: borderRadius.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  roleBadgeText: { fontSize: typography.badge, fontWeight: '700' },
});
