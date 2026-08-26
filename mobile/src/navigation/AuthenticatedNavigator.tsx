import { StyleSheet, Text, Pressable, View, useWindowDimensions } from 'react-native';
import { useColorScheme } from 'react-native';
import { useState } from 'react';

import { getPalette } from '../components';
import { HomeScreen } from '../screens/HomeScreen';
import { TimesheetListScreen } from '../screens/TimesheetListScreen';
import { colors, spacing, typography } from '../theme';

export type AppTab = 'home' | 'entries';

const TABS: Array<{ id: AppTab; label: string; glyph: string }> = [
  { id: 'home', label: 'Home', glyph: '⌂' },
  { id: 'entries', label: 'Entries', glyph: '☰' },
];

/** Wide layouts (Windows, tablets, landscape) use a navigation rail. */
export function isWideLayout(width: number): boolean {
  return width >= 768;
}

function TabButton({
  label,
  glyph,
  active,
  palette,
  onPress,
}: {
  label: string;
  glyph: string;
  active: boolean;
  palette: ReturnType<typeof getPalette>;
  onPress: () => void;
}) {
  const accessibilityProps = active
    ? { accessibilityState: { selected: true }, accessibilityValue: { text: 'selected' } }
    : {};
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      {...accessibilityProps}
      onPress={onPress}
      style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
    >
      <Text style={[styles.tabGlyph, { color: active ? colors.primary : palette.muted }]}>{glyph}</Text>
      <Text
        style={[
          { color: active ? colors.primary : palette.muted },
          active ? styles.tabLabelActive : styles.tabLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function tabScreen(tab: AppTab): React.ReactNode {
  if (tab === 'home') return <HomeScreen />;
  return <TimesheetListScreen />;
}

/**
 * Bottom tab bar on phones; navigation rail on wide layouts such as Windows.
 */
export function AuthenticatedNavigator({ onSignOut }: { onSignOut?: () => void }) {
  const palette = getPalette(useColorScheme() === 'dark');
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<AppTab>('home');
  const wide = isWideLayout(width);

  const content = (
    <View style={[styles.content, { backgroundColor: palette.background }]}>
      <View style={styles.topBar}>
        <Text style={[styles.brand, { color: palette.foreground }]}>VSIS Timesheet</Text>
        {onSignOut ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={onSignOut} hitSlop={8}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        ) : null}
      </View>
      {wide ? (
        <View style={styles.wideRow}>
          <View style={[styles.rail, { backgroundColor: palette.card, borderColor: palette.border }]}>
            {TABS.map((item) => (
              <TabButton key={item.id} {...item} active={tab === item.id} palette={palette} onPress={() => setTab(item.id)} />
            ))}
          </View>
          <View style={styles.wideContent}>{tabScreen(tab)}</View>
        </View>
      ) : (
        <>
          <View style={styles.phoneContent}>{tabScreen(tab)}</View>
          <View
            accessibilityRole="tablist"
            style={[styles.bottomBar, { backgroundColor: palette.card, borderColor: palette.border }]}
          >
            {TABS.map((item) => (
              <TabButton key={item.id} {...item} active={tab === item.id} palette={palette} onPress={() => setTab(item.id)} />
            ))}
          </View>
        </>
      )}
    </View>
  );
  return content;
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  brand: { fontSize: typography.body + 2, fontWeight: '800' },
  phoneContent: { flex: 1 },
  bottomBar: {
    borderTopWidth: 1,
    flexDirection: 'row',
    minHeight: 64,
  },
  tab: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: 48 },
  tabPressed: { opacity: 0.6 },
  tabGlyph: { fontSize: typography.title - 18 },
  tabLabelActive: { fontWeight: '700' },
  tabLabel: { fontWeight: '500' },
  signOutText: { color: colors.primary, fontWeight: '700' },
  wideRow: { flex: 1, flexDirection: 'row' },
  rail: { borderRightWidth: 1, paddingHorizontal: spacing.sm, paddingTop: spacing.lg, width: 120 },
  wideContent: { flex: 1 },
});
