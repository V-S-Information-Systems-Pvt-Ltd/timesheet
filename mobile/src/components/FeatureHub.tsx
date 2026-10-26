import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, typography, type Palette } from '../theme';
import { PressableScale } from './PressableScale';
import { Icon, ICON_NAMES, type IconName } from './Icon';

export interface HubItem {
  key: string;
  icon: IconName | string;
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}

interface FeatureHubProps {
  items: HubItem[];
  palette: Palette;
}

export function FeatureHub({ items, palette }: FeatureHubProps) {
  return (
    <View style={styles.hubContainer}>
      {items.map((item) => (
        <View key={item.key} style={items.length <= 3 ? styles.hubItemThree : styles.hubItemGrid}>
          <PressableScale
            accessibilityLabel={item.accessibilityLabel}
            accessibilityRole="button"
            onPress={item.onPress}
            style={styles.hubButton}
          >
            <View style={styles.iconWrap}>
              {typeof item.icon === 'string' && ICON_NAMES.has(item.icon) ? (
                <Icon color={palette.primaryText} name={item.icon as IconName} size={20} />
              ) : (
                <Text style={[styles.hubIcon, { color: palette.primaryText }]}>{item.icon}</Text>
              )}
            </View>
            <Text numberOfLines={1} style={[styles.hubLabel, { color: palette.foreground }]}>
              {item.label}
            </Text>
          </PressableScale>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hubContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  hubItemThree: {
    flex: 1,
    minWidth: '28%',
  },
  hubItemGrid: {
    width: '48%',
    flexGrow: 1,
  },
  hubButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 64,
  },
  iconWrap: {
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  hubIcon: {
    fontSize: 20,
  },
  hubLabel: {
    fontSize: typography.caption,
    fontWeight: '600',
    textAlign: 'center',
  },
});
