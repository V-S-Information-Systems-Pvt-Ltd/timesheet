import React from 'react';
import { StyleSheet, Text, View, Platform } from 'react-native';
import { colors, spacing, typography, borderRadius, shadows, type Palette } from '../theme';
import { PressableScale } from './PressableScale';
import { Icon, type IconName } from './Icon';

export type TabScreen = 'dashboard' | 'timesheets' | 'log-time' | 'profile';

interface BottomNavBarProps {
  activeScreen: string;
  onNavigate: (screen: TabScreen) => void;
  palette: Palette;
  isDarkMode: boolean;
}

interface TabItem {
  key: TabScreen;
  label: string;
  icon: IconName;
  isAction?: boolean;
}

const TABS: TabItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'home' },
  { key: 'timesheets', label: 'Timesheets', icon: 'clock' },
  { key: 'log-time', label: 'Log Time', icon: 'plus', isAction: true },
  { key: 'profile', label: 'Profile', icon: 'profile' },
];

/**
 * Thumb-accessible Bottom Navigation Bar for authenticated mobile sessions.
 */
export const BottomNavBar = React.memo(function BottomNavBarComponent({
  activeScreen,
  onNavigate,
  palette,
  isDarkMode: _isDarkMode,
}: BottomNavBarProps) {
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.container,
        {
          backgroundColor: palette.card,
          borderTopColor: palette.border,
        },
      ]}
    >
      <View style={styles.tabRow}>
        {TABS.map((tab) => {
          const isActive = activeScreen === tab.key;
          const activeColor = colors.primary;
          const inactiveColor = palette.muted;

          if (tab.isAction) {
            return (
              <View key={tab.key} style={styles.tabWrapper}>
                <PressableScale
                  accessibilityLabel="Log Time Action Tab"
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => onNavigate(tab.key)}
                  style={styles.actionButton}
                >
                  <Icon color={colors.onPrimary} name={tab.icon} size={22} />
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
                onPress={() => onNavigate(tab.key)}
                style={styles.tabItem}
              >
                <View style={[styles.iconWrapper, isActive && { backgroundColor: palette.badgeBg }]}>
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
  container: {
    borderTopWidth: 1,
    paddingTop: spacing.xs,
    paddingBottom: Platform.OS === 'ios' ? spacing.xs : spacing.xs,
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
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  actionLabel: {
    fontWeight: '600',
    marginTop: 2,
    textAlign: 'center',
  },
});
