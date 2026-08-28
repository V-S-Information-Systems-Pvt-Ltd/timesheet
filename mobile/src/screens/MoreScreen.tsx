import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography, borderRadius, shadows, getPalette } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { PressableScale } from '../components/PressableScale';
import { Icon, type IconName } from '../components/Icon';
import { useSession } from '../auth/SessionProvider';

import appConfig from '../../app.json';

interface MoreScreenProps {
  isDarkMode: boolean;
  onNavigate: (route: 'leaves' | 'reminders' | 'team' | 'profile') => void;
}

interface ToolItem {
  key: 'leaves' | 'reminders' | 'team' | 'profile';
  title: string;
  subtitle: string;
  icon: IconName;
  requiresTeam?: boolean;
}

const TOOLS: ToolItem[] = [
  {
    key: 'leaves',
    title: 'Mark Leave',
    subtitle: 'Log and track personal absence days',
    icon: 'calendar',
  },
  {
    key: 'reminders',
    title: 'Reminders',
    subtitle: 'Manage timesheet submission alarms',
    icon: 'bell',
  },
  {
    key: 'team',
    title: 'Team Directory',
    subtitle: 'View colleagues, leads, and departments',
    icon: 'team',
    requiresTeam: true,
  },
  {
    key: 'profile',
    title: 'Profile & Security',
    subtitle: 'Account details, active sessions, and password',
    icon: 'profile',
  },
];

export function MoreScreen({ isDarkMode, onNavigate }: MoreScreenProps) {
  const palette = getPalette(isDarkMode);
  const { effectiveActor } = useSession();

  const canViewTeam = Boolean(effectiveActor?.capabilities?.canViewTeam);
  const visibleTools = TOOLS.filter(t => !t.requiresTeam || canViewTeam);
  const versionString = appConfig.version || '0.2.0';

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <ScreenHeader
        palette={palette}
        subtitle="Tools, leave management, and account settings"
        title="More"
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.grid}>
          {visibleTools.map((item) => (
            <PressableScale
              key={item.key}
              accessibilityHint={`Navigates to ${item.title}`}
              accessibilityLabel={item.title}
              accessibilityRole="button"
              onPress={() => onNavigate(item.key)}
              style={[
                styles.card,
                { backgroundColor: palette.card, borderColor: palette.border },
              ]}
            >
              <View style={[styles.iconWrapper, { backgroundColor: palette.badgeBg }]}>
                <Icon color={colors.primary} name={item.icon} size={22} />
              </View>
              <View style={styles.cardTextContainer}>
                <Text style={[styles.cardTitle, { color: palette.foreground }]}>
                  {item.title}
                </Text>
                <Text style={[styles.cardSubtitle, { color: palette.muted }]}>
                  {item.subtitle}
                </Text>
              </View>
              <Icon color={palette.muted} name="chevron-right" size={18} />
            </PressableScale>
          ))}
        </View>

        <View style={styles.appInfoContainer}>
          <Text style={[styles.appVersion, { color: palette.muted }]}>
            VSIS Timesheet v{versionString} • Mobile Edition
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  grid: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  card: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 68,
    ...shadows.sm,
  },
  iconWrapper: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  cardTextContainer: {
    flex: 1,
    marginRight: spacing.sm,
  },
  cardTitle: {
    fontSize: typography.body,
    fontWeight: '700',
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  appInfoContainer: {
    marginTop: spacing.xxl,
    alignItems: 'center',
  },
  appVersion: {
    fontSize: typography.badge,
    fontWeight: '500',
  },
});
