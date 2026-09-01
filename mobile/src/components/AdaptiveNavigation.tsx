import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { spacing, typography, borderRadius, shadows, type Palette } from '../theme';
import type { WorkspaceBranding } from '../api/contracts';
import { PressableScale } from './PressableScale';
import { Icon, type IconName } from './Icon';
import { WorkspaceBrand } from './WorkspaceBrand';
import { type RootTab } from '../navigation/routes';

interface AdaptiveNavigationProps {
  activeTab: RootTab;
  branding?: WorkspaceBranding | null;
  currentRoute: string;
  onNavigateTab: (tab: RootTab) => void;
  palette: Palette;
  isDarkMode: boolean;
}

interface NavItem {
  key: RootTab;
  label: string;
  icon: IconName;
  isAction?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'home' },
  { key: 'timesheets', label: 'Timesheets', icon: 'clock' },
  { key: 'log-time', label: 'Log Time', icon: 'plus', isAction: true },
  { key: 'reports', label: 'Reports', icon: 'reports' },
  { key: 'more', label: 'More', icon: 'more' },
];

export const AdaptiveNavigation = React.memo(function AdaptiveNavigationComponent({
  activeTab,
  branding,
  onNavigateTab,
  palette,
}: AdaptiveNavigationProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= 600;

  if (isWide) {
    return (
      <View
        accessibilityRole="tablist"
        style={[
          styles.railContainer,
          {
            backgroundColor: palette.card,
            borderRightColor: palette.border,
          },
        ]}
      >
        <View style={styles.railHeader}>
          <WorkspaceBrand branding={branding} palette={palette} />
        </View>

        <View style={styles.railItems}>
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.key;
            if (item.isAction) {
              return (
                <PressableScale
                  key={item.key}
                  accessibilityLabel="Log Time Action"
                  accessibilityRole="button"
                  onPress={() => onNavigateTab(item.key)}
                  style={[styles.railActionButton, { backgroundColor: palette.primary }]}
                >
                  <Icon color={palette.onPrimary} name={item.icon} size={20} />
                  <Text style={[styles.railActionText, { color: palette.onPrimary }]}>{item.label}</Text>
                </PressableScale>
              );
            }

            return (
              <PressableScale
                key={item.key}
                accessibilityLabel={`${item.label} Destination`}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                onPress={() => onNavigateTab(item.key)}
                style={[
                  styles.railItem,
                  isActive && { backgroundColor: palette.badgeBg },
                ]}
              >
                <Icon
                  color={isActive ? palette.primary : palette.muted}
                  name={item.icon}
                  size={20}
                />
                <Text
                  style={[
                    styles.railItemText,
                    { color: isActive ? palette.primary : palette.muted },
                    isActive && styles.railItemTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bottomContainer,
        {
          backgroundColor: palette.card,
          borderTopColor: palette.border,
        },
      ]}
    >
      <View style={styles.tabRow}>
        {NAV_ITEMS.map((tab) => {
          const isActive = activeTab === tab.key;
          const activeColor = palette.primary;
          const inactiveColor = palette.muted;

          if (tab.isAction) {
            return (
              <View key={tab.key} style={styles.tabWrapper}>
                <PressableScale
                  accessibilityLabel="Log Time Action Tab"
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => onNavigateTab(tab.key)}
                  style={[styles.actionButton, { backgroundColor: palette.primary }]}
                >
                  <Icon color={palette.onPrimary} name={tab.icon} size={22} />
                </PressableScale>
                <Text
                  style={[
                    styles.tabLabel,
                    styles.actionLabel,
                    { color: isActive ? activeColor : inactiveColor },
                  ]}
                >
                  {tab.label}
                </Text>
              </View>
            );
          }

          return (
            <View key={tab.key} style={styles.tabWrapper}>
              <PressableScale
                accessibilityLabel={`${tab.label} Tab`}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                onPress={() => onNavigateTab(tab.key)}
                style={styles.tabItem}
              >
                <View
                  style={[
                    styles.iconWrapper,
                    isActive && { backgroundColor: palette.badgeBg },
                  ]}
                >
                  <Icon
                    color={isActive ? activeColor : inactiveColor}
                    name={tab.icon}
                    size={20}
                  />
                </View>
                <Text
                  style={[
                    styles.tabLabel,
                    isActive ? styles.tabLabelActive : styles.tabLabelInactive,
                    { color: isActive ? activeColor : inactiveColor },
                  ]}
                >
                  {tab.label}
                </Text>
              </PressableScale>
            </View>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  bottomContainer: {
    borderTopWidth: 1,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    width: '100%',
    ...shadows.md,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 56,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  tabWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  tabItem: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: 2,
  },
  iconWrapper: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: typography.badge,
    marginTop: 2,
    textAlign: 'center',
  },
  tabLabelActive: {
    fontWeight: '700',
  },
  tabLabelInactive: {
    fontWeight: '500',
  },
  actionButton: {
    width: 38,
    height: 38,
    borderRadius: borderRadius.round,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  actionLabel: {
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
  },
  railContainer: {
    width: 200,
    borderRightWidth: 1,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    height: '100%',
  },
  railHeader: {
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
  railItems: {
    gap: spacing.sm,
  },
  railActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
    minHeight: 44,
  },
  railActionText: {
    fontWeight: '700',
    fontSize: typography.body,
  },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
    minHeight: 44,
  },
  railItemText: {
    fontSize: typography.body,
    fontWeight: '500',
  },
  railItemTextActive: {
    fontWeight: '700',
  },
});
