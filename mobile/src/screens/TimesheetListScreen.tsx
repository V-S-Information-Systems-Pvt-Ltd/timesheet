import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColorScheme } from 'react-native';

import type { MobileTimesheetEntry } from '../api/contracts';
import { useSession } from '../auth/SessionProvider';
import { Card, describeApiError, ErrorText, getPalette, MutedText, PrimaryButton, SectionTitle } from '../components';
import { colors, spacing, typography } from '../theme';

const PAGE_SIZE = 20;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function formatHours(hours: number): string {
  return Number(hours.toFixed(2)).toString();
}

interface PageState {
  rows: MobileTimesheetEntry[];
  count: number;
}

export function TimesheetListScreen() {
  const palette = getPalette(useColorScheme() === 'dark');
  const { controller, client } = useSession();

  const [page, setPage] = useState<PageState>({ rows: [], count: 0 });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (from: number, range: { dateFrom?: string; dateTo?: string }) => {
      await controller.ensureAccessToken();
      return client.getTimesheets({
        from,
        to: from + PAGE_SIZE - 1,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
      });
    },
    [client, controller],
  );

  const loadFirstPage = useCallback(
    async (range: { dateFrom?: string; dateTo?: string }) => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchPage(0, range);
        setPage({ rows: result.rows, count: result.count });
      } catch (reason) {
        setError(describeApiError(reason));
      } finally {
        setLoading(false);
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    void loadFirstPage({});
  }, [loadFirstPage]);

  function applyFilter() {
    if ((dateFrom && !DATE_PATTERN.test(dateFrom)) || (dateTo && !DATE_PATTERN.test(dateTo))) {
      setFilterError('Use the YYYY-MM-DD date format.');
      return;
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setFilterError('The start date must be on or before the end date.');
      return;
    }
    setFilterError(null);
    void loadFirstPage({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
  }

  async function loadMore() {
    if (loadingMore || page.rows.length >= page.count) return;
    setLoadingMore(true);
    try {
      const result = await fetchPage(page.rows.length, {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      });
      setPage((prev) => ({
        rows: [...prev.rows, ...result.rows],
        count: result.count,
      }));
    } catch {
      // Keep the loaded page; a retry can fetch the next one.
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <View style={[styles.flex, { backgroundColor: palette.background }]}>
      <FlatList
        contentContainerStyle={styles.content}
        data={page.rows}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card palette={palette} style={styles.entry}>
            <View style={styles.entryHeader}>
              <View style={styles.entryMeta}>
                <Text numberOfLines={1} style={[styles.entryProject, { color: palette.foreground }]}>
                  {item.projects?.name ?? 'Project'}
                </Text>
                <MutedText palette={palette}>{item.log_date}</MutedText>
              </View>
              <Text style={[styles.entryHours, { color: colors.primary }]}>{formatHours(item.hours_worked)} h</Text>
            </View>
            <Text numberOfLines={2} style={[styles.entryWork, { color: palette.foreground }]}>
              {item.work_done}
            </Text>
          </Card>
        )}
        ListHeaderComponent={
          <View>
            <SectionTitle palette={palette}>Your entries</SectionTitle>
            <Card palette={palette} style={styles.filterCard}>
              <View style={styles.filterRow}>
                <TextInput
                  accessibilityLabel="From date"
                  autoCapitalize="none"
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={palette.placeholder}
                  style={[styles.input, styles.inputText, { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground }]}
                  value={dateFrom}
                  onChangeText={setDateFrom}
                />
                <Text style={{ color: palette.muted }}>to</Text>
                <TextInput
                  accessibilityLabel="To date"
                  autoCapitalize="none"
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={palette.placeholder}
                  style={[styles.input, styles.inputText, { backgroundColor: palette.card, borderColor: palette.border, color: palette.foreground }]}
                  value={dateTo}
                  onChangeText={setDateTo}
                />
              </View>
              <PrimaryButton busy={loading} label="Apply filter" onPress={applyFilter} />
              <ErrorText>{filterError}</ErrorText>
            </Card>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <Card palette={palette}>
              <MutedText palette={palette}>Loading entries…</MutedText>
            </Card>
          ) : error ? (
            <Card palette={palette}>
              <SectionTitle palette={palette}>Could not load entries</SectionTitle>
              <MutedText palette={palette} style={styles.errorBody}>{error}</MutedText>
              <PrimaryButton label="Try again" onPress={() => void loadFirstPage({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined })} />
            </Card>
          ) : (
            <Card palette={palette}>
              <MutedText palette={palette}>No entries match this filter.</MutedText>
            </Card>
          )
        }
        ListFooterComponent={
          page.rows.length > 0 && page.rows.length < page.count ? (
            <PrimaryButton busy={loadingMore} busyLabel="Loading…" disabled={loadingMore} label="Load more" onPress={() => void loadMore()} />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg },
  filterCard: { marginTop: spacing.md, marginBottom: spacing.lg },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  input: { borderRadius: 12, borderWidth: 1, flex: 1, minHeight: 44, paddingHorizontal: spacing.md },
  inputText: { fontSize: typography.caption },
  entry: { marginBottom: spacing.md },
  entryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  entryMeta: { flexShrink: 1 },
  entryProject: { fontSize: typography.body, fontWeight: '700' },
  entryHours: { fontSize: typography.body, fontWeight: '700' },
  entryWork: { fontSize: typography.caption, marginTop: spacing.sm },
  errorBody: { marginVertical: spacing.md },
});
